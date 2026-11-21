import { describe, expect, it } from "vitest";
import type { MediaItem } from "./media";
import {
	mergeSearchResults,
	normalizeSearchText,
	prepareQuery,
	rankItems,
	scoreText,
} from "./search";

const score = (query: string, title: string) =>
	scoreText(prepareQuery(query), normalizeSearchText(title));

function item(id: string, title: string, extra: Partial<MediaItem> = {}): MediaItem {
	return {
		id,
		source: "jellyfin",
		type: "movie",
		title,
		genres: [],
		posterUrl: "/p.jpg",
		...extra,
	};
}

describe("search text", () => {
	it("folds accents, case, punctuation and superscripts", () => {
		expect(normalizeSearchText("Amélie: Le Fabuleux—Destin")).toBe("amelie le fabuleux destin");
		expect(normalizeSearchText("VTM 2 ᴿᴬᵂ")).toBe("vtm 2 raw");
	});

	it("ranks exact, prefix, word-prefix, substring and typos", () => {
		expect(score("dexter", "Dexter")).toBe(0);
		expect(score("dex", "Dexter: Resurrection")).toBe(1);
		expect(score("dexter", "Dexter: Resurrection")).toBe(0.5);
		expect(score("vtm", "VTM ᴿᴬᵂ")).toBe(0);
		expect(score("vtm 2", "VTM 2 FHD")).toBe(0);
		expect(score("resurrection dexter", "Dexter: Resurrection")).toBe(2);
		expect(score("xter", "Dexter")).toBe(3);
		expect(score("dextr", "Dexter")).toBe(5);
		expect(score("resurection", "Dexter: Resurrection")).toBe(5);
		expect(score("madden", "Dexter")).toBeNull();
		expect(score("a", "")).toBeNull();
	});

	it("puts closer matches and titles with artwork first", () => {
		const ranked = rankItems(prepareQuery("vtm"), [
			item("a", "VTM Gold", { posterUrl: undefined }),
			item("b", "Het beste van VTM"),
			item("c", "VTM"),
			item("d", "VTM Gold"),
		]);
		expect(ranked.map((entry) => entry.id)).toEqual(["c", "d", "a", "b"]);
		const strict = rankItems(
			prepareQuery("dexter"),
			[item("x", "How to Deter a Robber"), item("y", "Dexter")],
			true,
		);
		expect(strict.map((entry) => entry.id)).toEqual(["y"]);
	});

	it("merges sources into ranked sections with one top result", () => {
		const results = mergeSearchResults("dexter", [
			{
				series: [item("j1", "Dexter: New Blood", { type: "series" })],
				people: [{ id: "p", name: "Dexter Fletcher" }],
			},
			{
				series: [item("i1", "Dexter", { type: "series", source: "iptv" })],
				onTv: [
					item("ch", "VTM", { type: "channel", airing: { title: "Dexter", start: 2, end: 3 } }),
				],
			},
		]);
		expect(results.series.map((entry) => entry.id)).toEqual(["i1", "j1"]);
		expect(results.top.map((entry) => entry.id)).toEqual(["i1"]);
		expect(results.people).toHaveLength(1);
		expect(results.onTv).toHaveLength(1);
	});
});
