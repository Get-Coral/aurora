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
		{ enableStashBuffer: !options.live, liveBufferLatencyChasing: options.live },
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
			player.destroy();
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
