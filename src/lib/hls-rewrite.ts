/**
 * Rewriting Jellyfin's HLS manifests so every segment, key and alternate
 * rendition is fetched back through Aurora's own proxy rather than straight
 * from Jellyfin (which would need the API key in the browser).
 *
 * Extracted from the proxy route so it can be unit tested — route modules
 * under `src/routes/` aren't importable from vitest.
 */

const ALLOWED_PATH_PREFIXES = ["/videos/", "/audio/"];

export function isAllowedMediaPath(pathname: string) {
	return ALLOWED_PATH_PREFIXES.some((prefix) => pathname.toLowerCase().startsWith(prefix));
}

/**
 * `streamToken` is threaded through unchanged rather than re-minted: the token
 * is scoped to the item, and every URI in an item's manifest resolves under
 * that same item, so one signature covers the whole tree. A receiver fetching
 * with a token has no session cookie, so a tokenless segment URI would 401.
 */
export function buildProxyPath(path: string, streamToken?: string | null) {
	const base = `/api/jellyfin-stream?path=${encodeURIComponent(path)}`;
	return streamToken ? `${base}&st=${encodeURIComponent(streamToken)}` : base;
}

export function rewriteHlsUri(uri: string, playlistUrl: URL, streamToken?: string | null) {
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

	return buildProxyPath(resolvedUri.pathname + resolvedUri.search, streamToken);
}

export function rewriteHlsManifest(
	manifest: string,
	playlistUrl: URL,
	streamToken?: string | null,
) {
	return manifest
		.split("\n")
		.map((line) => {
			const trimmedLine = line.trim();
			if (!trimmedLine) return line;

			if (!trimmedLine.startsWith("#")) {
				return rewriteHlsUri(line, playlistUrl, streamToken);
			}

			// Covers #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA and
			// #EXT-X-I-FRAME-STREAM-INF. A tokenless #EXT-X-KEY would 401 the
			// decryption key and fail playback with a misleading error.
			return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
				return `URI="${rewriteHlsUri(uri, playlistUrl, streamToken)}"`;
			});
		})
		.join("\n");
}
