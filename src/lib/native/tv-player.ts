/**
 * The native player of the Android TV app (the AuroraPlayer plugin, Media3
 * ExoPlayer). The WebView plays provider files with Chromium's decoders,
 * which leave out Dolby audio (AC3/E-AC3: no sound at all) and let the sound
 * drift away from the picture in some MKV files. On a TV, IPTV films and
 * episodes are handed to the native player instead, which uses the device's
 * own decoders and passes Dolby through to the TV or receiver.
 */
import { getClientPlaybackContext } from "../platform";
import { isNativeShell } from "../runtime-mode";

export interface TvPlayerRequest {
	itemId: string;
	title: string;
	/** Absolute URL the native player can fetch without cookies. */
	url: string;
	/** Where to start, in seconds. */
	positionSeconds: number;
	durationSeconds?: number;
	/** "hls" when the URL is a playlist the player can't tell from its path. */
	format?: "hls" | "ts" | "file";
	/** Tried when the main URL fails. */
	fallbackUrl?: string;
}

export interface TvPlayerResult {
	/** Where the viewer stopped, or null when the player could not tell. */
	positionSeconds: number | null;
	/** The stream's own length when the player learned it, in seconds. */
	durationSeconds: number | null;
	/** The film played to its end. */
	ended: boolean;
	/** Set when the player gave up on the stream. */
	error?: string;
}

interface NativeTvPlayerResult {
	positionMs: number;
	durationMs?: number;
	ended: boolean;
	error?: string;
}

interface AuroraPlayerPlugin {
	open(options: {
		itemId: string;
		title: string;
		url: string;
		positionMs: number;
		durationMs: number;
		format: string;
		fallbackUrl: string;
		userAgent: string;
	}): Promise<NativeTvPlayerResult>;
}

/** The parts of an IPTV session that decide whether the native player takes it. */
export interface TvPlayerCandidate {
	live: boolean;
	format: "hls" | "ts" | "file";
}

/**
 * Films and episodes only: live channels play well in the WebView (hls.js,
 * mpegts.js), and the channel list and zapping live there.
 */
export function shouldUseTvPlayer(session: TvPlayerCandidate) {
	return !session.live && session.format === "file";
}

export function toTvPlayerResult(native: NativeTvPlayerResult): TvPlayerResult {
	const position = Number(native.positionMs);
	const duration = Number(native.durationMs);
	return {
		positionSeconds: Number.isFinite(position) && position >= 0 ? position / 1000 : null,
		durationSeconds: Number.isFinite(duration) && duration > 0 ? duration / 1000 : null,
		ended: native.ended === true,
		...(native.error ? { error: native.error } : {}),
	};
}

// Wrapped in an object: a Capacitor plugin is a proxy that answers every
// property, `then` included, so resolving a promise with it directly makes
// JavaScript treat it as a thenable and call the missing native `then()`.
let plugin: Promise<{ player: AuroraPlayerPlugin } | null> | null = null;

function loadPlugin(): Promise<{ player: AuroraPlayerPlugin } | null> {
	plugin ??= (async () => {
		if (!isNativeShell() || getClientPlaybackContext().platform !== "android-tv") return null;
		const { Capacitor, registerPlugin } = await import("@capacitor/core");
		// App versions from before the native player don't have it.
		if (!Capacitor.isPluginAvailable("AuroraPlayer")) return null;
		return { player: registerPlugin<AuroraPlayerPlugin>("AuroraPlayer") };
	})().catch(() => null);
	return plugin;
}

export async function isTvPlayerAvailable(): Promise<boolean> {
	return (await loadPlugin()) != null;
}

/** Plays the stream full screen and resolves once the viewer is back. */
export async function playInTvPlayer(request: TvPlayerRequest): Promise<TvPlayerResult> {
	const loaded = await loadPlugin();
	if (!loaded) throw new Error("The native player is not available on this device");
	const native = await loaded.player.open({
		itemId: request.itemId,
		title: request.title,
		url: new URL(request.url, window.location.href).toString(),
		positionMs: Math.max(0, Math.round(request.positionSeconds * 1000)),
		durationMs: Math.max(0, Math.round((request.durationSeconds ?? 0) * 1000)),
		format: request.format ?? "",
		fallbackUrl: request.fallbackUrl
			? new URL(request.fallbackUrl, window.location.href).toString()
			: "",
		// Some IPTV providers turn away players they don't know; the native
		// player introduces itself the way the WebView does.
		userAgent: navigator.userAgent,
	});
	return toTvPlayerResult(native);
}
