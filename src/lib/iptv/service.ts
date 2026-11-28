import type { DetailedMediaItem, MediaItem, MediaProgramme, SeriesDetailPayload } from "../media";
import {
	dropTypoMatches,
	normalizeSearchText,
	type PreparedQuery,
	prepareQuery,
	type SearchResults,
	scoreText,
} from "../search";
import {
	type CatalogChannel,
	type CatalogEntry,
	type CatalogMovie,
	type CatalogSeries,
	catalogEntries,
	type EpgProgramme,
	findEntry,
	type IptvCatalog,
	type SeriesInfo,
	type VodInfo,
	visibleCatalog,
} from "./catalog";
import {
	episodePid,
	iptvId,
	isIptvId,
	parseIptvId,
	replayPid,
	splitEpisodePid,
	splitReplayPid,
} from "./ids";
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
	replayItem,
	seriesDetails,
} from "./mapping";
import { DEFAULT_SOURCE_OPTIONS, type IptvSourceOptions } from "./source";

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
	/** Hidden categories and adult content per source. */
	options(source: string): Promise<IptvSourceOptions>;
	catalog(source: string): Promise<IptvCatalog>;
	vodInfo(catalog: IptvCatalog, pid: string): Promise<VodInfo | undefined>;
	seriesInfo(catalog: IptvCatalog, pid: string): Promise<SeriesInfo>;
	/** A channel's guide for several days, earlier programmes included. */
	schedule(catalog: IptvCatalog, channel: CatalogChannel): Promise<EpgProgramme[]>;
	/** Guide programmes whose title matches, when a full guide is loaded. */
	searchGuide?(catalog: IptvCatalog, query: PreparedQuery): Promise<GuideMatch[]>;
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
	/** Only channels that have a TV guide. */
	guideOnly?: boolean;
	/** Series of this genre. */
	genre?: string;
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

/** Every source's catalog as people browse it (hidden categories left out). */
async function catalogs(backend: IptvBackend) {
	const ids = await backend.sourceIds();
	const results = await Promise.allSettled(
		ids.map(async (id) =>
			visibleCatalog(
				await backend.catalog(id),
				await backend.options(id).catch(() => DEFAULT_SOURCE_OPTIONS),
			),
		),
	);
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

type BrowseRow = { catalog: IptvCatalog; entry: CatalogEntry; score?: number };

/** Filter and sort a kind of entry across sources, as the Live TV page shows them. */
async function browseRows(backend: IptvBackend, input: IptvBrowseInput) {
	const query = prepareQuery(input.query ?? "");
	const all = await catalogs(backend);
	let rows: BrowseRow[] = all.flatMap((catalog) =>
		listFor(catalog, input.kind).map((entry) => ({ catalog, entry })),
	);
	const groups = [...new Set(rows.map((row) => row.entry.group).filter(Boolean))];
	if (input.group) rows = rows.filter((row) => row.entry.group === input.group);
	if (input.genre) {
		const genre = input.genre.toLowerCase();
		rows = rows.filter(
			(row) =>
				row.entry.kind === "series" &&
				row.entry.genres.some((name) => name.toLowerCase() === genre),
		);
	}
	if (input.guideOnly) rows = rows.filter((row) => row.entry.kind === "live" && row.entry.epgId);
	if (query.text) {
		rows = rows.flatMap((row) => {
			const score = scoreText(query, normalizeSearchText(row.entry.title));
			return score == null ? [] : [{ ...row, score }];
		});
		rows = dropTypoMatches(rows as (BrowseRow & { score: number })[]);
	}
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
	else if (query.text) rows.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
	else if (input.kind === "live" && !input.favoritesOnly)
		rows = await favoritesFirst(backend, rows);
	return { all, rows, groups };
}

/**
 * Favourite channels first, so they're at hand without searching; both parts
 * keep the provider's order.
 */
async function favoritesFirst(backend: IptvBackend, rows: BrowseRow[]) {
	const favorites = await backend.state.list("favorites", 1000).catch(() => []);
	if (!favorites.length) return rows;
	const ids = new Set(favorites.map((favorite) => favorite.id));
	const pinned: BrowseRow[] = [];
	const rest: BrowseRow[] = [];
	for (const row of rows) {
		(ids.has(entryId(row.catalog.source, row.entry)) ? pinned : rest).push(row);
	}
	return pinned.length ? [...pinned, ...rest] : rows;
}

export async function browseIptv(
	backend: IptvBackend,
	input: IptvBrowseInput,
): Promise<IptvBrowseResult> {
	const limit = Math.min(Math.max(input.limit ?? 48, 1), 200);
	const offset = Math.max(input.offset ?? 0, 0);
	const { all, rows, groups } = await browseRows(backend, input);
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

export interface IptvGuideRow {
	channel: MediaItem;
	programmes: MediaProgramme[];
}

export interface IptvGuideResult {
	rows: IptvGuideRow[];
	total: number;
	groups: string[];
}

/** Channels with their programmes in a time window, for the guide timeline. */
export async function iptvGuideRows(
	backend: IptvBackend,
	input: Omit<IptvBrowseInput, "kind"> & { from: number; to: number },
): Promise<IptvGuideResult> {
	const limit = Math.min(Math.max(input.limit ?? 30, 1), 48);
	const offset = Math.max(input.offset ?? 0, 0);
	const { all, rows, groups } = await browseRows(backend, {
		...input,
		kind: "live",
		guideOnly: true,
	});
	const page = rows.slice(offset, offset + limit);
	const out: IptvGuideRow[] = [];
	for (const catalog of all) {
		const channels = page
			.filter((row) => row.catalog === catalog)
			.map((row) => row.entry as CatalogChannel);
		if (!channels.length) continue;
		const guide = await withEpg(backend, catalog, channels);
		const states = await backend.state.get(
			channels.map((channel) => entryId(catalog.source, channel)),
		);
		for (const channel of channels) {
			const programmes = (guide.get(channel.pid) ?? []).filter(
				(programme) => programme.end > input.from && programme.start < input.to,
			);
			const id = entryId(catalog.source, channel);
			out.push({
				channel: channelItem(
					catalog.source,
					channel,
					backend.art,
					states.get(id),
					guide.get(channel.pid),
				),
				programmes: scheduleWithReplays(catalog.source, channel, programmes),
			});
		}
	}
	const order = new Map(page.map((row, index) => [entryId(row.catalog.source, row.entry), index]));
	out.sort((a, b) => (order.get(a.channel.id) ?? 0) - (order.get(b.channel.id) ?? 0));
	return { rows: out, total: rows.length, groups };
}

export interface IptvBrowseRow {
	id: string;
	/** An i18n key for Aurora's own rows; categories and genres use `title`. */
	titleKey?: "continue" | "added" | "rated" | "favorites";
	title?: string;
	items: MediaItem[];
	/** How "see all" opens the full grid. */
	filter: { group?: string; genre?: string; sort?: "added" | "rating"; favorites?: boolean };
}

export interface IptvBrowseRows {
	hero: MediaItem[];
	rows: IptvBrowseRow[];
}

/** `|EN| ACTION/THRILLER` → `ACTION/THRILLER`: language tags read as noise in a row title. */
export function displayGroup(name: string) {
	const cleaned = name
		.replace(/^\|?\s*[A-Z]{2,4}\s*\|\s*/, "")
		.replace(/^[A-Z]{2,4}\s*[-:]\s+/, "")
		.replace(/\s*[[(][A-Z]{2,4}[\])]\s*$/, "")
		.trim();
	return cleaned || name;
}

/** The language tag of a category (`|EN| …`, `… [FR]`), if it has one. */
export function groupTag(name: string) {
	return (
		name.match(/^\|?\s*([A-Z]{2,4})\s*\|/)?.[1] ??
		name.match(/^([A-Z]{2,4})\s*[-:]\s+/)?.[1] ??
		name.match(/[[(]([A-Z]{2,4})[\])]\s*$/)?.[1]
	);
}

/** A category in another language keeps its tag, so two "NETFLIX" rows differ. */
export function labelledGroup(name: string) {
	const tag = groupTag(name);
	const title = displayGroup(name);
	return tag && title !== name ? `${title} · ${tag}` : title;
}

/** Category names that read as the viewer's own language or country. */
const LOCAL_GROUPS: Record<string, RegExp> = {
	nl: /\b(nl|be|vl|vlaams|dutch|nederlands|belg\w*|flemish)\b/i,
	en: /\b(en|uk|us|english)\b/i,
};

/**
 * Films or series as rows, the way streaming services lay them out: what
 * you're watching, what's new, what's rated best, your list, then provider
 * categories (the viewer's language first) and, for series, genres.
 */
export async function iptvBrowseRows(
	backend: IptvBackend,
	input: { kind: "vod" | "series"; locale?: string; rows?: number; size?: number },
): Promise<IptvBrowseRows> {
	const size = Math.min(input.size ?? 20, 40);
	const maxRows = Math.min(input.rows ?? 18, 30);
	const all = await catalogs(backend);
	type Row = { catalog: IptvCatalog; entry: CatalogMovie | CatalogSeries };
	const entries: Row[] = all.flatMap((catalog) =>
		(input.kind === "vod" ? catalog.movies : catalog.series).map((entry) => ({ catalog, entry })),
	);
	const withArt = entries.filter(({ entry }) => entry.poster);
	const pool = withArt.length >= size ? withArt : entries;
	const byAdded = (a: Row, b: Row) => (b.entry.added ?? 0) - (a.entry.added ?? 0);
	// Several language versions of a title: show one per row.
	const distinct = (list: Row[]) => {
		const seen = new Set<string>();
		return list.filter(({ entry }) => {
			const key = `${normalizeSearchText(entry.title)}|${entry.year ?? ""}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	};
	const toMedia = (list: Row[]) =>
		withState(
			backend,
			list.map(({ catalog, entry }) => catalogItem(catalog.source, entry, backend.art)),
		);

	const rows: IptvBrowseRow[] = [];
	const kindOf = (id: string) => parseIptvId(id)?.kind;
	const [continueRows, favoriteRows] = await Promise.all([
		backend.state.list("continue", 60),
		backend.state.list("favorites", 200),
	]);
	const wanted = input.kind === "vod" ? ["vod"] : ["ep", "series"];
	const continuing = continueRows
		.filter(({ id }) => wanted.includes(kindOf(id) ?? ""))
		.map(({ snapshot, state }) => ({ ...snapshot, ...stateFields(state) }));
	if (continuing.length)
		rows.push({
			id: "continue",
			titleKey: "continue",
			items: continuing.slice(0, size),
			filter: {},
		});

	const added = distinct([...pool].sort(byAdded)).slice(0, size);
	rows.push({
		id: "added",
		titleKey: "added",
		items: await toMedia(added),
		filter: { sort: "added" },
	});

	const rated = distinct(
		pool
			// A perfect 10 is usually a placeholder for titles nobody rated yet.
			.filter(({ entry }) => (entry.rating ?? 0) >= 7 && (entry.rating ?? 0) < 9.95)
			.sort((a, b) => (b.entry.rating ?? 0) - (a.entry.rating ?? 0) || byAdded(a, b)),
	).slice(0, size);
	if (rated.length >= 6)
		rows.push({
			id: "rated",
			titleKey: "rated",
			items: await toMedia(rated),
			filter: { sort: "rating" },
		});

	const favorites = favoriteRows
		.filter(({ id }) => kindOf(id) === (input.kind === "vod" ? "vod" : "series"))
		.map(({ snapshot, state }) => ({ ...snapshot, ...stateFields(state) }));
	if (favorites.length)
		rows.push({
			id: "favorites",
			titleKey: "favorites",
			items: favorites.slice(0, size),
			filter: { favorites: true },
		});

	// Categories: the viewer's language first, then the freshest and fullest.
	const local = LOCAL_GROUPS[(input.locale ?? "en").slice(0, 2)] ?? LOCAL_GROUPS.en;
	const groups = new Map<string, Row[]>();
	for (const row of pool) {
		if (!row.entry.group) continue;
		groups.set(row.entry.group, [...(groups.get(row.entry.group) ?? []), row]);
	}
	const rankedGroups = [...groups.entries()]
		.filter(([, list]) => list.length >= 6)
		.map(([name, list]) => ({
			name,
			list,
			local: local?.test(name) ?? false,
			newest: Math.max(...list.map(({ entry }) => entry.added ?? 0)),
		}))
		.sort(
			(a, b) =>
				Number(b.local) - Number(a.local) || b.newest - a.newest || b.list.length - a.list.length,
		);

	// Series also come with genres; mix those in after the first categories.
	const genreRows: { name: string; list: Row[] }[] = [];
	if (input.kind === "series") {
		const genres = new Map<string, Row[]>();
		for (const row of pool) {
			for (const genre of (row.entry as CatalogSeries).genres) {
				const name = genre.trim();
				if (name.length < 3) continue;
				genres.set(name, [...(genres.get(name) ?? []), row]);
			}
		}
		genreRows.push(
			...[...genres.entries()]
				.filter(([, list]) => list.length >= 8)
				.sort((a, b) => b[1].length - a[1].length)
				.slice(0, 8)
				.map(([name, list]) => ({ name, list })),
		);
	}

	const extra: IptvBrowseRow[] = [];
	for (const [index, group] of rankedGroups.entries()) {
		extra.push({
			id: `group:${group.name}`,
			title: group.local ? displayGroup(group.name) : labelledGroup(group.name),
			items: await toMedia(distinct([...group.list].sort(byAdded)).slice(0, size)),
			filter: { group: group.name },
		});
		const genre = index >= 3 ? genreRows.shift() : undefined;
		if (genre)
			extra.push({
				id: `genre:${genre.name}`,
				title: genre.name,
				items: await toMedia(distinct([...genre.list].sort(byAdded)).slice(0, size)),
				filter: { genre: genre.name },
			});
		if (rows.length + extra.length >= maxRows) break;
	}
	rows.push(...extra);

	// The hero wants a wide image: series often have one, films get theirs
	// from the provider's film info.
	const heroPool = added.slice(0, 8);
	const withTimeout = <T>(promise: Promise<T>, ms: number) =>
		Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(resolve, ms))]);
	const candidates = await Promise.all(
		heroPool.map(async ({ catalog, entry }) => {
			if (entry.kind === "series")
				return entry.backdrop ? catalogItem(catalog.source, entry, backend.art) : undefined;
			const info = await withTimeout(
				backend.vodInfo(catalog, entry.pid).catch(() => undefined),
				2500,
			);
			return info?.backdrop
				? movieItem(catalog.source, entry, backend.art, undefined, info)
				: undefined;
		}),
	);
	const hero = candidates.filter((item): item is MediaItem => Boolean(item)).slice(0, 5);
	return { hero: await withState(backend, hero), rows: rows.slice(0, maxRows) };
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

interface IndexedEntry {
	entry: CatalogEntry;
	title: string;
	/** Cast and director of series, searched after titles. */
	people?: string;
}

const searchIndexes = new WeakMap<IptvCatalog, IndexedEntry[]>();

function searchIndex(catalog: IptvCatalog) {
	let index = searchIndexes.get(catalog);
	if (!index) {
		index = catalogEntries(catalog).map((entry) => ({
			entry,
			title: normalizeSearchText(entry.title),
			people:
				entry.kind === "series" && (entry.cast || entry.director)
					? normalizeSearchText(`${entry.cast ?? ""} ${entry.director ?? ""}`)
					: undefined,
		}));
		searchIndexes.set(catalog, index);
	}
	return index;
}

export interface GuideMatch {
	epgId: string;
	programme: EpgProgramme;
	score: number;
}

/** Search titles, series cast and the TV guide of every IPTV source. */
export async function searchIptv(
	backend: IptvBackend,
	rawQuery: string,
	limit = 30,
): Promise<Partial<SearchResults>> {
	const query = prepareQuery(rawQuery);
	if (query.text.length < 2) return {};
	const all = await catalogs(backend);
	type Hit = { catalog: IptvCatalog; entry: CatalogEntry; score: number };
	const hits: Record<IptvBrowseKind, Hit[]> = { live: [], vod: [], series: [] };
	for (const catalog of all) {
		for (const { entry, title, people } of searchIndex(catalog)) {
			let score = scoreText(query, title);
			if (score == null && people) {
				const byPeople = scoreText(query, people);
				score = byPeople == null ? null : byPeople + 3;
			}
			if (score == null) continue;
			const art = entry.kind === "live" ? entry.logo : entry.poster;
			score += (art ? 0 : 0.4) + Math.min(title.length, 80) / 400;
			if (entry.kind === "live" && !entry.epgId) score += 0.2;
			hits[entry.kind].push({ catalog, entry, score });
		}
	}
	// Typo matches only count when nothing matched properly anywhere.
	const exactSomewhere = Object.values(hits).some((list) => list.some((hit) => hit.score < 5));
	// Providers list one title in several language categories; keep the best copy.
	const best = (list: Hit[]) => {
		const seen = new Set<string>();
		return (exactSomewhere ? list.filter((hit) => hit.score < 5) : dropTypoMatches(list))
			.sort((a, b) => a.score - b.score)
			.filter(({ entry }) => {
				if (entry.kind === "live") return true;
				const key = `${normalizeSearchText(entry.title)}|${entry.year ?? ""}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.slice(0, limit);
	};
	const items = (list: Hit[]) =>
		withState(
			backend,
			list.map(({ catalog, entry }) => catalogItem(catalog.source, entry, backend.art)),
		);
	const [channels, movies, series, onTv] = await Promise.all([
		items(best(hits.live)).then(async (list) => {
			// Now/next for the first channels, in one guide request per source.
			const guide = await iptvGuide(
				backend,
				list.slice(0, 12).map((item) => item.id),
			).catch(() => ({}) as Record<string, MediaItem["epg"]>);
			return list.map((item) => (guide[item.id] ? { ...item, epg: guide[item.id] } : item));
		}),
		items(best(hits.vod)),
		items(best(hits.series)),
		searchGuideIptv(backend, all, query),
	]);
	return { channels, movies, series, onTv };
}

/** Programmes on now or later whose title matches, as their channel. */
async function searchGuideIptv(backend: IptvBackend, all: IptvCatalog[], query: PreparedQuery) {
	if (!backend.searchGuide) return [];
	const results: { item: MediaItem; start: number; score: number }[] = [];
	for (const catalog of all) {
		const matches = await backend.searchGuide(catalog, query).catch(() => [] as GuideMatch[]);
		if (!matches.length) continue;
		// Several channels share a guide id (HD, FHD, backup); show the best one.
		const byGuide = new Map<string, CatalogChannel>();
		for (const channel of catalog.channels) {
			if (!channel.epgId) continue;
			const current = byGuide.get(channel.epgId);
			if (!current || (!current.logo && channel.logo)) byGuide.set(channel.epgId, channel);
		}
		for (const match of matches) {
			const channel = byGuide.get(match.epgId);
			if (!channel) continue;
			const item = channelItem(catalog.source, channel, backend.art);
			results.push({
				item: { ...item, airing: match.programme, overview: match.programme.description },
				start: match.programme.start,
				score: match.score,
			});
		}
	}
	return results
		.sort((a, b) => a.score - b.score || a.start - b.start)
		.slice(0, 24)
		.sort((a, b) => a.start - b.start)
		.map(({ item }) => item);
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
		const [guide, schedule] = await Promise.all([
			withEpg(backend, catalog, [channel]),
			channelSchedule(backend, catalog, channel),
		]);
		const item = channelItem(
			catalog.source,
			channel,
			backend.art,
			state,
			guide.get(channel.pid) ?? schedule,
		);
		return detailed(
			{ ...item, schedule: scheduleWithReplays(catalog.source, channel, schedule) },
			{ tags: channel.group ? [channel.group] : [] },
		);
	}
	if (parts.kind === "arc") {
		const replay = splitReplayPid(parts.pid);
		const channel = replay ? findEntry(catalog, "live", replay.channel) : undefined;
		if (!replay || !channel) throw new Error("Unknown recording");
		const schedule = await channelSchedule(backend, catalog, channel);
		const programme = schedule.find((entry) => entry.start === replay.start) ?? {
			title: channel.title,
			start: replay.start,
			end: replay.end,
		};
		return detailed(replayItem(catalog.source, channel, programme, backend.art, state));
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

/** The guide around now: what already aired today and what's still to come. */
async function channelSchedule(
	backend: IptvBackend,
	catalog: IptvCatalog,
	channel: CatalogChannel,
) {
	const programmes = await backend.schedule(catalog, channel).catch(() => [] as EpgProgramme[]);
	const now = Date.now();
	const from = now - 24 * 3600_000;
	const until = now + 18 * 3600_000;
	return programmes.filter((programme) => programme.end > from && programme.start < until);
}

/** Mark the programmes that can be watched back from the provider's archive. */
function scheduleWithReplays(source: string, channel: CatalogChannel, schedule: EpgProgramme[]) {
	const now = Date.now();
	const oldest = now - (channel.archiveDays ?? 0) * 24 * 3600_000;
	return schedule.map((programme) => ({
		title: programme.title,
		start: programme.start,
		end: programme.end,
		description: programme.description,
		replayId:
			channel.archiveDays &&
			programme.start >= oldest &&
			programme.end <= now &&
			programme.archive !== false
				? iptvId(source, "arc", replayPid(channel.pid, programme.start, programme.end))
				: undefined,
	}));
}

/** Titles from the same provider category. */
export async function relatedIptv(backend: IptvBackend, id: string, limit = 12) {
	const { parts, catalog } = await catalogFor(backend, id);
	const kind = parts.kind === "ep" ? "series" : parts.kind === "arc" ? "live" : parts.kind;
	const pid =
		parts.kind === "ep"
			? splitEpisodePid(parts.pid)?.series
			: parts.kind === "arc"
				? splitReplayPid(parts.pid)?.channel
				: parts.pid;
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

/**
 * The next episode of IPTV series you watched recently: after the last
 * finished episode, the first one not watched yet.
 */
export async function iptvNextUp(backend: IptvBackend, limit = 8) {
	const ids = await backend.sourceIds();
	if (!ids.length) return [];
	const history = await backend.state.list("history", 120);
	const latestBySeries = new Map<string, { source: string; series: string; at: number }>();
	for (const { id, state } of history) {
		const parts = parseIptvId(id);
		const episode = parts?.kind === "ep" ? splitEpisodePid(parts.pid) : null;
		if (!parts || !episode || !state.played || !ids.includes(parts.source)) continue;
		const key = `${parts.source}:${episode.series}`;
		if (!latestBySeries.has(key))
			latestBySeries.set(key, {
				source: parts.source,
				series: episode.series,
				at: state.lastPlayedAt ?? 0,
			});
	}
	const picks = [...latestBySeries.values()].sort((a, b) => b.at - a.at).slice(0, limit);
	const results = await Promise.allSettled(
		picks.map(async ({ source, series }) => {
			const catalog = await backend.catalog(source);
			const entry = findEntry(catalog, "series", series);
			if (!entry) return null;
			const info = await backend.seriesInfo(catalog, series);
			const episodeIds = info.episodes.map((episode) =>
				iptvId(source, "ep", episodePid(series, episode.pid)),
			);
			const states = await backend.state.get(episodeIds);
			const lastPlayed = episodeIds.reduce(
				(latest, id, index) => (states.get(id)?.played ? index : latest),
				-1,
			);
			const next = info.episodes[lastPlayed + 1];
			if (!next) return null;
			const nextId = episodeIds[lastPlayed + 1] as string;
			return episodeItem(source, info.series, next, backend.art, states.get(nextId));
		}),
	);
	return results.flatMap((result) =>
		result.status === "fulfilled" && result.value ? [result.value] : [],
	);
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
