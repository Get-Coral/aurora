import { execFile } from "node:child_process";
import path from "node:path";

/** What Aurora needs to know about a provider file before converting it. */
export interface ProbedMedia {
	video?: { codec: string; pixFmt?: string };
	audio: { index: number; codec: string; channels?: number; language?: string; title?: string }[];
	subtitles: {
		index: number;
		codec: string;
		language?: string;
		title?: string;
		/** Only the lines in another language (signs, foreign dialogue). */
		forced?: boolean;
		/** SDH: also describes sounds, for deaf and hard-of-hearing viewers. */
		hearingImpaired?: boolean;
	}[];
}

/** Subtitle formats ffmpeg can turn into WebVTT (not bitmap ones like PGS). */
const TEXT_SUBTITLES = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);

const cache = new Map<string, { at: number; value: ProbedMedia }>();
const TTL = 6 * 60 * 60 * 1000;

/** ffprobe beside the configured ffmpeg, unless set explicitly. */
export function ffprobeBinary(ffmpeg: string) {
	if (process.env.AURORA_IPTV_FFPROBE) return process.env.AURORA_IPTV_FFPROBE;
	const base = path.basename(ffmpeg);
	return path.join(path.dirname(ffmpeg), base.replace(/ffmpeg/i, "ffprobe"));
}

interface ProbeStream {
	index?: number;
	codec_type?: string;
	codec_name?: string;
	pix_fmt?: string;
	channels?: number;
	tags?: { language?: string; title?: string };
	disposition?: { forced?: number; hearing_impaired?: number };
}

export function parseProbe(output: string): ProbedMedia {
	const streams = ((JSON.parse(output) as { streams?: ProbeStream[] }).streams ?? []).filter(
		(stream) => typeof stream.codec_name === "string",
	);
	const video = streams.find((stream) => stream.codec_type === "video");
	return {
		video: video ? { codec: video.codec_name as string, pixFmt: video.pix_fmt } : undefined,
		audio: streams
			.filter((stream) => stream.codec_type === "audio")
			.map((stream, index) => ({
				index,
				codec: stream.codec_name as string,
				channels: stream.channels,
				language: stream.tags?.language,
				title: stream.tags?.title,
			})),
		subtitles: streams
			.filter((stream) => stream.codec_type === "subtitle")
			.map((stream, index) => ({
				index,
				codec: stream.codec_name as string,
				language: stream.tags?.language,
				title: stream.tags?.title,
				forced: stream.disposition?.forced === 1 || undefined,
				hearingImpaired: stream.disposition?.hearing_impaired === 1 || undefined,
			}))
			.filter((stream) => TEXT_SUBTITLES.has(stream.codec)),
	};
}

/** Read a file's streams without downloading it. Cached per item. */
export function probeIptvMedia(key: string, url: URL, ffmpeg: string): Promise<ProbedMedia> {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.value);
	return new Promise((resolve, reject) => {
		execFile(
			ffprobeBinary(ffmpeg),
			[
				"-v",
				"error",
				"-protocol_whitelist",
				"http,https,tcp,tls,crypto",
				"-user_agent",
				"Aurora IPTV",
				"-show_entries",
				"stream=index,codec_type,codec_name,pix_fmt,channels:stream_disposition=forced,hearing_impaired:stream_tags=language,title",
				"-of",
				"json",
				url.href,
			],
			{ timeout: 20_000, maxBuffer: 1024 * 1024, windowsHide: true },
			(error, stdout) => {
				if (error) return reject(error);
				try {
					const value = parseProbe(stdout);
					cache.set(key, { at: Date.now(), value });
					if (cache.size > 200) cache.delete(cache.keys().next().value as string);
					resolve(value);
				} catch (parseError) {
					reject(parseError);
				}
			},
		);
	});
}

/** Browsers play H.264 in 8-bit 4:2:0 as is; anything else gets converted. */
export function canCopyVideo(media: ProbedMedia | undefined) {
	return (
		media?.video?.codec === "h264" && (!media.video.pixFmt || media.video.pixFmt === "yuv420p")
	);
}

export function canCopyAudio(track: ProbedMedia["audio"][number] | undefined) {
	return track?.codec === "aac" && (track.channels ?? 2) <= 2;
}
