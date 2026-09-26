import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_PATH_PREFIXES = ["/videos/", "/audio/"];

function isAllowedMediaPath(pathname: string) {
	return ALLOWED_PATH_PREFIXES.some((prefix) => pathname.toLowerCase().startsWith(prefix));
}

function buildProxyPath(path: string) {
	return `/api/jellyfin-stream?path=${encodeURIComponent(path)}`;
}

function rewriteHlsUri(uri: string, playlistUrl: URL) {
	const trimmedUri = uri.trim();
	if (!trimmedUri || trimmedUri.startsWith("data:")) return uri;

	let resolvedUri: URL;
	try {
		resolvedUri = new URL(trimmedUri, playlistUrl);
	} catch {
		return uri;
	}

	if (resolvedUri.origin !== playlistUrl.origin) return uri;
	if (!isAllowedMediaPath(resolvedUri.pathname)) return uri;

	// Jellyfin writes its own key into every URI of the manifest it hands us.
	// Passing those through would publish the access token -- the signed-in
	// user's, when login is enforced -- to anything that can read the playlist,
	// which is the exact thing this proxy exists to prevent. The proxy injects
	// it again server-side on the way back out.
	resolvedUri.searchParams.delete("ApiKey");
	resolvedUri.searchParams.delete("api_key");

	return buildProxyPath(resolvedUri.pathname + resolvedUri.search);
}

function rewriteHlsManifest(manifest: string, playlistUrl: URL) {
	return manifest
		.split("\n")
		.map((line) => {
			const trimmedLine = line.trim();
			if (!trimmedLine) return line;

			if (!trimmedLine.startsWith("#")) {
				return rewriteHlsUri(line, playlistUrl);
			}

			return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
				return `URI="${rewriteHlsUri(uri, playlistUrl)}"`;
			});
		})
		.join("\n");
}

function copyHeaderIfPresent(target: Headers, source: Headers, key: string) {
	const value = source.get(key);
	if (value) target.set(key, value);
}

async function proxyJellyfinStreamRequest(request: Request) {
	const { isRequestAuthorized, getSessionFromRequest } = await import("../../lib/auth-store");
	if (!isRequestAuthorized(request)) {
		return new Response("Unauthorized.", { status: 401 });
	}

	const { getEffectiveJellyfinSettings } = await import("../../lib/config-store");
	const settings = getEffectiveJellyfinSettings();

	if (!settings) {
		return new Response("Aurora is not configured.", { status: 503 });
	}

	// Stream as the signed-in user when possible, so Jellyfin enforces their
	// own permissions (library access, parental controls). The admin API key
	// is only the fallback for open instances and token-less sessions.
	const upstreamToken = getSessionFromRequest(request)?.jellyfinToken ?? settings.apiKey;

	const requestUrl = new URL(request.url);
	const rawPath = requestUrl.searchParams.get("path");

	if (!rawPath) {
		return new Response("Missing path parameter.", { status: 400 });
	}

	let parsedPath: URL;
	try {
		parsedPath = new URL(rawPath, "http://x");
	} catch {
		return new Response("Invalid path parameter.", { status: 400 });
	}

	const pathname = parsedPath.pathname;
	if (!isAllowedMediaPath(pathname)) {
		return new Response("Path not allowed.", { status: 400 });
	}

	// Strip any existing Jellyfin API key parameter casing; inject server-side.
	//
	// It goes back as `ApiKey`, not `api_key`. Jellyfin 12 still takes the
	// lowercase spelling on /Videos/{id}/stream but rejects it outright on
	// /videos/{id}/master.m3u8, so sending lowercase 401s every HLS transcode --
	// which is what Safari and iOS play. `ApiKey` is accepted on both, and is
	// the spelling Jellyfin itself emits in the TranscodingUrl it hands us.
	parsedPath.searchParams.delete("ApiKey");
	parsedPath.searchParams.delete("api_key");
	parsedPath.searchParams.set("ApiKey", upstreamToken);

	const upstream = `${settings.url.replace(/\/+$/, "")}${parsedPath.pathname}${parsedPath.search}`;

	const upstreamHeaders: Record<string, string> = {};
	const range = request.headers.get("range");
	const accept = request.headers.get("accept");
	if (range) upstreamHeaders.range = range;
	if (accept) upstreamHeaders.accept = accept;

	const upstreamResponse = await fetch(upstream, {
		method: request.method,
		headers: upstreamHeaders,
	});

	const headers = new Headers();
	for (const key of [
		"content-type",
		"content-range",
		"accept-ranges",
		"cache-control",
		"last-modified",
		"etag",
		"content-disposition",
	]) {
		copyHeaderIfPresent(headers, upstreamResponse.headers, key);
	}

	const contentType = upstreamResponse.headers.get("content-type") ?? "";
	const isHlsManifest = /application\/(vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl/i.test(
		contentType,
	);

	if (request.method !== "HEAD" && isHlsManifest) {
		const rewrittenManifest = rewriteHlsManifest(await upstreamResponse.text(), parsedPath);
		headers.set("content-length", String(Buffer.byteLength(rewrittenManifest)));

		return new Response(rewrittenManifest, {
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			headers,
		});
	}

	copyHeaderIfPresent(headers, upstreamResponse.headers, "content-length");

	return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
		status: upstreamResponse.status,
		statusText: upstreamResponse.statusText,
		headers,
	});
}

export const Route = createFileRoute("/api/jellyfin-stream")({
	server: {
		handlers: {
			GET: async ({ request }) => proxyJellyfinStreamRequest(request),
			HEAD: async ({ request }) => proxyJellyfinStreamRequest(request),
		},
	},
});
