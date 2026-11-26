import { describe, expect, it } from "vitest";
import { nativeArtworkUrl } from "./artwork";

describe("nativeArtworkUrl", () => {
	it("passes absolute artwork through", () => {
		expect(nativeArtworkUrl("https://image.tmdb.org/t/p/w1280/a.jpg", "http://localhost/")).toBe(
			"https://image.tmdb.org/t/p/w1280/a.jpg",
		);
		expect(nativeArtworkUrl("http://provider.example/logo.png", "http://localhost/")).toBe(
			"http://provider.example/logo.png",
		);
	});

	it("makes paths on a reachable server absolute", () => {
		expect(nativeArtworkUrl("/api/iptv?image=x&sig=y", "https://aurora.example/library")).toBe(
			"https://aurora.example/api/iptv?image=x&sig=y",
		);
	});

	it("leaves out what only the app's own WebView can reach, and what isn't a web URL", () => {
		expect(nativeArtworkUrl("/assets/poster.jpg", "http://localhost/")).toBeUndefined();
		expect(nativeArtworkUrl("data:image/png;base64,AAAA", "http://localhost/")).toBeUndefined();
		expect(nativeArtworkUrl(undefined)).toBeUndefined();
		expect(nativeArtworkUrl("", "http://localhost/")).toBeUndefined();
	});
});
