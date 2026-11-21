import {
	type CatalogChannel,
	type CatalogEpisode,
	type CatalogMovie,
	type CatalogSeries,
	cleanTitle,
	type EpgProgramme,
	type IptvAccount,
	parseEpoch,
	parseNumber,
	type SeriesInfo,
	splitList,
	tidyGuide,
	type VodInfo,
	type XtreamCatalogConfig,
} from "./catalog";
import { artworkSource, type XtreamConfig } from "./urls";

/** Fetches a provider URL and returns its parsed JSON. */
export type JsonFetcher = (url: URL) => Promise<unknown>;

type XtreamRow = Record<string, unknown>;

function rows(value: unknown): XtreamRow[] {
	if (!Array.isArray(value)) throw new Error("Invalid Xtream catalog");
	return value.filter((item): item is XtreamRow => item !== null && typeof item === "object");
}

function text(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}

function pidOf(value: unknown) {
	const id = String(value ?? "");
	return /^\d+$/.test(id) ? id : null;
}

export function xtreamApi(config: XtreamConfig, action?: string, params?: Record<string, string>) {
	const url = new URL("player_api.php", config.server);
	url.search = new URLSearchParams({
		username: config.username,
		password: config.password,
		...(action ? { action } : {}),
		...params,
	}).toString();
	return url;
}

export function xtreamStreamUrl(
	config: XtreamConfig,
	kind: "live" | "movie" | "series",
	pid: string,
	ext: string,
) {
	if (!/^\d+$/.test(pid) || !/^[a-z0-9]+$/i.test(ext)) throw new Error("Invalid Xtream stream");
	const credentials = [config.username, config.password].map(encodeURIComponent).join("/");
	return new URL(`${kind}/${credentials}/${pid}.${ext}`, config.server);
}

/** The extended M3U download of an Xtream account. */
export function xtreamPlaylistUrl(config: XtreamConfig) {
	const url = new URL("get.php", config.server);
	url.search = new URLSearchParams({
		username: config.username,
		password: config.password,
		type: "m3u_plus",
		output: "ts",
	}).toString();
	return url;
}

export function xtreamXmltvUrl(config: XtreamConfig) {
	const url = new URL("xmltv.php", config.server);
	url.search = new URLSearchParams({
		username: config.username,
		password: config.password,
	}).toString();
	return url;
}

export async function xtreamAccount(config: XtreamConfig, fetchJson: JsonFetcher) {
	const account = (await fetchJson(xtreamApi(config))) as {
		user_info?: XtreamRow & { auth?: number | string; allowed_output_formats?: unknown };
		server_info?: XtreamRow;
	} | null;
	const user = account?.user_info;
	if (String(user?.auth) !== "1") throw new Error("Xtream sign-in failed");
	const formats = Array.isArray(user?.allowed_output_formats)
		? (user.allowed_output_formats as unknown[]).map(String)
		: [];
	const hls = formats.includes("m3u8");
	const liveExt: "ts" | "m3u8" = formats.length && !formats.includes("ts") && hls ? "m3u8" : "ts";
	const timezone = text(account?.server_info?.timezone);
	return {
		xtream: {
			...config,
			liveExt,
			hls,
			timezone: timezone && validTimezone(timezone) ? timezone : undefined,
		} satisfies XtreamCatalogConfig,
		account: {
			status: text(user?.status) || undefined,
			expiresAt: parseEpoch(user?.exp_date),
			maxConnections: parseNumber(user?.max_connections),
			activeConnections: parseNumber(user?.active_cons),
			trial: String(user?.is_trial) === "1",
		} satisfies IptvAccount,
	};
}

function validTimezone(zone: string) {
	try {
		new Intl.DateTimeFormat("en", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

const ADULT_GROUP = /\b(xxx|adults?|18\+|porn|erotic)\b/i;

function isAdult(row: XtreamRow, groups: Map<string, string>) {
	return (
		String(row.is_adult) === "1" ||
		ADULT_GROUP.test(groups.get(String(row.category_id)) ?? "") ||
		undefined
	);
}

function categoryNames(categories: XtreamRow[]) {
	return new Map(categories.map((row) => [String(row.category_id), text(row.category_name)]));
}

export async function loadXtreamCatalog(config: XtreamConfig, fetchJson: JsonFetcher) {
	const { xtream, account } = await xtreamAccount(config, fetchJson);
	const get = (action: string) => fetchJson(xtreamApi(config, action)).then(rows);
	const optional = (action: string) => get(action).catch(() => [] as XtreamRow[]);
	const [live, liveGroups, movies, movieGroups, series, seriesGroups] = await Promise.all([
		get("get_live_streams"),
		optional("get_live_categories"),
		optional("get_vod_streams"),
		optional("get_vod_categories"),
		optional("get_series"),
		optional("get_series_categories"),
	]);

	const liveNames = categoryNames(liveGroups);
	const channels = live.flatMap((row): CatalogChannel[] => {
		const pid = pidOf(row.stream_id);
		const name = text(row.name);
		if (!pid || !name) return [];
		return [
			{
				kind: "live",
				pid,
				title: cleanTitle(name).title,
				group: liveNames.get(String(row.category_id)) ?? "",
				number: parseNumber(row.num),
				logo: artworkSource(row.stream_icon),
				epgId: text(row.epg_channel_id) || undefined,
				added: parseEpoch(row.added),
				adult: isAdult(row, liveNames),
				archiveDays:
					String(row.tv_archive) === "1"
						? Math.max(1, parseNumber(row.tv_archive_duration) ?? 1)
						: undefined,
			},
		];
	});

	const movieNames = categoryNames(movieGroups);
	const movieEntries = movies.flatMap((row): CatalogMovie[] => {
		const pid = pidOf(row.stream_id);
		const ext = text(row.container_extension) || "mp4";
		if (!pid || !text(row.name) || !/^[a-z0-9]+$/i.test(ext)) return [];
		const { title, year } = cleanTitle(text(row.name));
		const rating = parseNumber(row.rating);
		return [
			{
				kind: "vod",
				pid,
				title,
				year,
				group: movieNames.get(String(row.category_id)) ?? "",
				poster: artworkSource(row.stream_icon),
				rating: rating ? rating : undefined,
				ext: ext.toLowerCase(),
				added: parseEpoch(row.added),
				adult: isAdult(row, movieNames),
			},
		];
	});

	const seriesNames = categoryNames(seriesGroups);
	const seriesEntries = series.flatMap((row): CatalogSeries[] => {
		const pid = pidOf(row.series_id);
		if (!pid || !text(row.name)) return [];
		const cleaned = cleanTitle(text(row.name));
		const released = text(row.releaseDate) || text(row.release_date);
		const rating = parseNumber(row.rating);
		return [
			{
				kind: "series",
				pid,
				title: cleaned.title,
				year: cleaned.year ?? (parseNumber(released.slice(0, 4)) || undefined),
				group: seriesNames.get(String(row.category_id)) ?? "",
				poster: artworkSource(row.cover),
				backdrop: Array.isArray(row.backdrop_path)
					? artworkSource(row.backdrop_path[0])
					: undefined,
				plot: text(row.plot) || undefined,
				genres: splitList(row.genre),
				rating: rating ? rating : undefined,
				cast: text(row.cast) || undefined,
				director: text(row.director) || undefined,
				added: parseEpoch(row.last_modified),
				adult: isAdult(row, seriesNames),
			},
		];
	});

	return { xtream, account, channels, movies: movieEntries, series: seriesEntries };
}

export async function getVodInfo(
	config: XtreamConfig,
	fetchJson: JsonFetcher,
	pid: string,
): Promise<VodInfo> {
	const data = (await fetchJson(xtreamApi(config, "get_vod_info", { vod_id: pid }))) as {
		info?: XtreamRow;
	} | null;
	const info = data?.info && typeof data.info === "object" ? data.info : {};
	const released = text(info.releasedate) || text(info.release_date);
	// Some panels fill duration_secs wrongly; the clock string is the fallback.
	const duration = Math.max(parseNumber(info.duration_secs) ?? 0, clockSeconds(info.duration));
	const rating = parseNumber(info.rating);
	return {
		plot: text(info.plot) || text(info.description) || undefined,
		cast: splitList(text(info.cast) || text(info.actors)).filter((name) => !name.includes("/")),
		director: text(info.director) || undefined,
		genres: splitList(info.genre),
		rating: rating ? rating : undefined,
		year: parseNumber(released.slice(0, 4)) || undefined,
		durationSeconds: duration && duration > 0 ? duration : undefined,
		poster: artworkSource(info.cover_big) ?? artworkSource(info.movie_image),
		backdrop: Array.isArray(info.backdrop_path) ? artworkSource(info.backdrop_path[0]) : undefined,
		country: text(info.country) || undefined,
		ageRating: text(info.mpaa_rating) || text(info.age) || undefined,
	};
}

export async function getSeriesInfo(
	config: XtreamConfig,
	fetchJson: JsonFetcher,
	series: CatalogSeries,
): Promise<SeriesInfo> {
	const data = (await fetchJson(
		xtreamApi(config, "get_series_info", { series_id: series.pid }),
	)) as { info?: XtreamRow; episodes?: unknown } | null;
	const info = data?.info && typeof data.info === "object" ? data.info : {};
	const groups =
		data?.episodes && typeof data.episodes === "object"
			? Object.entries(data.episodes as Record<string, unknown>)
			: [];
	const episodes = groups.flatMap(([season, list]) =>
		(Array.isArray(list) ? rows(list) : []).flatMap((row): CatalogEpisode[] => {
			const pid = pidOf(row.id);
			const ext = text(row.container_extension) || "mp4";
			if (!pid || !/^[a-z0-9]+$/i.test(ext)) return [];
			const details = (row.info && typeof row.info === "object" ? row.info : {}) as XtreamRow;
			const seasonNumber = parseNumber(row.season) ?? parseNumber(season) ?? 1;
			const episodeNumber = parseNumber(row.episode_num) ?? 0;
			const rawTitle = text(row.title);
			const title =
				rawTitle.match(/S\d+E\d+\s*-\s*(.+)$/i)?.[1]?.trim() ||
				rawTitle ||
				`Episode ${episodeNumber}`;
			const duration = Math.max(
				parseNumber(details.duration_secs) ?? 0,
				clockSeconds(details.duration),
			);
			const rating = parseNumber(details.rating);
			return [
				{
					pid,
					season: seasonNumber,
					episode: episodeNumber,
					title,
					plot: text(details.plot) || undefined,
					still: artworkSource(details.movie_image),
					durationSeconds: duration && duration > 0 ? duration : undefined,
					ext: ext.toLowerCase(),
					airDate: text(details.air_date) || text(details.releasedate) || undefined,
					rating: rating ? rating : undefined,
				},
			];
		}),
	);
	episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
	const rating = parseNumber(info.rating);
	return {
		series: {
			...series,
			plot: text(info.plot) || series.plot,
			poster: artworkSource(info.cover) ?? series.poster,
			backdrop: Array.isArray(info.backdrop_path)
				? (artworkSource(info.backdrop_path[0]) ?? series.backdrop)
				: series.backdrop,
			genres: splitList(info.genre).length ? splitList(info.genre) : series.genres,
			cast: text(info.cast) || series.cast,
			director: text(info.director) || series.director,
			rating: rating ? rating : series.rating,
		},
		episodes,
	};
}

/** `01:51:45` → 6705. */
export function clockSeconds(value: unknown) {
	const match = typeof value === "string" ? value.trim().match(/^(\d+):(\d{2}):(\d{2})$/) : null;
	return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}

function decodeBase64(value: unknown) {
	const raw = text(value);
	if (!raw) return "";
	try {
		const binary = atob(raw);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		return new TextDecoder().decode(bytes).trim();
	} catch {
		return raw;
	}
}

export async function getShortEpg(
	config: XtreamConfig,
	fetchJson: JsonFetcher,
	pid: string,
	limit = 4,
): Promise<EpgProgramme[]> {
	const data = (await fetchJson(
		xtreamApi(config, "get_short_epg", { stream_id: pid, limit: String(limit * 2) }),
	)) as { epg_listings?: unknown } | null;
	const listings = Array.isArray(data?.epg_listings) ? rows(data.epg_listings) : [];
	return tidyGuide(
		listings.flatMap((row): EpgProgramme[] => {
			const start = parseEpoch(row.start_timestamp);
			const end = parseEpoch(row.stop_timestamp);
			const title = decodeBase64(row.title);
			if (!start || !end || end <= start || !title) return [];
			return [{ title, start, end, description: decodeBase64(row.description) || undefined }];
		}),
	);
}

/** A channel's full guide (several days, earlier programmes included). */
export async function getChannelSchedule(
	config: XtreamConfig,
	fetchJson: JsonFetcher,
	pid: string,
): Promise<EpgProgramme[]> {
	const data = (await fetchJson(
		xtreamApi(config, "get_simple_data_table", { stream_id: pid }),
	)) as { epg_listings?: unknown } | null;
	const listings = Array.isArray(data?.epg_listings) ? rows(data.epg_listings) : [];
	return tidyGuide(
		listings.flatMap((row): EpgProgramme[] => {
			const start = parseEpoch(row.start_timestamp);
			const end = parseEpoch(row.stop_timestamp);
			const title = decodeBase64(row.title);
			if (!start || !end || end <= start || !title) return [];
			return [
				{
					title,
					start,
					end,
					description: decodeBase64(row.description).slice(0, 320) || undefined,
					archive: String(row.has_archive) === "1" || undefined,
				},
			];
		}),
	);
}

/** `YYYY-MM-DD:HH-mm` in the panel's own time zone, as timeshift URLs expect. */
export function timeshiftStart(time: number, timeZone = "UTC") {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-GB", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(new Date(time))
			.map((part) => [part.type, part.value]),
	);
	return `${parts.year}-${parts.month}-${parts.day}:${parts.hour}-${parts.minute}`;
}

export function xtreamTimeshiftUrl(
	config: XtreamCatalogConfig,
	pid: string,
	start: number,
	minutes: number,
) {
	if (!/^\d+$/.test(pid)) throw new Error("Invalid Xtream stream");
	const credentials = [config.username, config.password].map(encodeURIComponent).join("/");
	const ext = config.hls ? "m3u8" : "ts";
	return new URL(
		`timeshift/${credentials}/${minutes}/${timeshiftStart(start, config.timezone)}/${pid}.${ext}`,
		config.server,
	);
}
