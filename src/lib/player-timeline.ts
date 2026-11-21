/**
 * Pure time math for the player's progress bar, kept out of the component so
 * it can be tested without a <video> element.
 *
 * "Movie time" is the position within the whole film. "Stream time" is
 * `video.currentTime`, which differs from movie time by the offset a
 * progressive transcode was started at (StartTimeTicks).
 */

export interface TimeRangesLike {
	readonly length: number;
	start(index: number): number;
	end(index: number): number;
}

/** Percentage of the bar to fill, always within 0–100. */
export function clampProgress(time: number, duration: number): number {
	if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return 0;
	return Math.max(0, Math.min(100, (time / duration) * 100));
}

/** Where along the bar a pointer is, as a ratio within 0–1. */
export function ratioFromPointer(clientX: number, rect: { left: number; width: number }): number {
	if (!(rect.width > 0)) return 0;
	return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

/**
 * Whether `time` (stream time) is already downloaded. The one-second slack at
 * the end lets a seek to the live edge of the buffer play in place instead of
 * restarting the transcode.
 */
export function isTimeBuffered(buffered: TimeRangesLike, time: number, slack = 1): boolean {
	if (!Number.isFinite(time) || time < 0) return false;
	for (let i = 0; i < buffered.length; i++) {
		if (time >= buffered.start(i) && time <= buffered.end(i) + slack) return true;
	}
	return false;
}

/** Exact runtime in seconds from Jellyfin's RunTimeTicks (100 ns units). */
export function ticksToSeconds(ticks: number | null | undefined): number | undefined {
	if (ticks == null || !Number.isFinite(ticks) || ticks <= 0) return undefined;
	return ticks / 10_000_000;
}

/**
 * The length the bar should represent.
 *
 * Transcoded streams report unreliable durations: Safari's HLS can report
 * Infinity, and a progressive transcode reports only the part after its
 * StartTimeTicks offset, or a length that grows while it downloads. For those
 * Jellyfin's runtime is the truth. A direct-played file knows its own length
 * exactly, so the element wins there.
 */
export function resolveDuration(input: {
	isTranscode: boolean;
	videoDuration: number | null | undefined;
	offset: number;
	runtimeSeconds: number | null | undefined;
}): number {
	const runtime =
		input.runtimeSeconds != null && Number.isFinite(input.runtimeSeconds)
			? input.runtimeSeconds
			: 0;
	const element =
		input.videoDuration != null && Number.isFinite(input.videoDuration) && input.videoDuration > 0
			? input.videoDuration + input.offset
			: 0;

	if (input.isTranscode && runtime > 0) return runtime;
	if (element > 0) return element;
	return runtime;
}

/** Ratio of the film that has been watched, used for the "played" flag. */
export function watchedRatio(position: number, duration: number): number {
	if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return 0;
	return Math.max(0, Math.min(1, position / duration));
}
