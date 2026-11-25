import { describe, expect, it } from "vite-plus/test";
import {
	choosePlaybackEngine,
	iptvStartAt,
	LIVE_MPEGTS_CONFIG,
	withStartOffset,
} from "./attach-stream";

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
			"/api/iptv?id=iptv%3Aa%3Avod%3A1&st=x&start=61.7",
		);
		expect(withStartOffset("/api/iptv?id=a&start=5", 0)).toBe("/api/iptv?id=a");
		expect(withStartOffset("http://provider.example/movie/1.mp4", 10)).toBe(
			"http://provider.example/movie/1.mp4?start=10",
		);
	});
});

describe("iptvStartAt", () => {
	const stream = "/api/iptv?id=iptv%3Aa%3Avod%3A1&remux=1&st=x&start=5";
	const answering = (body: unknown, ok = true) => {
		const calls: string[] = [];
		const fetchImpl = (async (url: string) => {
			calls.push(url);
			return { ok, json: async () => body } as Response;
		}) as unknown as typeof fetch;
		return { calls, fetchImpl };
	};

	it("asks the converter for the keyframe and starts the clock there", async () => {
		const { calls, fetchImpl } = answering({ start: 2618.042 });
		expect(await iptvStartAt(stream, 2620.5, fetchImpl)).toBe(2618.042);
		// The same stream (token, remux) with the keyframe question instead of a start.
		expect(calls).toEqual(["/api/iptv?id=iptv%3Aa%3Avod%3A1&remux=1&st=x&keyframe=2620.5"]);
	});

	it("keeps the time asked for when the server can't tell", async () => {
		expect(await iptvStartAt(stream, 60, answering({}, false).fetchImpl)).toBe(60);
		expect(await iptvStartAt(stream, 60, answering({ start: "x" }).fetchImpl)).toBe(60);
		// A keyframe far from the seek is not trusted.
		expect(await iptvStartAt(stream, 60, answering({ start: 400 }).fetchImpl)).toBe(60);
		const failing = (async () => {
			throw new Error("offline");
		}) as unknown as typeof fetch;
		expect(await iptvStartAt(stream, 60, failing)).toBe(60);
	});

	it("doesn't ask for the start of the film or for streams without a converter", async () => {
		const { calls, fetchImpl } = answering({ start: 1 });
		expect(await iptvStartAt(stream, 0, fetchImpl)).toBe(0);
		expect(await iptvStartAt("http://provider.example/movie/1.mkv", 30, fetchImpl)).toBe(30);
		expect(calls).toEqual([]);
	});
});

describe("track labels and stream params", async () => {
	const { distinctLabels, trackLabel, withStreamParams } = await import("./attach-stream");
	it("names languages from bibliographic and ISO codes", () => {
		expect(trackLabel({ language: "ger" }, "en", "Track 1")).toBe("German");
		expect(trackLabel({ language: "dut" }, "nl", "Spoor 1")).toBe("Nederlands");
		expect(trackLabel({ language: "eng", title: "Commentary" }, "en", "x")).toBe(
			"English (Commentary)",
		);
		expect(trackLabel({ language: "und" }, "en", "Track 2")).toBe("Track 2");
	});
	it("numbers tracks that would read the same", () => {
		expect(distinctLabels(["English", "English (SDH)", "English", "French", "English"])).toEqual([
			"English",
			"English (SDH)",
			"English 2",
			"French",
			"English 3",
		]);
	});
	it("sets and clears stream parameters", () => {
		expect(withStreamParams("/api/iptv?id=a&start=5", { audio: 1, remux: "1", start: null })).toBe(
			"/api/iptv?id=a&audio=1&remux=1",
		);
	});
});

describe("live MPEG-TS", () => {
	it("never jumps to catch up with the live edge, it only plays slightly faster", () => {
		expect(LIVE_MPEGTS_CONFIG.liveBufferLatencyChasing).toBe(false);
		expect(LIVE_MPEGTS_CONFIG.liveSync).toBe(true);
		expect(LIVE_MPEGTS_CONFIG.liveSyncPlaybackRate).toBeLessThanOrEqual(1.1);
		// The provider's opening burst fits under the catch-up threshold.
		expect(LIVE_MPEGTS_CONFIG.liveSyncMaxLatency).toBeGreaterThanOrEqual(25);
	});
});
