/**
 * IPTV for the native app. There is no Aurora server there, so the device
 * talks to the provider itself: sources and state live on the device, and the
 * catalog is cached in IndexedDB because it is far too big for localStorage.
 */
import type { EpgProgramme, IptvCatalog, SeriesInfo, VodInfo } from "./iptv/catalog";
import { findEntry } from "./iptv/catalog";
import { parseIptvId } from "./iptv/ids";
import type { ArtworkResolver, IptvItemState } from "./iptv/mapping";
import type { IptvBackend, IptvStateStore } from "./iptv/service";
import {
	type IptvSourceConfig,
	type IptvSourceInput,
	type IptvSourceSummary,
	loadSourceCatalog,
	normalizeSourceInput,
	type ProviderFetchers,
	summarizeSource,
} from "./iptv/source";
import { resolveStream } from "./iptv/streams";
import { tmdbArtwork } from "./iptv/urls";
import { getSeriesInfo, getShortEpg, getVodInfo } from "./iptv/xtream";
import type { MediaItem } from "./media";

const SOURCES_KEY = "aurora.client.iptv-sources";
const STATE_KEY = "aurora.client.iptv-state";
const ACTIVE_USER_KEY = "aurora.client.activeUserId";
const MAX_STATE_ENTRIES = 600;
const CATALOG_TTL = 6 * 60 * 60 * 1000;

interface StoredSource {
	id: string;
	name: string;
	config: IptvSourceConfig;
	updatedAt: number;
}

function readSources(): StoredSource[] {
	try {
		const parsed = JSON.parse(window.localStorage.getItem(SOURCES_KEY) ?? "[]");
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function writeSources(sources: StoredSource[]) {
	window.localStorage.setItem(SOURCES_KEY, JSON.stringify(sources));
}

// --- Provider requests ------------------------------------------------------

async function nativeText(url: URL): Promise<string> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
		if (!response.ok)
			throw Object.assign(new Error("provider"), { code: "provider", status: response.status });
		return await response.text();
	} catch (error) {
		if ((error as { code?: string }).code === "provider") throw error;
		// Providers without CORS headers (or plain http on iOS) need the
		// native HTTP stack.
		const { CapacitorHttp } = await import("@capacitor/core");
		const response = await CapacitorHttp.request({
			url: url.href,
			method: "GET",
			responseType: "text",
			connectTimeout: 30_000,
			readTimeout: 120_000,
		});
		if (response.status < 200 || response.status >= 300)
			throw Object.assign(new Error("provider"), { code: "provider", status: response.status });
		return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
	}
}

const fetchers: ProviderFetchers = {
	text: nativeText,
	json: async (url) => JSON.parse(await nativeText(url)) as unknown,
};

// --- Catalog cache ----------------------------------------------------------

function idb(): Promise<IDBDatabase | null> {
	return new Promise((resolve) => {
		if (typeof indexedDB === "undefined") return resolve(null);
		const request = indexedDB.open("aurora-iptv", 1);
		request.onupgradeneeded = () => request.result.createObjectStore("catalogs");
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
	});
}

async function idbGet(key: string): Promise<IptvCatalog | undefined> {
	const db = await idb();
	if (!db) return undefined;
	return new Promise((resolve) => {
		const request = db.transaction("catalogs").objectStore("catalogs").get(key);
		request.onsuccess = () => resolve(request.result as IptvCatalog | undefined);
		request.onerror = () => resolve(undefined);
	});
}

async function idbPut(key: string, value: IptvCatalog | undefined) {
	const db = await idb();
	if (!db) return;
	await new Promise<void>((resolve) => {
		const store = db.transaction("catalogs", "readwrite").objectStore("catalogs");
		const request = value ? store.put(value, key) : store.delete(key);
		request.onsuccess = () => resolve();
		request.onerror = () => resolve();
	});
}

const memory = new Map<string, Promise<IptvCatalog>>();
const vodInfos = new Map<string, Promise<VodInfo | undefined>>();
const seriesInfos = new Map<string, Promise<SeriesInfo>>();
const guides = new Map<string, { at: number; value: Promise<EpgProgramme[]> }>();

function catalogKey(source: StoredSource) {
	return `${source.id}:${source.updatedAt}`;
}

async function loadCatalog(source: StoredSource, force = false): Promise<IptvCatalog> {
	const key = catalogKey(source);
	if (!force) {
		const cached = memory.get(key);
		if (cached) return cached;
	}
	const promise = (async () => {
		const stored = force ? undefined : await idbGet(key);
		if (stored && Date.now() - stored.loadedAt < CATALOG_TTL) return stored;
		try {
			const catalog = await loadSourceCatalog(source.id, source.config, fetchers, source.name);
			await idbPut(key, catalog);
			return catalog;
		} catch (error) {
			if (stored) return stored;
			throw error;
		}
	})();
	memory.set(key, promise);
	promise.catch(() => memory.delete(key));
	return promise;
}

function sourceById(id: string) {
	const source = readSources().find((candidate) => candidate.id === id);
	if (!source) throw new Error("Unknown IPTV source");
	return source;
}

// --- State ------------------------------------------------------------------

interface StateEntry extends IptvItemState {
	updatedAt: number;
	snapshot: MediaItem;
}

function stateKey() {
	let user = "local";
	try {
		user = window.localStorage.getItem(ACTIVE_USER_KEY) || "local";
	} catch {
		// Private mode.
	}
	return `${STATE_KEY}.${user}`;
}

function readState(): Record<string, StateEntry> {
	try {
		return JSON.parse(window.localStorage.getItem(stateKey()) ?? "{}") as Record<
			string,
			StateEntry
		>;
	} catch {
		return {};
	}
}

const clientState: IptvStateStore = {
	async get(ids) {
		const all = readState();
		const result = new Map<string, IptvItemState>();
		for (const id of ids) if (all[id]) result.set(id, all[id]);
		return result;
	},
	async list(kind, limit) {
		return Object.entries(readState())
			.filter(([id, entry]) =>
				kind === "favorites"
					? entry.favorite
					: kind === "continue"
						? (entry.positionTicks ?? 0) > 0 &&
							(entry.durationTicks ?? 0) > 0 &&
							parseIptvId(id)?.kind !== "live"
						: Boolean(entry.lastPlayedAt),
			)
			.sort(([, a], [, b]) =>
				kind === "favorites"
					? b.updatedAt - a.updatedAt
					: (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0),
			)
			.slice(0, limit)
			.map(([id, { snapshot, updatedAt: _updated, ...state }]) => ({ id, state, snapshot }));
	},
	async update(id, patch, snapshot) {
		const all = readState();
		all[id] = { ...all[id], ...patch, updatedAt: Date.now(), snapshot };
		const entries = Object.entries(all).sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
		const kept = Object.fromEntries(
			entries.filter(([, entry], index) => index < MAX_STATE_ENTRIES || entry.favorite),
		);
		window.localStorage.setItem(stateKey(), JSON.stringify(kept));
	},
};

// --- Backend ----------------------------------------------------------------

const clientArtwork: ArtworkResolver = (raw, slot) =>
	raw
		? (tmdbArtwork(raw, slot === "backdrop" || slot === "still" ? "w1280" : "w342") ?? raw)
		: undefined;

function clientSeriesInfo(catalog: IptvCatalog, pid: string) {
	const key = `${catalog.source}:${pid}`;
	let cached = seriesInfos.get(key);
	if (!cached) {
		const series = findEntry(catalog, "series", pid);
		const xtream = catalog.xtream;
		if (!series || !xtream) return Promise.reject(new Error("Unknown series"));
		cached = getSeriesInfo(xtream, fetchers.json, series);
		cached.catch(() => seriesInfos.delete(key));
		seriesInfos.set(key, cached);
	}
	return cached;
}

export function clientIptvBackend(): IptvBackend {
	return {
		async sourceIds() {
			return readSources().map((source) => source.id);
		},
		catalog: (id) => loadCatalog(sourceById(id)),
		vodInfo(catalog, pid) {
			const xtream = catalog.xtream;
			if (!xtream) return Promise.resolve(undefined);
			const key = `${catalog.source}:${pid}`;
			let cached = vodInfos.get(key);
			if (!cached) {
				cached = getVodInfo(xtream, fetchers.json, pid).catch(() => undefined);
				vodInfos.set(key, cached);
			}
			return cached;
		},
		seriesInfo: clientSeriesInfo,
		async epg(catalog, channels) {
			const guide = new Map<string, EpgProgramme[]>();
			const xtream = catalog.xtream;
			if (!xtream) return guide;
			await Promise.all(
				channels
					.filter((channel) => channel.epgId)
					.slice(0, 24)
					.map(async (channel) => {
						const key = `${catalog.source}:${channel.pid}`;
						let cached = guides.get(key);
						if (!cached || Date.now() - cached.at > 10 * 60_000) {
							cached = {
								at: Date.now(),
								value: getShortEpg(xtream, fetchers.json, channel.pid).catch(() => []),
							};
							guides.set(key, cached);
						}
						const programmes = await cached.value;
						if (programmes.length) guide.set(channel.pid, programmes);
					}),
			);
			return guide;
		},
		art: clientArtwork,
		state: clientState,
	};
}

// --- Sources ----------------------------------------------------------------

export function listClientIptvSources(): (IptvSourceSummary & { loadedAt?: number })[] {
	return readSources().map((source) =>
		summarizeSource(source.id, source.name, source.config, source.updatedAt),
	);
}

export function hasClientIptvSources() {
	try {
		return readSources().length > 0;
	} catch {
		return false;
	}
}

export async function saveClientIptvSource(input: IptvSourceInput, id?: string) {
	const sources = readSources();
	const existing = id ? sources.find((source) => source.id === id) : undefined;
	const { name, config } = normalizeSourceInput({
		...input,
		password:
			input.password ||
			(existing?.config.kind === "xtream" ? existing.config.xtream.password : undefined),
	});
	const stored: StoredSource = {
		id: existing?.id ?? crypto.randomUUID().replace(/-/g, "").slice(0, 12),
		name,
		config,
		updatedAt: Date.now(),
	};
	const catalog = await loadCatalog(stored, true);
	if (!catalog.channels.length && !catalog.movies.length && !catalog.series.length)
		throw new Error("iptv.empty");
	writeSources(
		existing ? sources.map((source) => (source.id === id ? stored : source)) : [...sources, stored],
	);
	if (existing) await idbPut(catalogKey(existing), undefined);
	return {
		id: stored.id,
		live: catalog.channels.length,
		movies: catalog.movies.length,
		series: catalog.series.length,
	};
}

export async function deleteClientIptvSource(id: string) {
	const sources = readSources();
	const source = sources.find((candidate) => candidate.id === id);
	writeSources(sources.filter((candidate) => candidate.id !== id));
	if (source) await idbPut(catalogKey(source), undefined);
	return { ok: true };
}

export async function refreshClientIptvSource(id: string) {
	const catalog = await loadCatalog(sourceById(id), true);
	return {
		live: catalog.channels.length,
		movies: catalog.movies.length,
		series: catalog.series.length,
		loadedAt: catalog.loadedAt,
	};
}

/** On the device, play straight from the provider. */
export async function beginClientIptvPlayback(id: string) {
	const parts = parseIptvId(id);
	if (!parts) throw new Error("Not an IPTV item");
	const backend = clientIptvBackend();
	const catalog = await backend.catalog(parts.source);
	const target = await resolveStream(catalog, parts, {
		preferHls: true,
		seriesInfo: (pid) => clientSeriesInfo(catalog, pid),
	});
	let durationSeconds = target.durationSeconds;
	if (parts.kind === "vod" && !durationSeconds)
		durationSeconds = (await backend.vodInfo(catalog, parts.pid))?.durationSeconds;
	return {
		streamUrl: target.url.href,
		fallbackUrl: target.fallback?.href,
		format: target.format,
		live: target.live,
		transcoded: false,
		durationSeconds,
	};
}
