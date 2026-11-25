import { describe, expect, it } from "vite-plus/test";

import {
	buildTrickplayPreview,
	getTrickplayFrame,
	type JellyfinTrickplayManifest,
} from "./trickplay";

const resolution = (width: number) => ({
	Width: width,
	Height: (width * 9) / 16,
	TileWidth: 10,
	TileHeight: 10,
	ThumbnailCount: 250,
	Interval: 10_000,
});

const manifest: JellyfinTrickplayManifest = {
	source1: { "160": resolution(160), "320": resolution(320), "640": resolution(640) },
};

function preview() {
	const built = buildTrickplayPreview({
		manifest,
		itemId: "abc",
		mediaSourceId: "source1",
		toUrl: (path) => `proxy:${path}`,
	});
	if (!built) throw new Error("expected a preview");
	return built;
}

describe("buildTrickplayPreview", () => {
	it("picks the resolution nearest 320 px and lists every sheet", () => {
		const built = preview();
		expect(built.width).toBe(320);
		expect(built.interval).toBe(10);
		// 250 thumbnails at 100 per sheet.
		expect(built.tileUrls).toEqual([
			"proxy:/Videos/abc/Trickplay/320/0.jpg?MediaSourceId=source1",
			"proxy:/Videos/abc/Trickplay/320/1.jpg?MediaSourceId=source1",
			"proxy:/Videos/abc/Trickplay/320/2.jpg?MediaSourceId=source1",
		]);
	});

	it("falls back to the first media source when the played one has none", () => {
		const built = buildTrickplayPreview({
			manifest,
			itemId: "abc",
			mediaSourceId: "other",
			toUrl: (path) => path,
		});
		expect(built?.tileUrls[0]).toContain("MediaSourceId=source1");
	});

	it("is null for items without thumbnails", () => {
		expect(
			buildTrickplayPreview({ manifest: undefined, itemId: "abc", toUrl: (p) => p }),
		).toBeNull();
		expect(buildTrickplayPreview({ manifest: {}, itemId: "abc", toUrl: (p) => p })).toBeNull();
		expect(
			buildTrickplayPreview({
				manifest: { s: { "320": { ...resolution(320), ThumbnailCount: 0 } } },
				itemId: "abc",
				toUrl: (p) => p,
			}),
		).toBeNull();
	});
});

describe("getTrickplayFrame", () => {
	it("finds the sheet and the position within it", () => {
		// Thumbnail 123: sheet 1, 23rd on it → column 3, row 2.
		expect(getTrickplayFrame(preview(), 1234)).toEqual({
			url: "proxy:/Videos/abc/Trickplay/320/1.jpg?MediaSourceId=source1",
			x: 3 * 320,
			y: 2 * 180,
		});
	});

	it("clamps to the first and last thumbnail", () => {
		expect(getTrickplayFrame(preview(), -5)).toMatchObject({ x: 0, y: 0 });
		expect(getTrickplayFrame(preview(), 99_999)).toEqual({
			url: "proxy:/Videos/abc/Trickplay/320/2.jpg?MediaSourceId=source1",
			x: 9 * 320,
			y: 4 * 180,
		});
	});
});
