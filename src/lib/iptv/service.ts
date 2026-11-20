import type { DetailedMediaItem, MediaItem, SeriesDetailPayload } from "../media";
import {
	type CatalogChannel,
	type CatalogEntry,
	type CatalogMovie,
	catalogEntries,
	type EpgProgramme,
	findEntry,
	type IptvCatalog,
	type SeriesInfo,
	type VodInfo,
} from "./catalog";
import { episodePid, iptvId, isIptvId, parseIptvId, splitEpisodePid } from "./ids";
import {
	type ArtworkResolver,
	catalogItem,
	channelItem,
	detailed,
	entryId,
	episodeItem,
	type IptvItemState,
	movieDetails,
	movieItem,
	seriesDetails,
} from "./mapping";

/** Where IPTV state lives: SQLite on the server, the device in the app. */
export interface IptvStateStore {
	get(ids: string[]): Promise<Map<string, IptvItemState>>;
	list(
		kind: "continue" | "favorites" | "history",
		limit: number,
	): Promise<{ id: string; state: IptvItemState; snapshot: MediaItem }[]>;
	update(id: string, patch: IptvItemState, snapshot: MediaItem): Promise<void>;
}

/** What the server and the native app each provide to the shared logic. */
export interface IptvBackend {
	sourceIds(): Promise<string[]>;
	catalog(source: string): Promise<IptvCatalog>;
	vodInfo(catalog: IptvCatalog, pid: string): Promise<VodInfo | undefined>;
	seriesInfo(catalog: IptvCatalog, pid: string): Promise<SeriesInfo>;
	/** Guide data for these channels, keyed by channel pid. Best effort. */
	epg(catalog: IptvCatalog, channels: CatalogChannel[]): Promise<Map<string, EpgProgramme[]>>;
	art: ArtworkResolver;
	state: IptvStateStore;
}

export type IptvBrowseKind = "live" | "vod" | "series";

export interface IptvBrowseInput {
	kind: IptvBrowseKind;
	group?: string;
	query?: string;
	sort?: "default" | "added" | "title" | "rating";
	favoritesOnly?: boolean;
	offset?: number;
	limit?: number;
}

export interface IptvBrowseResult {
	items: MediaItem[];
	total: number;
	groups: string[];
}

export interface IptvOverview {
	sources: number;
	live: number;
	movies: number;
	series: number;
}

async function catalogs(backend: IptvBackend) {
	const ids = await backend.sourceIds();
	const results = await Promise.allSettled(ids.map((id) => backend.catalog(id)));
	return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

async function catalogFor(backend: IptvBackend, id: string) {
	const parts = parseIptvId(id);
	if (!parts) throw new Error("Not an IPTV item");
	const ids = await backend.sourceIds();
	if (!ids.includes(parts.source)) throw new Error("Unknown IPTV source");
	return { parts, catalog: await backend.catalog(parts.source) };
}

function listFor(catalog: IptvCatalog, kind: IptvBrowseKind): CatalogEntry[] {
	return kind === "live" ? catalog.channels : kind === "vod" ? catalog.movies : catalog.series;
}

function normalize(value: string) {
	return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

async function withState(backend: IptvBackend, items: MediaItem[]) {
	if (!items.length) return items;
	const states = await backend.state.get(items.map((item) => item.id));
	return items.map((item) => {
		const state = states.get(item.id);
		return state ? { ...item, ...stateFields(state) } : item;
	});
}

function stateFields(state: IptvItemState): Partial<MediaItem> {
	const progress =
		state.positionTicks && state.durationTicks
			? Math.min(100, Math.round((state.positionTicks / state.durationTicks) * 100))
			: undefined;
	return {
		isFavorite: Boolean(state.favorite),
		played: Boolean(state.played),
		playbackPositionTicks: state.positionTicks || undefined,
		progress: progress || undefined,
		watchedAt: state.lastPlayedAt ? new Date(state.lastPlayedAt).toISOString() : undefined,
	};
}

async function withEpg(backend: IptvBackend, catalog: IptvCatalog, entries: CatalogEntry[]) {
	const channels = entries.filter((entry): entry is CatalogChannel => entry.kind === "live");
	if (!channels.length) return new Map<string, EpgProgramme[]>();
	return backend.epg(catalog, channels).catch(() => new Map<string, EpgProgramme[]>());
}

/**
 * Provider lists often leave out artwork for new titles while the title's own
 * info has it. Fill in a page's missing posters from that (cached) info.
 */
async function vodDetailsFor(backend: IptvBackend, catalog: IptvCatalog, entries: CatalogEntry[]) {
	const missing = entries
		.filter((entry): entry is CatalogMovie => entry.kind === "vod" && !entry.poster)
		.slice(0, 24);
	const infos = new Map<string, VodInfo>();
	if (!missing.length || !catalog.xtream) return infos;
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(6, missing.length) }, async () => {
			while (next < missing.length) {
				const movie = missing[next++];
				if (!movie) continue;
				const info = await Promise.race([
					backend.vodInfo(catalog, movie.pid).catch(() => undefined),
					new Promise<undefined>((resolve) => setTimeout(resolve, 5000)),
				]);
				if (info) infos.set(movie.pid, info);
			}
		}),
	);
	return infos;
}

async function toItems(backend: IptvBackend, catalog: IptvCatalog, entries: CatalogEntry[]) {
	const [guide, infos] = await Promise.all([
		withEpg(backend, catalog, entries),
		vodDetailsFor(backend, catalog, entries),
	]);
	const items = entries.map((entry) =>
		entry.kind === "vod" && infos.has(entry.pid)
			? movieItem(catalog.source, entry, backend.art, undefined, infos.get(entry.pid))
			: catalogItem(catalog.source, entry, backend.art, undefined, (channel) =>
					guide.get(channel.pid),
				),
	);
	return withState(backend, items);
}

export async function iptvOverview(backend: IptvBackend): Promise<IptvOverview> {
	const all = await catalogs(backend);
	return {
		sources: (await backend.sourceIds()).length,
		live: all.reduce((sum, catalog) => sum + catalog.channels.length, 0),
		movies: all.reduce((sum, catalog) => sum + catalog.movies.length, 0),
		series: all.reduce((sum, catalog) => sum + catalog.series.length, 0),
	};
}

export async function browseIptv(
	backend: IptvBackend,
	input: IptvBrowseInput,
): Promise<IptvBrowseResult> {
	const limit = Math.min(Math.max(input.limit ?? 48, 1), 200);
	const offset = Math.max(input.offset ?? 0, 0);
	const query = normalize(input.query?.trim() ?? "");
	const all = await catalogs(backend);
	let rows = all.flatMap((catalog) =>
		listFor(catalog, input.kind).map((entry) => ({ catalog, entry })),
	);
	const groups = [...new Set(rows.map((row) => row.entry.group).filter(Boolean))];
	if (input.group) rows = rows.filter((row) => row.entry.group === input.group);
	if (query) rows = rows.filter((row) => normalize(row.entry.title).includes(query));
	if (input.favoritesOnly) {
		const states = await backend.state.get(
			rows.map((row) => entryId(row.catalog.source, row.entry)),
		);
		rows = rows.filter((row) => states.get(entryId(row.catalog.source, row.entry))?.favorite);
	}
	if (input.sort === "added") rows.sort((a, b) => (b.entry.added ?? 0) - (a.entry.added ?? 0));
	else if (input.sort === "title") rows.sort((a, b) => a.entry.title.localeCompare(b.entry.title));
	else if (input.sort === "rating")
		rows.sort(
			(a, b) =>
				("rating" in b.entry ? (b.entry.rating ?? 0) : 0) -
				("rating" in a.entry ? (a.entry.rating ?? 0) : 0),
		);
	const page = rows.slice(offset, offset + limit);
	const items: MediaItem[] = [];
	for (const catalog of all) {
		const entries = page.filter((row) => row.catalog === catalog).map((row) => row.entry);
		if (entries.length) items.push(...(await toItems(backend, catalog, entries)));
	}
	const order = new Map(page.map((row, index) => [entryId(row.catalog.source, row.entry), index]));
	items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
	return { items, total: rows.length, groups };
}

export interface IptvShelves {
	live: MediaItem[];
	movies: MediaItem[];
	series: MediaItem[];
}

/** Rows for Home: live channels (favourites first), newest films and series. */
export async function iptvShelves(backend: IptvBackend, size = 12): Promise<IptvShelves> {
	const all = await catalogs(backend);
	const favorites = await backend.state.list("favorites", 200);
	const watched = await backend.state.list("history", 50);
	const preferred = [...favorites, ...watched]
		.map((row) => row.id)
		.filter((id, index, list) => list.indexOf(id) === index && parseIptvId(id)?.kind === "live");

	const live: MediaItem[] = [];
	for (const catalog of all) {
		const picked = new Map<string, CatalogChannel>();
		for (const id of preferred) {
			const parts = parseIptvId(id);
			const channel = parts?.source === catalog.source && findEntry(catalog, "live", parts.pid);
			if (channel) picked.set(channel.pid, channel);
		}
		for (const channel of catalog.channels) {
			if (picked.size >= size) break;
			if (channel.logo) picked.set(channel.pid, channel);
		}
		live.push(...(await toItems(backend, catalog, [...picked.values()].slice(0, size))));
	}

	const newest = async (kind: "vod" | "series") => {
		const rows = all.flatMap((catalog) =>
			listFor(catalog, kind)
				.filter((entry) => "poster" in entry && entry.poster)
				.map((entry) => ({ catalog, entry })),
		);
		rows.sort((a, b) => (b.entry.added ?? 0) - (a.entry.added ?? 0));
		const items: MediaItem[] = [];
		for (const { catalog, entry } of rows.slice(0, size)) {
			items.push(catalogItem(catalog.source, entry, backend.art));
		}
		return withState(backend, items);
	};

	return {
		live: live.slice(0, size * 2),
		movies: await newest("vod"),
		series: await newest("series"),
	};
}

export async function searchIptv(backend: IptvBackend, rawQuery: string, limit = 24) {
	const query = normalize(rawQuery.trim());
	if (query.length < 2) return [];
	const all = await catalogs(backend);
	const matches: { catalog: IptvCatalog; entry: CatalogEntry; score: number }[] = [];
	for (const catalog of all) {
		for (const entry of catalogEntries(catalog)) {
			const title = normalize(entry.title);
			const index = title.indexOf(query);
			if (index < 0) continue;
			matches.push({ catalog, entry, score: (index === 0 ? 0 : 1) + title.length / 1000 });
		}
	}
	matches.sort((a, b) => a.score - b.score);
	const items = matches
		.slice(0, limit)
		.map(({ catalog, entry }) => catalogItem(catalog.source, entry, backend.art));
	return withState(backend, items);
}

export async function iptvItemDetails(
	backend: IptvBackend,
	id: string,
): Promise<DetailedMediaItem> {
	const { parts, catalog } = await catalogFor(backend, id);
	const state = (await backend.state.get([id])).get(id);
	if (parts.kind === "live") {
		const channel = findEntry(catalog, "live", parts.pid);
		if (!channel) throw new Error("Unknown channel");
		const guide = await withEpg(backend, catalog, [channel]);
		return detailed(
			channelItem(catalog.source, channel, backend.art, state, guide.get(channel.pid)),
			{
				tags: channel.group ? [channel.group] : [],
			},
		);
	}
	if (parts.kind === "vod") {
		const movie = findEntry(catalog, "vod", parts.pid);
		if (!movie) throw new Error("Unknown title");
		const info = await backend.vodInfo(catalog, movie.pid).catch(() => undefined);
		return movieDetails(catalog.source, movie, info, backend.art, state);
	}
	if (parts.kind === "series") {
		return (await iptvSeriesDetails(backend, id)).item;
	}
	const ids = splitEpisodePid(parts.pid);
	const series = ids && findEntry(catalog, "series", ids.series);
	if (!ids || !series) throw new Error("Unknown episode");
	const info = await backend.seriesInfo(catalog, series.pid);
	const episode = info.episodes.find((candidate) => candidate.pid === ids.episode);
	if (!episode) throw new Error("Unknown episode");
	return detailed(episodeItem(catalog.source, info.series, episode, backend.art, state));
}

export async function iptvSeriesDetails(
	backend: IptvBackend,
	id: string,
): Promise<SeriesDetailPayload> {
	const { parts, catalog } = await catalogFor(backend, id);
	const seriesPid = parts.kind === "ep" ? splitEpisodePid(parts.pid)?.series : parts.pid;
	const series = seriesPid ? findEntry(catalog, "series", seriesPid) : undefined;
	if (!series) throw new Error("Unknown series");
	const info = await backend.seriesInfo(catalog, series.pid);
	const similar = await relatedIptv(backend, entryId(catalog.source, series), 12);
	const states = await backend.state.get([
		entryId(catalog.source, series),
		...info.episodes.map((episode) =>
			iptvId(catalog.source, "ep", episodePid(series.pid, episode.pid)),
		),
	]);
	return seriesDetails(catalog.source, info, backend.art, (key) => states.get(key), similar);
}

/** Titles from the same provider category. */
export async function relatedIptv(backend: IptvBackend, id: string, limit = 12) {
	const { parts, catalog } = await catalogFor(backend, id);
	const kind = parts.kind === "ep" ? "series" : parts.kind;
	const pid = parts.kind === "ep" ? splitEpisodePid(parts.pid)?.series : parts.pid;
	const entry = pid ? findEntry(catalog, kind, pid) : undefined;
	if (!entry) return [];
	const siblings = listFor(catalog, kind)
		.filter((candidate) => candidate.group === entry.group && candidate.pid !== entry.pid)
		.sort((a, b) => (b.added ?? 0) - (a.added ?? 0))
		.slice(0, limit);
	return toItems(backend, catalog, siblings);
}

/** Now/next for a set of channel ids, for guide rows that refresh on their own. */
export async function iptvGuide(backend: IptvBackend, ids: string[]) {
	const result: Record<string, MediaItem["epg"]> = {};
	const bySource = new Map<string, string[]>();
	for (const id of ids.slice(0, 60)) {
		const parts = parseIptvId(id);
		if (parts?.kind !== "live") continue;
		bySource.set(parts.source, [...(bySource.get(parts.source) ?? []), parts.pid]);
	}
	for (const [source, pids] of bySource) {
		if (!(await backend.sourceIds()).includes(source)) continue;
		const catalog = await backend.catalog(source);
		const channels = pids.flatMap((pid) => findEntry(catalog, "live", pid) ?? []);
		const guide = await withEpg(backend, catalog, channels);
		for (const channel of channels) {
			const item = channelItem(source, channel, backend.art, undefined, guide.get(channel.pid));
			result[item.id] = item.epg;
		}
	}
	return result;
}

export async function iptvList(
	backend: IptvBackend,
	kind: "continue" | "favorites" | "history",
	limit = 40,
) {
	if (!(await backend.sourceIds()).length) return [];
	const rows = await backend.state.list(kind, limit);
	return rows.map(({ snapshot, state }) => ({ ...snapshot, ...stateFields(state) }));
}

export function isIptvItem(item: Pick<MediaItem, "id">) {
	return isIptvId(item.id);
}

/** A copy of the item without per-user fields, kept with the user's state. */
export function snapshotOf(item: MediaItem | DetailedMediaItem): MediaItem {
	const {
		cast: _cast,
		studios: _studios,
		tags: _tags,
		isFavorite: _favorite,
		played: _played,
		progress: _progress,
		playbackPositionTicks: _position,
		watchedAt: _watched,
		epg: _epg,
		...rest
	} = item as DetailedMediaItem;
	return rest;
}

/** Resolve an item fresh from the catalog, for state snapshots. */
export async function iptvSnapshot(backend: IptvBackend, id: string) {
	return snapshotOf(await iptvItemDetails(backend, id));
}

/** Details plus titles from the same category, shaped like the Jellyfin payload. */
export async function iptvItemPayload(backend: IptvBackend, id: string) {
	const [item, similar] = await Promise.all([
		iptvItemDetails(backend, id),
		relatedIptv(backend, id, 12).catch(() => [] as MediaItem[]),
	]);
	return { item, similar };
}
