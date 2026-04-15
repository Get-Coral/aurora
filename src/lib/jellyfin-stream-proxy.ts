/**
 * Converts a full Jellyfin stream URL into a local proxy URL that the browser
 * can reach even when the Jellyfin server is on a private network (e.g. NAS
 * accessed over VPN). The api_key is stripped from the proxy URL and re-added
 * server-side by the /api/jellyfin-stream handler.
 */
export function jellyfinStreamProxyUrl(jellyfinUrl: string): string {
	let url: URL;
	try {
		url = new URL(jellyfinUrl);
	} catch {
		return jellyfinUrl;
	}
	url.searchParams.delete("api_key");
	return `/api/jellyfin-stream?path=${encodeURIComponent(url.pathname + url.search)}`;
}

/**
 * Sets StartTimeTicks on a stream URL, whether it is a direct Jellyfin URL or
 * a /api/jellyfin-stream proxy URL. The proxy URL encodes the real Jellyfin
 * path inside its `path` query param, so we must modify it there.
 */
export function setStreamStartTicks(streamUrl: string, ticks: number): string {
	if (streamUrl.startsWith("/api/jellyfin-stream")) {
		const outer = new URL(streamUrl, "http://x");
		const rawPath = outer.searchParams.get("path");
		if (!rawPath) return streamUrl;
		const inner = new URL(rawPath, "http://x");
		inner.searchParams.set("StartTimeTicks", String(ticks));
		outer.searchParams.set("path", inner.pathname + inner.search);
		return outer.pathname + outer.search;
	}
	const url = new URL(streamUrl);
	url.searchParams.set("StartTimeTicks", String(ticks));
	return url.toString();
}

function mutateInnerStreamUrl(streamUrl: string, mutate: (url: URL) => void): string {
	if (streamUrl.startsWith("/api/jellyfin-stream")) {
		const outer = new URL(streamUrl, "http://x");
		const rawPath = outer.searchParams.get("path");
		if (!rawPath) return streamUrl;
		const inner = new URL(rawPath, "http://x");
		mutate(inner);
		outer.searchParams.set("path", inner.pathname + inner.search);
		return outer.pathname + outer.search;
	}

	const url = new URL(streamUrl);
	mutate(url);
	return url.toString();
}

export function setTranscodeQuality(
	streamUrl: string,
	options?: {
		maxStreamingBitrate?: number;
		videoBitrate?: number;
		audioBitrate?: number;
	},
): string {
	return mutateInnerStreamUrl(streamUrl, (url) => {
		const isProgressiveTranscode = url.pathname.endsWith("/stream.mp4");
		const isHlsTranscode =
			url.pathname.endsWith(".m3u8") || url.searchParams.get("SegmentContainer") === "ts";
		if (!isProgressiveTranscode && !isHlsTranscode) return;

		const maxStreamingBitrate =
			options?.maxStreamingBitrate ?? (isHlsTranscode ? 8_000_000 : 120_000_000);
		const videoBitrate = options?.videoBitrate ?? (isHlsTranscode ? 6_000_000 : 80_000_000);
		const audioBitrate = options?.audioBitrate ?? (isHlsTranscode ? 192_000 : 320_000);

		url.searchParams.set("MaxStreamingBitrate", String(maxStreamingBitrate));
		url.searchParams.set("VideoBitrate", String(videoBitrate));
		url.searchParams.set("AudioBitrate", String(audioBitrate));
	});
}

export function prepareSeekReloadUrl(streamUrl: string, ticks: number): string {
	return mutateInnerStreamUrl(streamUrl, (url) => {
		url.searchParams.set("StartTimeTicks", String(ticks));
		// Force Jellyfin/browser to treat unbuffered seeks as a fresh transcode
		// request instead of reusing a cached segment.
		url.searchParams.set("_ts", String(Date.now()));
	});
}
