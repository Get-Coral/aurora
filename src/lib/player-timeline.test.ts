import { describe, expect, it } from "vitest";
import {
	clampProgress,
	isTimeBuffered,
	ratioFromPointer,
	resolveDuration,
	ticksToSeconds,
	watchedRatio,
} from "./player-timeline";

function ranges(...pairs: [number, number][]) {
	return {
		length: pairs.length,
		start: (i: number) => pairs[i][0],
		end: (i: number) => pairs[i][1],
	};
}

describe("clampProgress", () => {
	it("returns the percentage watched", () => {
		expect(clampProgress(30, 120)).toBe(25);
	});

	it("never runs past either end of the bar", () => {
		expect(clampProgress(130, 120)).toBe(100);
		expect(clampProgress(-5, 120)).toBe(0);
	});

	it("is empty without a usable duration", () => {
		expect(clampProgress(30, 0)).toBe(0);
		expect(clampProgress(30, Number.POSITIVE_INFINITY)).toBe(0);
		expect(clampProgress(Number.NaN, 120)).toBe(0);
	});
});

describe("ratioFromPointer", () => {
	const rect = { left: 100, width: 400 };

	it("maps the pointer onto the bar", () => {
		expect(ratioFromPointer(300, rect)).toBe(0.5);
	});

	it("clamps a pointer dragged outside the bar", () => {
		expect(ratioFromPointer(0, rect)).toBe(0);
		expect(ratioFromPointer(900, rect)).toBe(1);
	});

	it("handles a bar that has no width yet", () => {
		expect(ratioFromPointer(300, { left: 0, width: 0 })).toBe(0);
	});
});

describe("isTimeBuffered", () => {
	const buffered = ranges([0, 30], [60, 90]);

	it("finds times inside a downloaded range", () => {
		expect(isTimeBuffered(buffered, 10)).toBe(true);
		expect(isTimeBuffered(buffered, 75)).toBe(true);
	});

	it("allows a second of slack past the end of a range", () => {
		expect(isTimeBuffered(buffered, 30.8)).toBe(true);
		expect(isTimeBuffered(buffered, 32)).toBe(false);
	});

	it("rejects gaps, negative times and empty buffers", () => {
		expect(isTimeBuffered(buffered, 45)).toBe(false);
		expect(isTimeBuffered(buffered, -1)).toBe(false);
		expect(isTimeBuffered(ranges(), 0)).toBe(false);
	});
});

describe("ticksToSeconds", () => {
	it("converts Jellyfin ticks without rounding to minutes", () => {
		expect(ticksToSeconds(63_456_780_000)).toBeCloseTo(6345.678);
	});

	it("ignores missing or empty runtimes", () => {
		expect(ticksToSeconds(undefined)).toBeUndefined();
		expect(ticksToSeconds(0)).toBeUndefined();
	});
});

describe("resolveDuration", () => {
	it("trusts Jellyfin's runtime for transcodes", () => {
		// Safari's native HLS reports Infinity, a progressive transcode only
		// the part after its StartTimeTicks offset.
		expect(
			resolveDuration({
				isTranscode: true,
				videoDuration: Number.POSITIVE_INFINITY,
				offset: 0,
				runtimeSeconds: 5400,
			}),
		).toBe(5400);
		expect(
			resolveDuration({
				isTranscode: true,
				videoDuration: 3600,
				offset: 1200,
				runtimeSeconds: 5400,
			}),
		).toBe(5400);
	});

	it("trusts the element for direct play", () => {
		expect(
			resolveDuration({
				isTranscode: false,
				videoDuration: 5412.3,
				offset: 0,
				runtimeSeconds: 5400,
			}),
		).toBe(5412.3);
	});

	it("falls back to whatever is known", () => {
		expect(
			resolveDuration({
				isTranscode: true,
				videoDuration: 3600,
				offset: 600,
				runtimeSeconds: undefined,
			}),
		).toBe(4200);
		expect(
			resolveDuration({
				isTranscode: false,
				videoDuration: Number.NaN,
				offset: 0,
				runtimeSeconds: 5400,
			}),
		).toBe(5400);
		expect(
			resolveDuration({
				isTranscode: false,
				videoDuration: undefined,
				offset: 0,
				runtimeSeconds: undefined,
			}),
		).toBe(0);
	});
});

describe("watchedRatio", () => {
	it("is the share of the film watched", () => {
		expect(watchedRatio(5100, 5400)).toBeCloseTo(0.944, 3);
	});

	it("is zero without a duration", () => {
		expect(watchedRatio(100, 0)).toBe(0);
	});
});
