import { describe, expect, it } from "vitest";
import {
	jellyfinStreamProxyUrl,
	prepareSeekReloadUrl,
	setStreamStartTicks,
	setTranscodeQuality,
	withStreamToken,
} from "./jellyfin-stream-proxy";

const TOKEN = "1.1800000000.3fa85f6457174562b3fc2c963f66afa6.abc123.sig";
const PROXY_URL = jellyfinStreamProxyUrl(
	"http://jellyfin.local:8096/Videos/abc/stream.mp4?static=true&api_key=secret",
);

function innerPath(streamUrl: string) {
	return new URL(streamUrl, "http://x").searchParams.get("path") ?? "";
}

describe("withStreamToken", () => {
	it("appends the token to a proxy URL", () => {
		const tokenized = withStreamToken(PROXY_URL, TOKEN);
		expect(new URL(tokenized, "http://x").searchParams.get("st")).toBe(TOKEN);
	});

	it("leaves the inner Jellyfin path untouched", () => {
		expect(innerPath(withStreamToken(PROXY_URL, TOKEN))).toBe(innerPath(PROXY_URL));
	});

	it("is a no-op without a token", () => {
		expect(withStreamToken(PROXY_URL, null)).toBe(PROXY_URL);
		expect(withStreamToken(PROXY_URL, undefined)).toBe(PROXY_URL);
		expect(withStreamToken(PROXY_URL, "")).toBe(PROXY_URL);
	});

	it("leaves direct Jellyfin URLs alone", () => {
		const direct = "http://jellyfin.local:8096/Videos/abc/stream.mp4?api_key=secret";
		expect(withStreamToken(direct, TOKEN)).toBe(direct);
	});

	it("is idempotent", () => {
		const once = withStreamToken(PROXY_URL, TOKEN);
		expect(withStreamToken(once, TOKEN)).toBe(once);
	});
});

describe("the token survives downstream URL rewrites", () => {
	const tokenized = withStreamToken(PROXY_URL, TOKEN);

	function expectTokenIntact(streamUrl: string) {
		expect(new URL(streamUrl, "http://x").searchParams.get("st")).toBe(TOKEN);
	}

	it("survives setStreamStartTicks", () => {
		const result = setStreamStartTicks(tokenized, 12_345);
		expectTokenIntact(result);
		expect(innerPath(result)).toContain("StartTimeTicks=12345");
	});

	it("survives setTranscodeQuality", () => {
		const hls = withStreamToken(
			jellyfinStreamProxyUrl("http://jellyfin.local:8096/Videos/abc/main.m3u8?api_key=secret"),
			TOKEN,
		);
		const result = setTranscodeQuality(hls, { videoBitrate: 4_000_000 });
		expectTokenIntact(result);
		expect(innerPath(result)).toContain("VideoBitrate=4000000");
	});

	it("survives prepareSeekReloadUrl", () => {
		const result = prepareSeekReloadUrl(tokenized, 99_999);
		expectTokenIntact(result);
		expect(innerPath(result)).toContain("StartTimeTicks=99999");
	});

	it("survives all three chained", () => {
		expectTokenIntact(
			prepareSeekReloadUrl(setTranscodeQuality(setStreamStartTicks(tokenized, 1)), 2),
		);
	});
});

describe("prepareSeekReloadUrl", () => {
	it("starts a progressive transcode at the target", () => {
		const url = jellyfinStreamProxyUrl(
			"http://jellyfin.local:8096/Videos/abc/stream.mp4?StartTimeTicks=5&api_key=secret",
		);
		const result = innerPath(prepareSeekReloadUrl(url, 600_000_000));
		expect(result).toContain("StartTimeTicks=600000000");
		expect(result).toContain("_ts=");
	});

	it("keeps an HLS playlist starting at 0:00 so the player can seek it", () => {
		const url = jellyfinStreamProxyUrl(
			"http://jellyfin.local:8096/videos/abc/master.m3u8?StartTimeTicks=5&api_key=secret",
		);
		const result = innerPath(prepareSeekReloadUrl(url, 600_000_000));
		expect(result).not.toContain("StartTimeTicks");
		expect(result).toContain("_ts=");
	});
});
