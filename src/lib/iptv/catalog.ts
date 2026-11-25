import type { StreamFormat, XtreamConfig } from "./urls";

/** A programme in the guide. Times are epoch milliseconds. */
export interface EpgProgramme {
	title: string;
	start: number;
	end: number;
	description?: string;
	/** The provider keeps a recording to watch back. */
	archive?: boolean;
}

interface CatalogEntryBase {
	pid: string;
	title: string;
	group: string;
	/** Epoch milliseconds the provider added the entry, when known. */
	added?: number;
	/** Marked as adult content by the provider. */
	adult?: boolean;
}

export interface CatalogChannel extends CatalogEntryBase {
	kind: "live";
	number?: number;
	logo?: string;
	/** XMLTV channel id (`tvg-id` / `epg_channel_id`). */
	epgId?: string;
	/** Upstream URL for playlist sources; Xtream channels derive theirs. */
	src?: string;
	format?: StreamFormat;
	/** Days of past programmes the provider keeps for catch-up. */
	archiveDays?: number;
}

export interface CatalogMovie extends CatalogEntryBase {
	kind: "vod";
	poster?: string;
	rating?: number;
	year?: number;
	ext: string;
	src?: string;
}

export interface CatalogSeries extends CatalogEntryBase {
	kind: "series";
	poster?: string;
	backdrop?: string;
	plot?: string;
	genres: string[];
	rating?: number;
	year?: number;
	cast?: string;
	director?: string;
}

export type CatalogEntry = CatalogChannel | CatalogMovie | CatalogSeries;

export interface XtreamCatalogConfig extends XtreamConfig {
	/** Container for live channels: MPEG-TS when the account allows it. */
	liveExt: "ts" | "m3u8";
	/** Whether the account also serves HLS, used as a fallback for TS. */
	hls: boolean;
	/** IANA zone the panel uses for catch-up start times. */
	timezone?: string;
}

/** What the provider says about the subscription. */
export interface IptvAccount {
	status?: string;
	expiresAt?: number;
	maxConnections?: number;
	activeConnections?: number;
	trial?: boolean;
}

export interface IptvCatalog {
	source: string;
	loadedAt: number;
	xtream?: XtreamCatalogConfig;
	/** XMLTV guide advertised by the playlist or configured on the source. */
	epgUrl?: string;
	account?: IptvAccount;
	channels: CatalogChannel[];
	movies: CatalogMovie[];
	series: CatalogSeries[];
}

export interface CatalogEpisode {
	pid: string;
	season: number;
	episode: number;
	title: string;
	plot?: string;
	still?: string;
	durationSeconds?: number;
	ext: string;
	airDate?: string;
	rating?: number;
}

export interface SeriesInfo {
	series: CatalogSeries;
	episodes: CatalogEpisode[];
}

export interface VodInfo {
	plot?: string;
	cast: string[];
	director?: string;
	genres: string[];
	rating?: number;
	year?: number;
	durationSeconds?: number;
	poster?: string;
	backdrop?: string;
	country?: string;
	ageRating?: string;
}

/**
 * `EN - Title (2022) (MULTI SUB)` → `{ title: "Title", year: 2022 }`. Providers
 * pack language prefixes, years and release notes into names; keep the title.
 */
export function cleanTitle(raw: string) {
	let title = raw.trim().replace(/\s+/g, " ");
	let year: number | undefined;
	const yearMatch = title.match(/\s*[([]((?:19|20)\d{2})[)\]]/);
	if (yearMatch?.index && yearMatch.index > 0) {
		year = Number(yearMatch[1]);
		title = title.slice(0, yearMatch.index).trim();
	}
	const stripped = title.replace(/^[A-Z]{2,4}\s*(?:\||-|:)\s*/, "").trim();
	return { title: stripped || title, year };
}

export function parseNumber(value: unknown) {
	const number =
		typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
	return Number.isFinite(number) ? number : undefined;
}

export function parseEpoch(value: unknown) {
	const seconds = parseNumber(value);
	return seconds && seconds > 0 ? seconds * 1000 : undefined;
}

export function splitList(value: unknown) {
	if (typeof value !== "string") return [];
	return value
		.split(/\s*[,/]\s*/)
		.map((part) => part.trim())
		.filter(Boolean);
}

export function catalogEntries(catalog: IptvCatalog): CatalogEntry[] {
	return [...catalog.channels, ...catalog.movies, ...catalog.series];
}

const indexes = new WeakMap<readonly CatalogEntry[], Map<string, CatalogEntry>>();

export function findEntry(
	catalog: IptvCatalog,
	kind: "live",
	pid: string,
): CatalogChannel | undefined;
export function findEntry(catalog: IptvCatalog, kind: "vod", pid: string): CatalogMovie | undefined;
export function findEntry(
	catalog: IptvCatalog,
	kind: "series",
	pid: string,
): CatalogSeries | undefined;
export function findEntry(
	catalog: IptvCatalog,
	kind: "live" | "vod" | "series",
	pid: string,
): CatalogEntry | undefined;
export function findEntry(catalog: IptvCatalog, kind: "live" | "vod" | "series", pid: string) {
	const list: readonly CatalogEntry[] =
		kind === "live" ? catalog.channels : kind === "vod" ? catalog.movies : catalog.series;
	let index = indexes.get(list);
	if (!index) {
		index = new Map(list.map((entry) => [entry.pid, entry]));
		indexes.set(list, index);
	}
	return index.get(pid);
}

/**
 * Sort a guide and drop programmes that overlap the one before. Panels often
 * merge several guide sources, which lists the same show twice.
 */
export function tidyGuide(programmes: EpgProgramme[]) {
	const sorted = [...programmes].sort((a, b) => a.start - b.start || b.end - a.end);
	const kept: EpgProgramme[] = [];
	for (const programme of sorted) {
		const previous = kept[kept.length - 1];
		if (previous && programme.start < previous.end) continue;
		kept.push(programme);
	}
	return kept;
}

const views = new WeakMap<IptvCatalog, Map<string, IptvCatalog>>();

/**
 * The catalog as people browse it: without hidden categories, and without
 * adult content unless the source allows it. Views are cached per catalog.
 */
export function visibleCatalog(
	catalog: IptvCatalog,
	options: { hiddenGroups: string[]; showAdult: boolean },
): IptvCatalog {
	if (!options.hiddenGroups.length && options.showAdult) return catalog;
	const key = `${options.showAdult}|${options.hiddenGroups.join("\u0000")}`;
	let cache = views.get(catalog);
	const cached = cache?.get(key);
	if (cached) return cached;
	const hidden = new Set(options.hiddenGroups.map((group) => `${group}`));
	const keep = (entry: CatalogEntry) =>
		!hidden.has(`${entry.kind}:${entry.group}`) && (options.showAdult || !entry.adult);
	const view = {
		...catalog,
		channels: catalog.channels.filter(keep),
		movies: catalog.movies.filter(keep),
		series: catalog.series.filter(keep),
	};
	if (!cache) {
		cache = new Map();
		views.set(catalog, cache);
	}
	cache.clear();
	cache.set(key, view);
	return view;
}

export interface CatalogGroup {
	kind: "live" | "vod" | "series";
	name: string;
	count: number;
	adult: boolean;
}

/** Categories per kind with their size, for the category picker. */
export function catalogGroups(catalog: IptvCatalog): CatalogGroup[] {
	const groups = new Map<string, CatalogGroup>();
	for (const entry of catalogEntries(catalog)) {
		const key = `${entry.kind}:${entry.group}`;
		const group = groups.get(key) ?? {
			kind: entry.kind,
			name: entry.group,
			count: 0,
			adult: false,
		};
		group.count++;
		group.adult ||= Boolean(entry.adult);
		groups.set(key, group);
	}
	return [...groups.values()].sort(
		(a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
	);
}
