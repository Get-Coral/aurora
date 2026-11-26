import { describe, expect, it } from "vitest";
import { hasNativePlayer, shouldUseTvPlayer, toTvPlayerResult } from "./tv-player";

describe("shouldUseTvPlayer", () => {
	it("takes IPTV films and episodes", () => {
		expect(shouldUseTvPlayer({ live: false, format: "file" })).toBe(true);
	});

	it("leaves live channels to the WebView player", () => {
		expect(shouldUseTvPlayer({ live: true, format: "hls" })).toBe(false);
		expect(shouldUseTvPlayer({ live: true, format: "ts" })).toBe(false);
	});

	it("leaves provider HLS to the WebView player", () => {
		expect(shouldUseTvPlayer({ live: false, format: "hls" })).toBe(false);
	});
});

describe("toTvPlayerResult", () => {
	it("turns milliseconds into seconds", () => {
		expect(toTvPlayerResult({ positionMs: 90_500, durationMs: 3_600_000, ended: false })).toEqual({
			positionSeconds: 90.5,
			durationSeconds: 3600,
			ended: false,
		});
	});

	it("has no position when the player could not tell", () => {
		expect(toTvPlayerResult({ positionMs: -1, ended: false })).toEqual({
			positionSeconds: null,
			durationSeconds: null,
			ended: false,
		});
	});

	it("keeps the end and an error", () => {
		expect(
			toTvPlayerResult({ positionMs: 0, durationMs: 0, ended: true, error: "ERROR_CODE_IO" }),
		).toEqual({ positionSeconds: 0, durationSeconds: null, ended: true, error: "ERROR_CODE_IO" });
	});
});

describe("hasNativePlayer", () => {
	it("is the Android app on TVs, phones and tablets", () => {
		expect(hasNativePlayer("android-tv")).toBe(true);
		expect(hasNativePlayer("android")).toBe(true);
	});

	it("leaves the Quest (its theater), iOS and browsers alone", () => {
		expect(hasNativePlayer("quest")).toBe(false);
		expect(hasNativePlayer("ios")).toBe(false);
		expect(hasNativePlayer("other")).toBe(false);
	});
});
