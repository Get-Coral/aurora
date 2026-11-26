import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

let active: ChildProcess | undefined;

export interface TranscodePlan {
	/** Seconds into the file to start from (seeking uses range requests). */
	start: number;
	/** H.264 the browser can play: repackage instead of re-encoding. */
	copyVideo: boolean;
	/** Which audio stream (0-based among audio streams). */
	audioIndex: number;
	copyAudio: boolean;
	/** Text subtitles to write as WebVTT next to the video. */
	subtitles: { index: number; file: string }[];
}

const SUBTITLE_DIR = path.join(os.tmpdir(), "aurora-iptv-subtitles");

/** Where the subtitles of the running conversion are written. */
export function subtitleFile(key: string, index: number) {
	return path.join(SUBTITLE_DIR, `${key}-${index}.vtt`);
}

/**
 * Convert a provider file (MKV, AVI, or an MP4 needing another audio track)
 * to fragmented MP4 the browser can play. One conversion runs per Aurora
 * process — most IPTV accounts allow a single connection anyway — and a new
 * request (a seek, another title) replaces the running one.
 *
 * H.264 video is repackaged rather than re-encoded, which costs next to no
 * CPU and keeps the original quality. Text subtitles are written as WebVTT by
 * the same process, so they need no extra connection to the provider.
 */
/** Seconds with millisecond precision: a keyframe rarely sits on a whole second. */
export function startSeconds(value: number) {
	return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) / 1000 : 0;
}

/**
 * How far past `start` a seek with copied video aims. The player asks for the
 * keyframe's own time (see keyframeAt), but some containers (MKV with
 * B-frames) store that keyframe a little later, and ffmpeg then lands on the
 * keyframe before: seconds off. Aiming a moment past it lands on it, as long
 * as keyframes are further apart than this.
 */
const KEYFRAME_SEEK_MARGIN = 0.3;

/** The ffmpeg arguments for one conversion (see transcodeIptv). */
export function transcodeArgs(source: URL, plan: TranscodePlan) {
	const start = startSeconds(plan.start);
	const seek = start > 0 && plan.copyVideo ? startSeconds(start + KEYFRAME_SEEK_MARGIN) : start;
	const subtitleOutputs = plan.subtitles.flatMap((subtitle) => [
		"-map",
		`0:s:${subtitle.index}`,
		"-c:s",
		"webvtt",
		// Cue times count from the start of the film, not from the seek
		// (ffmpeg counts every output's time from the seek).
		"-output_ts_offset",
		String(seek),
		"-flush_packets",
		"1",
		"-f",
		"webvtt",
		subtitle.file,
	]);
	// From the very start, copied video with B-frames shows its first picture a
	// frame or two late (an MP4 would hide that with an edit list, which a
	// streamed fragmented MP4 can't carry), so the sound ran ~60 ms ahead.
	// Starting the video's timestamps at zero, with negative composition
	// offsets allowed, lines the two up. After a seek the keyframe start below
	// already does.
	const alignFromZero = start === 0 && plan.copyVideo;
	return [
		"-hide_banner",
		"-loglevel",
		"error",
		"-protocol_whitelist",
		"http,https,tcp,tls,crypto",
		"-user_agent",
		"Aurora IPTV",
		...(start > 0 ? ["-ss", String(seek)] : []),
		// Copied video can only start on a keyframe, at or before `start`.
		// Start the audio there too: cut exactly at `start`, it would begin
		// seconds later than the picture, and browsers play that gap away
		// instead of waiting, so the sound drifts off the picture.
		...(start > 0 && plan.copyVideo ? ["-noaccurate_seek"] : []),
		"-i",
		source.href,
		"-map",
		"0:v:0",
		"-map",
		`0:a:${plan.audioIndex}?`,
		...(plan.copyVideo
			? ["-c:v", "copy"]
			: [
					"-c:v",
					"libx264",
					"-preset",
					"ultrafast",
					"-pix_fmt",
					"yuv420p",
					"-vf",
					"scale=w='min(1920,iw)':h=-2",
					"-g",
					"48",
				]),
		...(alignFromZero ? ["-bsf:v", "setts=pts=PTS-STARTPTS:dts=DTS-STARTDTS"] : []),
		"-threads",
		"2",
		...(plan.copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-ac", "2"]),
		"-movflags",
		alignFromZero
			? "frag_keyframe+empty_moov+default_base_moof+negative_cts_offsets"
			: "frag_keyframe+empty_moov+default_base_moof",
		"-f",
		"mp4",
		"pipe:1",
		...subtitleOutputs,
	];
}

/** Stop the running conversion: the provider allows only one connection. */
export function stopTranscode() {
	active?.kill("SIGKILL");
	active = undefined;
}

export async function transcodeIptv(
	source: URL,
	binary: string,
	signal: AbortSignal,
	plan: TranscodePlan,
) {
	stopTranscode();
	rmSync(SUBTITLE_DIR, { recursive: true, force: true });
	if (plan.subtitles.length) mkdirSync(SUBTITLE_DIR, { recursive: true });
	const child = spawn(binary, transcodeArgs(source, plan), {
		stdio: ["ignore", "pipe", "ignore"],
		windowsHide: true,
	});
	active = child;
	const stop = () => child.kill("SIGKILL");
	child.once("close", () => {
		if (active === child) active = undefined;
		signal.removeEventListener("abort", stop);
	});
	signal.addEventListener("abort", stop, { once: true });
	if (signal.aborted) stop();

	const reader = Readable.toWeb(
		child.stdout,
	).getReader() as ReadableStreamDefaultReader<Uint8Array>;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const chunk = await reader.read();
			if (chunk.done) controller.close();
			else controller.enqueue(chunk.value);
		},
		async cancel() {
			stop();
			await reader.cancel();
		},
	});
}
