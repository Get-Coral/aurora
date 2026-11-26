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

/** Audio every browser decodes in an MP4 or WebM. */
const BROWSER_AUDIO = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);
/** Dolby Digital (Plus): Safari and some TVs decode it, Chrome and Firefox don't. */
const DOLBY_AUDIO = new Set(["ac3", "eac3"]);

/**
 * Whether the browser can play a file's audio as it is. Without an audio
 * track there is nothing to convert; an unknown codec is converted to be safe.
 */
export function browserCanPlayAudio(codec: string | undefined, options: { dolby: boolean }) {
	if (!codec) return true;
	return BROWSER_AUDIO.has(codec) || (options.dolby && DOLBY_AUDIO.has(codec));
}

const keyframes = new Map<string, number>();

/** The first video packet's time in ffprobe CSV output (`pts_time,flags`), if it is a keyframe. */
export function parseKeyframe(output: string): number | undefined {
	const [time, flags] = output.trim().split("\n")[0]?.split(",") ?? [];
	const seconds = Number(time);
	return Number.isFinite(seconds) && seconds >= 0 && flags?.startsWith("K") ? seconds : undefined;
}

/**
 * The keyframe a conversion that seeks to `seconds` really starts at. Copied
 * video can only begin on a keyframe, so the player uses this as its clock's
 * start instead of the time asked for; otherwise the bar, the resume point and
 * embedded subtitles are off by up to a keyframe interval. Reads the file's
 * index and one packet. Cached per item and second.
 */
export function keyframeAt(
	key: string,
	url: URL,
	ffmpeg: string,
	seconds: number,
): Promise<number> {
	const cacheKey = `${key}@${seconds}`;
	const hit = keyframes.get(cacheKey);
	if (hit != null) return Promise.resolve(hit);
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
				"-read_intervals",
				`${seconds}%+#1`,
				"-select_streams",
				"v:0",
				"-show_entries",
				"packet=pts_time,flags",
				"-of",
				"csv=p=0",
				url.href,
			],
			{ timeout: 15_000, maxBuffer: 64 * 1024, windowsHide: true },
			(error, stdout) => {
				if (error) return reject(error);
				const keyframe = parseKeyframe(stdout);
				if (keyframe == null) return reject(new Error("No keyframe"));
				keyframes.set(cacheKey, keyframe);
				if (keyframes.size > 500) keyframes.delete(keyframes.keys().next().value as string);
				resolve(keyframe);
			},
		);
	});
}
