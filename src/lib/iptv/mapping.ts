import type { DetailedMediaItem, MediaItem, MediaPerson, SeriesDetailPayload } from "../media";
import type {
	CatalogChannel,
	CatalogEntry,
	CatalogEpisode,
	CatalogMovie,
	CatalogSeries,
	EpgProgramme,
	SeriesInfo,
	VodInfo,
} from "./catalog";
import { episodePid, iptvId } from "./ids";

export type ArtworkSlot = "poster" | "backdrop" | "logo" | "still";

/** Turns a provider artwork URL into one the browser may load (or undefined). */
export type ArtworkResolver = (raw: string | undefined, slot: ArtworkSlot) => string | undefined;

/** Per-user playback state for an IPTV item. */
export interface IptvItemState {
	positionTicks?: number;
	durationTicks?: number;
	played?: boolean;
	favorite?: boolean;
	lastPlayedAt?: number;
}

export type StateLookup = (id: string) => IptvItemState | undefined;

export function entryId(source: string, entry: CatalogEntry) {
	return iptvId(source, entry.kind, entry.pid);
}

function applyState(item: MediaItem, state: IptvItemState | undefined): MediaItem {
	if (!state) return item;
	const progress =
		state.positionTicks && state.durationTicks
			? Math.min(100, Math.round((state.positionTicks / state.durationTicks) * 100))
			: undefined;
	return {
		...item,
		isFavorite: Boolean(state.favorite),
		played: Boolean(state.played),
		playbackPositionTicks: state.positionTicks || undefined,
		progress: progress || undefined,
		watchedAt: state.lastPlayedAt ? new Date(state.lastPlayedAt).toISOString() : undefined,
	};
}

function channelProgrammes(epg: EpgProgramme[] | undefined, now = Date.now()) {
	if (!epg?.length) return undefined;
	const index = epg.findIndex((programme) => programme.end > now);
	if (index < 0) return undefined;
	const current = epg[index];
	const onNow = current && current.start <= now ? current : undefined;
	const next = onNow ? epg[index + 1] : current;
	return onNow || next ? { now: onNow, next } : undefined;
}

export function channelItem(
	source: string,
	entry: CatalogChannel,
	art: ArtworkResolver,
	state?: IptvItemState,
	epg?: EpgProgramme[],
): MediaItem {
	const id = entryId(source, entry);
	const logo = art(entry.logo, "logo");
	return applyState(
		{
			id,
			source: "iptv",
			type: "channel",
			title: entry.title,
			genres: entry.group ? [entry.group] : [],
			group: entry.group || undefined,
			channelNumber: entry.number,
			posterUrl: logo,
			logoUrl: logo,
			live: true,
			streamUrl: id,
			epg: channelProgrammes(epg),
			overview: channelProgrammes(epg)?.now?.description,
		},
		state,
	);
}

export function movieItem(
	source: string,
	entry: CatalogMovie,
	art: ArtworkResolver,
	state?: IptvItemState,
	info?: VodInfo,
): MediaItem {
	const id = entryId(source, entry);
	return applyState(
		{
			id,
			source: "iptv",
			type: "movie",
			title: entry.title,
			year: info?.year ?? entry.year,
			rating: info?.rating ?? entry.rating,
			ageRating: info?.ageRating,
			overview: info?.plot,
			runtimeMinutes: info?.durationSeconds ? Math.round(info.durationSeconds / 60) : undefined,
			genres: info?.genres.length ? info.genres : entry.group ? [entry.group] : [],
			group: entry.group || undefined,
			posterUrl: art(info?.poster ?? entry.poster, "poster"),
			backdropUrl: art(info?.backdrop, "backdrop"),
			streamUrl: id,
		},
		state,
	);
}

export function seriesItem(
	source: string,
	entry: CatalogSeries,
	art: ArtworkResolver,
	state?: IptvItemState,
): MediaItem {
	return applyState(
		{
			id: entryId(source, entry),
			source: "iptv",
			type: "series",
			title: entry.title,
			year: entry.year,
			rating: entry.rating,
			overview: entry.plot,
			genres: entry.genres.length ? entry.genres : entry.group ? [entry.group] : [],
			group: entry.group || undefined,
			posterUrl: art(entry.poster, "poster"),
			backdropUrl: art(entry.backdrop, "backdrop"),
		},
		state,
	);
}

export function episodeItem(
	source: string,
	series: CatalogSeries,
	episode: CatalogEpisode,
	art: ArtworkResolver,
	state?: IptvItemState,
): MediaItem {
	const id = iptvId(source, "ep", episodePid(series.pid, episode.pid));
	const still = art(episode.still, "still");
	return applyState(
		{
			id,
			source: "iptv",
			type: "episode",
			title: episode.title,
			seriesTitle: series.title,
			seasonNumber: episode.season,
			episodeNumber: episode.episode,
			overview: episode.plot,
			rating: episode.rating,
			year: episode.airDate ? Number(episode.airDate.slice(0, 4)) || undefined : undefined,
			runtimeMinutes: episode.durationSeconds
				? Math.round(episode.durationSeconds / 60)
				: undefined,
			genres: series.genres,
			thumbUrl: still,
			backdropUrl: still ?? art(series.backdrop, "backdrop"),
			posterUrl: art(series.poster, "poster"),
			streamUrl: id,
		},
		state,
	);
}

export function catalogItem(
	source: string,
	entry: CatalogEntry,
	art: ArtworkResolver,
	state?: StateLookup,
	epg?: (entry: CatalogChannel) => EpgProgramme[] | undefined,
): MediaItem {
	const id = entryId(source, entry);
	if (entry.kind === "live") return channelItem(source, entry, art, state?.(id), epg?.(entry));
	if (entry.kind === "vod") return movieItem(source, entry, art, state?.(id));
	return seriesItem(source, entry, art, state?.(id));
}

function people(names: string[] | string | undefined, role: string): MediaPerson[] {
	const list = Array.isArray(names) ? names : names ? names.split(/\s*,\s*/) : [];
	return list
		.filter(Boolean)
		.slice(0, 12)
		.map((name) => ({
			id: `iptv-person-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
			name,
			role,
		}));
}

export function detailed(item: MediaItem, extra?: Partial<DetailedMediaItem>): DetailedMediaItem {
	return { ...item, cast: [], studios: [], tags: [], ...extra };
}

export function movieDetails(
	source: string,
	entry: CatalogMovie,
	info: VodInfo | undefined,
	art: ArtworkResolver,
	state?: IptvItemState,
): DetailedMediaItem {
	return detailed(movieItem(source, entry, art, state, info), {
		cast: [...people(info?.director, "Director"), ...people(info?.cast, "Actor")],
		tags: [entry.group, info?.country].filter((tag): tag is string => Boolean(tag)),
	});
}

export function seriesDetails(
	source: string,
	info: SeriesInfo,
	art: ArtworkResolver,
	state: StateLookup,
	similar: MediaItem[],
): SeriesDetailPayload {
	const item = detailed(seriesItem(source, info.series, art, state(entryId(source, info.series))), {
		cast: [...people(info.series.director, "Director"), ...people(info.series.cast, "Actor")],
		tags: info.series.group ? [info.series.group] : [],
	});
	const episodes = info.episodes.map((episode) =>
		episodeItem(
			source,
			info.series,
			episode,
			art,
			state(iptvId(source, "ep", episodePid(info.series.pid, episode.pid))),
		),
	);
	// Next up: the episode in progress, else the first one not yet watched.
	const inProgress = episodes.find((episode) => !episode.played && episode.playbackPositionTicks);
	const lastPlayed = episodes.reduce(
		(latest, episode, index) => (episode.played ? index : latest),
		-1,
	);
	const next = inProgress ?? episodes[lastPlayed + 1];
	return { item, episodes, nextUp: next ? [next] : [], similar };
}
