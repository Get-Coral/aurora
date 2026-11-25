/**
 * Attach a stream to a <video> element with whatever the platform needs:
 * the browser itself, hls.js (HLS without native support) or mpegts.js (raw
 * MPEG-TS live channels). Used by the shared player for IPTV sources.
 */
export type StreamFormat = "hls" | "ts" | "file";
export type PlaybackEngine = "native" | "hls.js" | "mpegts" | "unsupported";

export interface EngineSupport {
	/** `video.canPlayType` result for a MIME type. */
	canPlayType: (type: string) => string;
	/** Media Source Extensions (or Apple's ManagedMediaSource) exist. */
	mse: boolean;
	/**
	 * Apple's own HLS player is the best choice on Apple platforms (and the
	 * only one AirPlay can take over). Elsewhere a browser's built-in HLS, as
	 * in recent Chrome, copes worse with IPTV streams than hls.js.
	 */
	preferNativeHls?: boolean;
}

export function choosePlaybackEngine(format: StreamFormat, support: EngineSupport): PlaybackEngine {
	if (format === "file") return "native";
	if (format === "hls") {
		const native = Boolean(support.canPlayType("application/vnd.apple.mpegurl"));
		if (native && (support.preferNativeHls || !support.mse)) return "native";
		if (support.mse) return "hls.js";
		return native ? "native" : "unsupported";
	}
	if (support.canPlayType("video/mp2t")) return "native";
	return support.mse ? "mpegts" : "unsupported";
}

let probe: HTMLVideoElement | null = null;

export function browserEngineSupport(): EngineSupport {
	if (typeof document === "undefined") return { canPlayType: () => "", mse: false };
	probe ??= document.createElement("video");
	const scope = window as Window & { ManagedMediaSource?: unknown };
	return {
		canPlayType: (type) => probe?.canPlayType(type) ?? "",
		mse: Boolean(window.MediaSource || scope.ManagedMediaSource),
		preferNativeHls: /Apple/.test(navigator.vendor),
	};
}

export interface StreamTrack {
	id: number;
	label: string;
	language?: string;
}

export interface AttachedStream {
	destroy(): void;
	setAudioTrack(id: number): void;
	setSubtitleTrack(id: number | null): void;
}

export interface AttachCallbacks {
	/** Unrecoverable failure; `status` is the HTTP status when known. */
	onFatal(status?: number): void;
	onTracks?(tracks: { audio: StreamTrack[]; subtitles: StreamTrack[] }): void;
}

const noop: AttachedStream = {
	destroy() {},
	setAudioTrack() {},
	setSubtitleTrack() {},
};

function label(track: { name?: string; lang?: string }, index: number) {
	return track.name || track.lang?.toUpperCase() || `Track ${index + 1}`;
}

/**
 * Live MPEG-TS. IPTV providers open a channel with a burst of the last
 * seconds they have buffered, then send in real time. mpegts.js's latency
 * chasing jumps to the newest data whenever more than 1.5 s is buffered, so
 * it skipped through that burst (a dozen jumps in the first seconds) and kept
 * jumping and stalling on half a second of buffer after that. Instead play
 * the burst as a buffer and, only if playback drifts far behind, catch up by
 * playing slightly faster, never by jumping.
 */
export const LIVE_MPEGTS_CONFIG = {
	enableStashBuffer: true,
	lazyLoad: false,
	liveBufferLatencyChasing: false,
	liveSync: true,
	liveSyncMaxLatency: 30,
	liveSyncTargetLatency: 15,
	liveSyncPlaybackRate: 1.05,
	autoCleanupSourceBuffer: true,
} as const;

export async function attachStream(
	video: HTMLVideoElement,
	options: { src: string; format: StreamFormat; live: boolean },
	callbacks: AttachCallbacks,
): Promise<AttachedStream> {
	const engine = choosePlaybackEngine(options.format, browserEngineSupport());
	if (engine === "unsupported") {
		callbacks.onFatal();
		return noop;
	}
	if (engine === "native") {
		if (video.getAttribute("src") !== options.src) video.src = options.src;
		return noop;
	}
	if (engine === "hls.js") {
		const { default: Hls } = await import("hls.js");
		if (!Hls.isSupported()) {
			callbacks.onFatal();
			return noop;
		}
		const hls = new Hls({
			lowLatencyMode: false,
			backBufferLength: options.live ? 30 : 90,
			// Provider manifests and segments are often slow to start.
			manifestLoadingTimeOut: 20_000,
			fragLoadingTimeOut: 30_000,
		});
		const report = () =>
			callbacks.onTracks?.({
				audio: hls.audioTracks.map((track, index) => ({
					id: index,
					label: label(track, index),
					language: track.lang,
				})),
				subtitles: hls.subtitleTracks.map((track, index) => ({
					id: index,
					label: label(track, index),
					language: track.lang,
				})),
			});
		let recoveredMedia = false;
		hls.on(Hls.Events.MANIFEST_PARSED, report);
		hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, report);
		hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, report);
		hls.on(Hls.Events.ERROR, (_event, data) => {
			if (!data.fatal) return;
			if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
				recoveredMedia = true;
				hls.recoverMediaError();
				return;
			}
			callbacks.onFatal(data.response?.code);
		});
		hls.subtitleDisplay = false;
		hls.attachMedia(video);
		hls.loadSource(options.src);
		return {
			destroy: () => hls.destroy(),
			setAudioTrack: (id) => {
				hls.audioTrack = id;
			},
			setSubtitleTrack: (id) => {
				hls.subtitleTrack = id ?? -1;
				hls.subtitleDisplay = id != null;
			},
		};
	}
	const { default: mpegts } = await import("mpegts.js");
	if (!mpegts.getFeatureList().mseLivePlayback) {
		callbacks.onFatal();
		return noop;
	}
	const player = mpegts.createPlayer(
		{ type: "mpegts", isLive: options.live, url: options.src },
		options.live ? LIVE_MPEGTS_CONFIG : {},
	);
	player.on(mpegts.Events.ERROR, (_type: unknown, _detail: unknown, info?: { code?: number }) =>
		callbacks.onFatal(info?.code),
	);
	player.attachMediaElement(video);
	player.load();
	return {
		destroy: () => {
			player.pause();
			player.unload();
			player.detachMediaElement();
			// A source buffer that was still updating fires once more after
			// detaching; destroying right away makes mpegts.js throw on it.
			setTimeout(() => {
				try {
					player.destroy();
				} catch {
					// Already torn down.
				}
			}, 1500);
		},
		setAudioTrack() {},
		setSubtitleTrack() {},
	};
}

/** Add or replace the `start` offset (seconds) on an Aurora IPTV stream URL. */
export function withStartOffset(streamUrl: string, seconds: number) {
	const url = new URL(streamUrl, "http://aurora.local");
	if (seconds > 0) url.searchParams.set("start", String(Math.floor(seconds)));
	else url.searchParams.delete("start");
	return url.origin === "http://aurora.local" ? url.pathname + url.search : url.href;
}

/** Set or clear query parameters on an Aurora IPTV stream URL. */
export function withStreamParams(
	streamUrl: string,
	params: Record<string, string | number | null>,
) {
	const url = new URL(streamUrl, "http://aurora.local");
	for (const [key, value] of Object.entries(params)) {
		if (value == null) url.searchParams.delete(key);
		else url.searchParams.set(key, String(value));
	}
	return url.origin === "http://aurora.local" ? url.pathname + url.search : url.href;
}

/** ISO 639-2/B codes that Intl doesn't know, mapped to their usual tags. */
const BIBLIOGRAPHIC: Record<string, string> = {
	ger: "de",
	dut: "nl",
	fre: "fr",
	chi: "zh",
	cze: "cs",
	gre: "el",
	per: "fa",
	rum: "ro",
	slo: "sk",
	alb: "sq",
	arm: "hy",
	baq: "eu",
	bur: "my",
	geo: "ka",
	ice: "is",
	mac: "mk",
	mao: "mi",
	may: "ms",
	tib: "bo",
	wel: "cy",
};

/**
 * Number labels that would read the same ("English", "English 2"): files often
 * carry several subtitle tracks in one language without saying how they differ.
 */
export function distinctLabels(labels: string[]) {
	const totals = new Map<string, number>();
	for (const label of labels) totals.set(label, (totals.get(label) ?? 0) + 1);
	const seen = new Map<string, number>();
	return labels.map((label) => {
		if ((totals.get(label) ?? 0) < 2) return label;
		const count = (seen.get(label) ?? 0) + 1;
		seen.set(label, count);
		return count === 1 ? label : `${label} ${count}`;
	});
}

/** "Dutch", "English (Director's commentary)", or the track title. */
export function trackLabel(
	track: { language?: string; title?: string },
	locale: string,
	fallback: string,
) {
	const code = track.language?.toLowerCase();
	let language: string | undefined;
	if (code && code !== "und") {
		try {
			language =
				new Intl.DisplayNames([locale], { type: "language" }).of(BIBLIOGRAPHIC[code] ?? code) ??
				undefined;
		} catch {
			language = code.toUpperCase();
		}
	}
	const title = track.title?.trim();
	if (language && title && !title.toLowerCase().includes(language.toLowerCase()))
		return `${language} (${title})`;
	return language ?? title ?? fallback;
}
