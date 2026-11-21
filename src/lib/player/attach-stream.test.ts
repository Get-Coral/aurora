import { describe, expect, it } from "vitest";
import { choosePlaybackEngine, withStartOffset } from "./attach-stream";

const chrome = { canPlayType: () => "", mse: true };
const safari = {
	canPlayType: (type: string) => (type === "application/vnd.apple.mpegurl" ? "maybe" : ""),
	mse: true,
	preferNativeHls: true,
};
// Recent Chrome reports native HLS too, but hls.js handles IPTV better.
const chromeWithHls = { ...safari, preferNativeHls: false };
const iosWithoutMse = { ...safari, mse: false };

describe("choosePlaybackEngine", () => {
	it.each([
		["hls", chrome, "hls.js"],
		["hls", safari, "native"],
		["hls", chromeWithHls, "hls.js"],
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

describe("track labels and stream params", async () => {
	const { trackLabel, withStreamParams } = await import("./attach-stream");
	it("names languages from bibliographic and ISO codes", () => {
		expect(trackLabel({ language: "ger" }, "en", "Track 1")).toBe("German");
		expect(trackLabel({ language: "dut" }, "nl", "Spoor 1")).toBe("Nederlands");
		expect(trackLabel({ language: "eng", title: "Commentary" }, "en", "x")).toBe(
			"English (Commentary)",
		);
		expect(trackLabel({ language: "und" }, "en", "Track 2")).toBe("Track 2");
	});
	it("sets and clears stream parameters", () => {
		expect(withStreamParams("/api/iptv?id=a&start=5", { audio: 1, remux: "1", start: null })).toBe(
			"/api/iptv?id=a&audio=1&remux=1",
		);
	});
});
