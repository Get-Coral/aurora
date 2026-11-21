/**
 * URL helpers shared by the server and the native app. Nothing here may import
 * `node:` modules: the native shell bundles this file.
 */

export function httpUrl(value: string, base?: URL | string): URL {
	const url = new URL(value.trim(), base);
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
		throw new Error("Invalid IPTV URL");
	}
	url.hash = "";
	return url;
}

/** The parts of an Xtream Codes account Aurora needs to reach its API. */
export interface XtreamConfig {
	/** Base URL ending in `/`, e.g. `http://provider.example/`. */
	server: string;
	username: string;
	password: string;
}

export function xtreamConfig(server: string, username: string, password: string): XtreamConfig {
	const url = httpUrl(server);
	if (!username.trim() || !password || url.search) throw new Error("Invalid Xtream source");
	url.pathname = `${url.pathname.replace(/\/(?:get|player_api)\.php$/, "").replace(/\/+$/, "")}/`;
	return { server: url.href, username: username.trim(), password };
}

/**
 * Providers hand out their Xtream account as an M3U link
 * (`/get.php?username=…&password=…`). Aurora uses the much richer Xtream API
 * for those, so a pasted link becomes an Xtream source.
 */
export function xtreamFromPlaylist(value: string): XtreamConfig | null {
	const url = httpUrl(value);
	const username = url.searchParams.get("username");
	const password = url.searchParams.get("password");
	if (!url.pathname.endsWith("/get.php") || !username || !password) return null;
	url.search = "";
	return xtreamConfig(url.href, username, password);
}

export type StreamFormat = "hls" | "ts" | "file";

export function streamFormat(url: URL, live: boolean): StreamFormat {
	if (/\.m3u8$/i.test(url.pathname)) return "hls";
	if (/\.ts$/i.test(url.pathname)) return "ts";
	if (live && !/\.[^/]+$/.test(url.pathname)) return "ts";
	return /\.(mp4|mkv|webm|mov|m4v|avi)$/i.test(url.pathname) ? "file" : live ? "hls" : "file";
}

const TMDB_IMAGE =
	/^https?:\/\/image\.tmdb\.org\/t\/p\/(?:original|[wh]\d+(?:_and_[wh]\d+_bestv2)?)\/([a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp))$/i;

/**
 * TMDB artwork is public and safe to load straight from the browser, so it
 * skips Aurora's image proxy. Returns the resized URL, or undefined for any
 * other host.
 */
export function tmdbArtwork(value: unknown, size: "w342" | "w780" | "w1280" = "w342") {
	if (typeof value !== "string") return undefined;
	const match = value.trim().match(TMDB_IMAGE);
	return match ? `https://image.tmdb.org/t/p/${size}/${match[1]}` : undefined;
}

/** Keep an artwork URL only when it is a plain http(s) URL. */
export function artworkSource(value: unknown) {
	if (typeof value !== "string" || !value.trim()) return undefined;
	try {
		return httpUrl(value).href;
	} catch {
		return undefined;
	}
}

/** The source form input for a URL saved by Aurora's first IPTV version. */
export function m3uLegacyInput(url: string, direct: boolean) {
	return { kind: direct ? ("direct" as const) : ("m3u" as const), url };
}
