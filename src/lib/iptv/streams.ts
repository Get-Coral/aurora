import type { IptvCatalog, SeriesInfo } from "./catalog";
import { findEntry } from "./catalog";
import { type IptvIdParts, splitEpisodePid, splitReplayPid } from "./ids";
import { httpUrl, type StreamFormat, streamFormat } from "./urls";
import { xtreamStreamUrl, xtreamTimeshiftUrl } from "./xtream";

export interface StreamTarget {
	url: URL;
	/** HLS alternative for MPEG-TS channels, when the provider serves both. */
	fallback?: URL;
	format: StreamFormat;
	live: boolean;
	durationSeconds?: number;
}

export interface ResolveOptions {
	/** Prefer HLS for live channels (native apps can't stream raw MPEG-TS). */
	preferHls?: boolean;
	seriesInfo: (seriesPid: string) => Promise<SeriesInfo>;
}

/** Find the upstream URL behind an IPTV item id. */
export async function resolveStream(
	catalog: IptvCatalog,
	parts: IptvIdParts,
	options: ResolveOptions,
): Promise<StreamTarget> {
	const xtream = catalog.xtream;
	if (parts.kind === "live") {
		const channel = findEntry(catalog, "live", parts.pid);
		if (!channel) throw new Error("Unknown channel");
		if (channel.src) {
			const url = httpUrl(channel.src);
			return { url, format: channel.format ?? streamFormat(url, true), live: true };
		}
		if (!xtream) throw new Error("Unknown channel");
		const hlsOnly = xtream.liveExt === "m3u8" || (options.preferHls && xtream.hls);
		const url = xtreamStreamUrl(xtream, "live", channel.pid, hlsOnly ? "m3u8" : "ts");
		return {
			url,
			fallback:
				!hlsOnly && xtream.hls ? xtreamStreamUrl(xtream, "live", channel.pid, "m3u8") : undefined,
			format: hlsOnly ? "hls" : "ts",
			live: true,
		};
	}
	if (parts.kind === "vod") {
		const movie = findEntry(catalog, "vod", parts.pid);
		if (!movie) throw new Error("Unknown title");
		const url = movie.src
			? httpUrl(movie.src)
			: xtream
				? xtreamStreamUrl(xtream, "movie", movie.pid, movie.ext)
				: null;
		if (!url) throw new Error("Unknown title");
		return { url, format: streamFormat(url, false), live: false };
	}
	if (parts.kind === "ep") {
		const ids = splitEpisodePid(parts.pid);
		if (!ids || !xtream) throw new Error("Unknown episode");
		const info = await options.seriesInfo(ids.series);
		const episode = info.episodes.find((candidate) => candidate.pid === ids.episode);
		if (!episode) throw new Error("Unknown episode");
		const url = xtreamStreamUrl(xtream, "series", episode.pid, episode.ext);
		return {
			url,
			format: streamFormat(url, false),
			live: false,
			durationSeconds: episode.durationSeconds,
		};
	}
	if (parts.kind === "arc") {
		const replay = splitReplayPid(parts.pid);
		const channel = replay && findEntry(catalog, "live", replay.channel);
		if (!replay || !channel || !xtream || !channel.archiveDays) throw new Error("No recording");
		const oldest = Date.now() - channel.archiveDays * 24 * 3600_000;
		if (replay.start < oldest || replay.start > Date.now()) throw new Error("No recording");
		const minutes = Math.round((replay.end - replay.start) / 60_000);
		const url = xtreamTimeshiftUrl(xtream, channel.pid, replay.start, minutes);
		return {
			url,
			format: xtream.hls ? "hls" : "ts",
			live: false,
			durationSeconds: minutes * 60,
		};
	}
	throw new Error("Not playable");
}
