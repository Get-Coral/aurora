import { describe, expect, it } from "vitest";
import type { MediaItem } from "./media";
import { byRating, interleave } from "./merge-rows";

const item = (id: string, rating?: number): MediaItem => ({
	id,
	source: "jellyfin",
	type: "movie",
	title: id,
	genres: [],
	rating,
});

describe("interleave", () => {
	it("alternates and keeps the rest of the longer list", () => {
		expect(interleave<number | string>([1, 2, 3, 4], ["a", "b"])).toEqual([1, "a", 2, "b", 3, 4]);
		expect(interleave([], ["a"])).toEqual(["a"]);
	});
});

describe("byRating", () => {
	it("puts the highest rated first and unrated titles last, in order", () => {
		const sorted = byRating([item("x"), item("low", 5), item("y"), item("high", 8.2)]);
		expect(sorted.map((entry) => entry.id)).toEqual(["high", "low", "x", "y"]);
	});
});
