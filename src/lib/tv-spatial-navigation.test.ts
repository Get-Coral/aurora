import { describe, expect, it } from "vitest";
import { getDirectionalScore } from "./tv-spatial-navigation";

const box = (left: number, top: number, width: number, height: number) => ({
	left,
	top,
	right: left + width,
	bottom: top + height,
});

describe("TV spatial navigation", () => {
	it("prefers the next card in the row over a nearby button above it", () => {
		const card = box(320, 500, 410, 420);
		const nextCard = box(755, 500, 410, 420);
		const tabAbove = box(465, 395, 160, 55);
		const right = (target: ReturnType<typeof box>) => getDirectionalScore(card, target, "right");
		expect(right(nextCard)).not.toBeNull();
		expect(right(nextCard)!).toBeLessThan(right(tabAbove) ?? Number.POSITIVE_INFINITY);
	});

	it("walks along a guide row to programmes scrolled out of view", () => {
		const programme = box(600, 300, 400, 60);
		const nextInRow = box(2400, 300, 300, 60);
		const header = box(1000, 20, 200, 60);
		expect(getDirectionalScore(programme, nextInRow, "right")!).toBeLessThan(
			getDirectionalScore(programme, header, "right") ?? Number.POSITIVE_INFINITY,
		);
	});

	it("ignores candidates behind the current element", () => {
		expect(getDirectionalScore(box(500, 0, 100, 100), box(300, 0, 100, 100), "right")).toBeNull();
		expect(getDirectionalScore(box(0, 500, 100, 100), box(0, 300, 100, 100), "down")).toBeNull();
	});
});
