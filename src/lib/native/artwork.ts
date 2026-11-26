/**
 * The artwork URL a native player (the Android player, the Quest theater) can
 * fetch on its own, to show while a stream loads. Those players have no access
 * to the WebView's own bundled server (http://localhost in the app), so URLs
 * served from there are left out; everything else is made absolute.
 */
export function nativeArtworkUrl(
	url: string | undefined,
	base: string = typeof window === "undefined" ? "http://localhost/" : window.location.href,
): string | undefined {
	if (!url) return undefined;
	let absolute: URL;
	let page: URL;
	try {
		page = new URL(base);
		absolute = new URL(url, page);
	} catch {
		return undefined;
	}
	if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return undefined;
	if (absolute.origin === page.origin && page.hostname === "localhost") return undefined;
	return absolute.href;
}
