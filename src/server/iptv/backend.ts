import type {
	CatalogChannel,
	EpgProgramme,
	IptvCatalog,
	SeriesInfo,
	VodInfo,
} from "../../lib/iptv/catalog";
import { findEntry } from "../../lib/iptv/catalog";
import type { ArtworkResolver } from "../../lib/iptv/mapping";
import type { GuideMatch, IptvBackend } from "../../lib/iptv/service";
import { loadSourceCatalog } from "../../lib/iptv/source";
import { tmdbArtwork } from "../../lib/iptv/urls";
import { getSeriesInfo, getShortEpg, getVodInfo } from "../../lib/iptv/xtream";
import { getIptvSource, listIptvSourceIds } from "../../lib/iptv-source-store";
import { createIptvStateStore, iptvUserKey } from "../../lib/iptv-user-store";
import { normalizeSearchText, type PreparedQuery, scoreText } from "../../lib/search";
import { iptvEnabled, providerFetchers } from "./network";
import { signedImagePath } from "./tokens";
import { xmltvGuide } from "./xmltv-cache";

const CATALOG_TTL = 3 * 60 * 60 * 1000;
const INFO_TTL = 6 * 60 * 60 * 1000;
const EPG_TTL = 10 * 60 * 1000;

/** A small TTL + LRU map that also shares in-flight loads. */
class Cache<T> {
	private entries = new Map<string, { value?: T; promise?: Promise<T>; expires: number }>();
	constructor(
		private readonly ttl: number,
		private readonly max: number,
	) {}

	async get(key: string, load: () => Promise<T>, force = false): Promise<T> {
		const now = Date.now();
		const hit = this.entries.get(key);
		if (hit && !force && hit.expires > now) {
			this.entries.delete(key);
			this.entries.set(key, hit);
			if (hit.value !== undefined) return hit.value;
			if (hit.promise) return hit.promise;
		}
		const promise = load();
		const entry: { value?: T; promise?: Promise<T>; expires: number } = {
			promise,
			expires: now + this.ttl,
		};
		this.entries.set(key, entry);
		while (this.entries.size > this.max) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
		try {
			entry.value = await promise;
			entry.promise = undefined;
			return entry.value;
		} catch (error) {
			if (this.entries.get(key) === entry) this.entries.delete(key);
			throw error;
		}
	}

	peek(key: string) {
		const hit = this.entries.get(key);
		return hit && hit.expires > Date.now() ? hit.value : undefined;
	}

	delete(prefix: string) {
		for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
	}
}

const catalogs = new Cache<IptvCatalog>(CATALOG_TTL, 4);
const vodInfos = new Cache<VodInfo | undefined>(INFO_TTL, 500);
const seriesInfos = new Cache<SeriesInfo>(INFO_TTL, 200);
const guides = new Cache<EpgProgramme[]>(EPG_TTL, 2000);

function background() {
	return AbortSignal.timeout(180_000);
}

export function forgetIptvCatalog(source: string) {
	catalogs.delete(`${source}:`);
	vodInfos.delete(`${source}:`);
	seriesInfos.delete(`${source}:`);
	guides.delete(`${source}:`);
}

export async function loadServerCatalog(source: string, force = false) {
	const saved = getIptvSource(source);
	if (!saved) throw new Error("Unknown IPTV source");
	return catalogs.get(
		`${source}:${saved.updatedAt}`,
		() => loadSourceCatalog(source, saved.config, providerFetchers(background()), saved.name),
		force,
	);
}

export async function serverSeriesInfo(catalog: IptvCatalog, pid: string) {
	const series = findEntry(catalog, "series", pid);
	const xtream = catalog.xtream;
	if (!series || !xtream) throw new Error("Unknown series");
	return seriesInfos.get(`${catalog.source}:${pid}`, () =>
		getSeriesInfo(xtream, providerFetchers(background()).json, series),
	);
}

export const serverArtwork: ArtworkResolver = (raw, slot) => {
	if (!raw) return undefined;
	const tmdb = tmdbArtwork(raw, slot === "backdrop" || slot === "still" ? "w1280" : "w342");
	if (tmdb) return tmdb;
	try {
		return signedImagePath(raw);
	} catch {
		return undefined;
	}
};

async function limited<T, R>(items: T[], size: number, run: (item: T) => Promise<R>) {
	const results: R[] = [];
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				const item = items[index];
				if (item !== undefined) results[index] = await run(item);
			}
		}),
	);
	return results;
}

async function serverEpg(catalog: IptvCatalog, channels: CatalogChannel[]) {
	const guide = new Map<string, EpgProgramme[]>();
	const withIds = channels.filter((channel) => channel.epgId).slice(0, 48);
	if (!withIds.length) return guide;
	const xmltv = await xmltvGuide(catalog).catch(() => null);
	const missing: CatalogChannel[] = [];
	for (const channel of withIds) {
		const programmes = channel.epgId ? xmltv?.get(channel.epgId) : undefined;
		if (programmes?.length) guide.set(channel.pid, programmes);
		else missing.push(channel);
	}
	const xtream = catalog.xtream;
	if (xtream && missing.length) {
		await limited(missing, 6, async (channel) => {
			const programmes = await guides
				.get(`${catalog.source}:${channel.pid}`, () =>
					getShortEpg(xtream, providerFetchers(AbortSignal.timeout(10_000)).json, channel.pid),
				)
				.catch(() => []);
			if (programmes.length) guide.set(channel.pid, programmes);
		});
	}
	return guide;
}

type Guide = Map<string, EpgProgramme[]>;
const guideIndexes = new WeakMap<
	Guide,
	{ epgId: string; programme: EpgProgramme; title: string }[]
>();

function guideIndex(guide: Guide) {
	let index = guideIndexes.get(guide);
	if (!index) {
		index = [...guide].flatMap(([epgId, programmes]) =>
			programmes.map((programme) => ({
				epgId,
				programme,
				title: normalizeSearchText(programme.title),
			})),
		);
		guideIndexes.set(guide, index);
	}
	return index;
}

async function serverSearchGuide(catalog: IptvCatalog, query: PreparedQuery) {
	const guide = await xmltvGuide(catalog);
	if (!guide) return [];
	const now = Date.now();
	const until = now + 24 * 3600_000;
	const matches: GuideMatch[] = [];
	for (const { epgId, programme, title } of guideIndex(guide)) {
		if (programme.end <= now || programme.start > until) continue;
		const score = scoreText(query, title);
		if (score != null) matches.push({ epgId, programme, score });
	}
	return matches
		.sort((a, b) => a.score - b.score || a.programme.start - b.programme.start)
		.slice(0, 60);
}

export function serverIptvBackend(): IptvBackend {
	return {
		async sourceIds() {
			return iptvEnabled() ? listIptvSourceIds() : [];
		},
		catalog: (source) => loadServerCatalog(source),
		async vodInfo(catalog, pid) {
			const xtream = catalog.xtream;
			if (!xtream) return undefined;
			return vodInfos.get(`${catalog.source}:${pid}`, () =>
				getVodInfo(xtream, providerFetchers(background()).json, pid),
			);
		},
		seriesInfo: serverSeriesInfo,
		epg: serverEpg,
		searchGuide: serverSearchGuide,
		art: serverArtwork,
		state: createIptvStateStore(iptvUserKey()),
	};
}

export function cachedCatalogLoadedAt(source: string) {
	const saved = getIptvSource(source);
	return saved ? catalogs.peek(`${source}:${saved.updatedAt}`)?.loadedAt : undefined;
}
