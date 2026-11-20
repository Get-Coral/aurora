import { describe, expect, it } from "vitest";
import { choosePlaybackEngine, withStartOffset } from "./attach-stream";

const chrome = { canPlayType: () => "", mse: true };
const safari = {
	canPlayType: (type: string) => (type === "application/vnd.apple.mpegurl" ? "maybe" : ""),
	mse: true,
};
const iosWithoutMse = { ...safari, mse: false };

describe("choosePlaybackEngine", () => {
	it.each([
		["hls", chrome, "hls.js"],
		["hls", safari, "native"],
		["hls", iosWithoutMse, "native"],
		["ts", chrome, "mpegts"],
		["ts", iosWithoutMse, "unsupported"],
		["file", chrome, "native"],
	] as const)("%s on %o plays with %s", (format, support, engine) => {
		expect(choosePlaybackEngine(format, support)).toBe(engine);
	});
});

describe("withStartOffset", () => {
	it("sets and clears the start offset on relative and absolute URLs", () => {
		expect(withStartOffset("/api/iptv?id=iptv:a:vod:1&st=x", 61.7)).toBe(
			"/api/iptv?id=iptv%3Aa%3Avod%3A1&st=x&start=61",
		);
		expect(withStartOffset("/api/iptv?id=a&start=5", 0)).toBe("/api/iptv?id=a");
		expect(withStartOffset("http://provider.example/movie/1.mp4", 10)).toBe(
			"http://provider.example/movie/1.mp4?start=10",
		);
	});
});
