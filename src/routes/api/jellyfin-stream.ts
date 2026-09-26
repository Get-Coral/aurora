import { createFileRoute } from "@tanstack/react-router";
import { isAllowedMediaPath, rewriteHlsManifest } from "../../lib/hls-rewrite";

function copyHeaderIfPresent(target: Headers, source: Headers, key: string) {
	const value = source.get(key);
	if (value) target.set(key, value);
}

function applyStreamCorsHeaders(headers: Headers) {
	headers.set("access-control-allow-origin", "*");
	headers.set(
		"access-control-expose-headers",
		"content-length, content-range, accept-ranges, content-type",
	);
	headers.set("timing-allow-origin", "*");
}

async function proxyJellyfinStreamRequest(request: Request) {
	const requestUrl = new URL(request.url);
	const rawStreamToken = requestUrl.searchParams.get("st");

	const { OPEN_SESSION_REF, itemIdFromMediaPath, verifyStreamToken } = await import(
		"../../lib/stream-token"
	);
	// A TV playing over AirPlay/Cast fetches this URL itself, with no session
	// cookie, so a signed token is the alternative credential.
	const claims = rawStreamToken ? verifyStreamToken(rawStreamToken) : null;

	const { getSessionByTokenHash, getSessionFromRequest, isRequestAuthorized } = await import(
		"../../lib/auth-store"
	);
	if (!claims && !isRequestAuthorized(request)) {
		return new Response("Unauthorized.", { status: 401 });
	}

	const { getEffectiveJellyfinSettings } = await import("../../lib/config-store");
	const settings = getEffectiveJellyfinSettings();

	if (!settings) {
		return new Response("Aurora is not configured.", { status: 503 });
	}

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

	// Stream as the signed-in user when possible, so Jellyfin enforces their
	// own permissions (library access, parental controls). The admin API key
	// is only the fallback for open instances and token-less sessions.
	let upstreamToken: string;

	if (claims) {
		// The token covers one item. Without this check any stream URL would
		// be a skeleton key to the whole library.
		if (itemIdFromMediaPath(pathname) !== claims.itemId) {
			return new Response("Token not valid for this item.", { status: 403 });
		}

		if (claims.sessionRef === OPEN_SESSION_REF) {
			upstreamToken = settings.apiKey;
		} else {
			const session = getSessionByTokenHash(claims.sessionRef);
			// Deliberately no `?? settings.apiKey` fallback here: a signed-out
			// or expired session must fail, not silently upgrade itself to the
			// admin key. This is what makes signing out revoke stream URLs.
			if (!session) {
				return new Response("Unauthorized.", { status: 401 });
			}
			upstreamToken = session.jellyfinToken ?? settings.apiKey;
		}
	} else {
		upstreamToken = getSessionFromRequest(request)?.jellyfinToken ?? settings.apiKey;
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

	// A Cast receiver fetches from its own origin, so the token-authenticated
	// path needs CORS. The cookie path stays same-origin only -- a wildcard
	// there would be both useless (credentialed requests reject it) and a
	// broader surface than it needs.
	if (claims) applyStreamCorsHeaders(headers);

	const contentType = upstreamResponse.headers.get("content-type") ?? "";
	const isHlsManifest = /application\/(vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl/i.test(
		contentType,
	);

	if (request.method !== "HEAD" && isHlsManifest) {
		const rewrittenManifest = rewriteHlsManifest(
			await upstreamResponse.text(),
			parsedPath,
			rawStreamToken,
		);
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
			// Cast receivers preflight the ranged request before streaming.
			OPTIONS: async () => {
				const headers = new Headers();
				applyStreamCorsHeaders(headers);
				headers.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
				headers.set("access-control-allow-headers", "range");
				headers.set("access-control-max-age", "86400");

				return new Response(null, { status: 204, headers });
			},
		},
	},
});
