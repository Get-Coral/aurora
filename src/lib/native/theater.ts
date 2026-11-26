/**
 * The Quest theater: a native, immersive player (Meta Spatial SDK) that the
 * Quest build of the Android app ships as the AuroraTheater plugin. It plays
 * anything the panel player does: Jellyfin titles, IPTV films and series, and
 * live channels. The web player hands the stream over, the headset switches to a 3D room with a big
 * screen, and the position comes back when the viewer returns to the panel.
 */
import { getClientPlaybackContext } from "../platform";
import { isNativeShell } from "../runtime-mode";
import { nativeArtworkUrl } from "./artwork";

export type TheaterEnvironment = "aurora" | "dark" | "passthrough";

export interface TheaterRequest {
	itemId: string;
	title: string;
	/** Absolute URL the native player can fetch without cookies. */
	url: string;
	/** Where the viewer is in the film, in seconds. */
	positionSeconds: number;
	/**
	 * Film time at which the stream starts. A transcode resumed with
	 * StartTimeTicks begins at that point, so its 0:00 is not the film's.
	 */
	streamOffsetSeconds: number;
	durationSeconds?: number;
	/** A live channel: no timeline, nothing to resume. */
	live?: boolean;
	/** "hls" when the URL is a playlist the player can't tell from its path. */
	format?: "hls" | "ts" | "file";
	/** Tried when the main URL fails (an IPTV provider's MPEG-TS stream). */
	fallbackUrl?: string;
	/** Shown on the screen while the film loads, until its first frame. */
	artworkUrl?: string;
}

export interface TheaterResult {
	itemId: string;
	positionSeconds: number;
	/** The film played to its end inside the theater. */
	ended: boolean;
}

interface NativeTheaterResult {
	itemId: string;
	positionMs: number;
	ended: boolean;
}

interface AuroraTheaterPlugin {
	open(options: {
		itemId: string;
		title: string;
		url: string;
		positionMs: number;
		streamOffsetMs: number;
		durationMs: number;
		live: boolean;
		format: string;
		fallbackUrl: string;
		userAgent: string;
		artworkUrl: string;
	}): Promise<void>;
	addListener(
		event: "closed",
		listener: (result: NativeTheaterResult) => void,
	): Promise<{ remove: () => Promise<void> }>;
}

// Wrapped in an object: a Capacitor plugin is a proxy that answers every
// property, `then` included, so resolving a promise with it directly makes
// JavaScript treat it as a thenable and call the missing native `then()`.
let plugin: Promise<{ theater: AuroraTheaterPlugin } | null> | null = null;

function loadPlugin(): Promise<{ theater: AuroraTheaterPlugin } | null> {
	plugin ??= (async () => {
		if (!isNativeShell() || getClientPlaybackContext().platform !== "quest") return null;
		const { Capacitor, registerPlugin } = await import("@capacitor/core");
		// Only the Quest build of the app has it; the Play Store build doesn't.
		if (!Capacitor.isPluginAvailable("AuroraTheater")) return null;
		return { theater: registerPlugin<AuroraTheaterPlugin>("AuroraTheater") };
	})().catch(() => null);
	return plugin;
}

export async function isTheaterAvailable(): Promise<boolean> {
	return (await loadPlugin()) != null;
}

export function toTheaterUrl(streamUrl: string, base = window.location.href): string {
	return new URL(streamUrl, base).toString();
}

export async function openTheater(request: TheaterRequest): Promise<void> {
	const loaded = await loadPlugin();
	if (!loaded) throw new Error("The theater is not available on this device");
	await loaded.theater.open({
		itemId: request.itemId,
		title: request.title,
		url: request.url,
		positionMs: Math.max(0, Math.round(request.positionSeconds * 1000)),
		streamOffsetMs: Math.max(0, Math.round(request.streamOffsetSeconds * 1000)),
		durationMs: Math.max(0, Math.round((request.durationSeconds ?? 0) * 1000)),
		live: request.live ?? false,
		format: request.format ?? "",
		fallbackUrl: request.fallbackUrl ?? "",
		// Some IPTV providers turn away players they don't know; the native
		// player introduces itself the way the WebView does.
		userAgent: navigator.userAgent,
		artworkUrl: nativeArtworkUrl(request.artworkUrl) ?? "",
	});
}

/**
 * Called once the viewer leaves the theater. The plugin keeps the last result
 * until someone listens, so a WebView that was reloaded while the headset was
 * immersive still gets it.
 */
export async function onTheaterClosed(listener: (result: TheaterResult) => void) {
	const loaded = await loadPlugin();
	if (!loaded) return () => undefined;
	const handle = await loaded.theater.addListener("closed", (result) => {
		listener({
			itemId: result.itemId,
			positionSeconds: Math.max(0, result.positionMs / 1000),
			ended: result.ended,
		});
	});
	return () => void handle.remove();
}
