import { describe, expect, it } from "vitest";
import { cleanTitle } from "./catalog";
import { episodePid, iptvId, parseIptvId, splitEpisodePid, stableHash } from "./ids";
import { parseIptvPlaylist } from "./m3u";
import { type IptvBackend, iptvShelves, searchIptv } from "./service";
import { normalizeSourceInput, summarizeSource } from "./source";
import { resolveStream } from "./streams";
import { tmdbArtwork, xtreamFromPlaylist } from "./urls";
import { createXmltvReader, parseXmltvTime } from "./xmltv";
import { getSeriesInfo, getShortEpg, getVodInfo, loadXtreamCatalog } from "./xtream";

const provider = "http://provider.example";
const config = { server: `${provider}/`, username: "demo", password: "test-secret" };

function api(responses: Record<string, unknown>) {
	return async (url: URL) => {
		expect(url.origin).toBe(provider);
		expect(url.pathname).toBe("/player_api.php");
		const action = url.searchParams.get("action") ?? "account";
		if (!(action in responses)) throw new Error(`unexpected ${action}`);
		return responses[action];
	};
}

describe("IPTV ids", () => {
	it("round-trips and rejects anything that could smuggle data", () => {
		const id = iptvId("ab12", "ep", episodePid("48491", "1369542"));
		expect(id).toBe("iptv:ab12:ep:48491_1369542");
		expect(parseIptvId(id)).toEqual({ source: "ab12", kind: "ep", pid: "48491_1369542" });
		expect(splitEpisodePid("48491_1369542")).toEqual({ series: "48491", episode: "1369542" });
		expect(parseIptvId("iptv:ab12:live:1.2")).toBeNull();
		expect(parseIptvId("iptv:ab12:other:1")).toBeNull();
		expect(parseIptvId("jellyfin-id")).toBeNull();
		expect(() => iptvId("AB", "live", "1")).toThrow();
		expect(stableHash("a")).toBe(stableHash("a"));
		expect(stableHash("a")).not.toBe(stableHash("b"));
	});
});

describe("sources", () => {
	it("turns a pasted Xtream playlist link into an Xtream source and masks it", () => {
		const { name, config: saved } = normalizeSourceInput({
			kind: "m3u",
			url: `${provider}/get.php?username=demo&password=test-secret&type=m3u_plus&output=ts`,
		});
		expect(saved).toEqual({ kind: "xtream", xtream: config, epgUrl: undefined });
		const summary = JSON.stringify(summarizeSource("ab12", name, saved, 1));
		expect(summary).not.toContain("test-secret");
		expect(summary).toContain("provider.example");
		expect(xtreamFromPlaylist(`${provider}/channels.m3u`)).toBeNull();
		expect(() => normalizeSourceInput({ kind: "m3u", url: "file:///etc/passwd" })).toThrow();
		expect(() =>
			normalizeSourceInput({ kind: "m3u", url: "http://user:pw@provider.example/a.m3u" }),
		).toThrow();
	});

	it("cleans provider titles", () => {
		expect(cleanTitle("EN - Avarice (2022)")).toEqual({ title: "Avarice", year: 2022 });
		expect(cleanTitle("NL - ALL IN")).toEqual({ title: "ALL IN", year: undefined });
		expect(cleanTitle("BE| VRT 1").title).toBe("VRT 1");
		expect(cleanTitle("Madden (2026) (MULTI SUB) NICOLAS CAGE")).toEqual({
			title: "Madden",
			year: 2026,
		});
		expect(cleanTitle("Dexter: Resurrection (2025) (US)")).toEqual({
			title: "Dexter: Resurrection",
			year: 2025,
		});
		expect(tmdbArtwork("https://image.tmdb.org/t/p/w600_and_h900_bestv2/abc.jpg")).toBe(
			"https://image.tmdb.org/t/p/w342/abc.jpg",
		);
		expect(tmdbArtwork("http://203.0.113.10/logo.png")).toBeUndefined();
	});
});

describe("M3U playlists", () => {
	it("reads channels, films, guide ids and the advertised guide", () => {
		const playlist = parseIptvPlaylist(
			[
				'#EXTM3U url-tvg="http://epg.example/guide.xml.gz"',
				'#EXTINF:-1 tvg-id="news.be" tvg-chno="7" tvg-logo="http://img.example/n.png" group-title="News, Local",News HD',
				"/live/demo/test-secret/1.ts",
				'#EXTINF:-1 group-title="Films",EN - Movie (2020)',
				"/movie/demo/test-secret/2.mkv",
				"#EXTINF:-1,Duplicate",
				"/live/demo/test-secret/1.ts",
				"#EXTINF:-1,Unsupported",
				"rtmp://provider.example/live",
			].join("\n"),
			new URL(`${provider}/channels.m3u`),
		);
		expect(playlist.epgUrl).toBe("http://epg.example/guide.xml.gz");
		expect(playlist.channels).toMatchObject([
			{ title: "News HD", group: "News, Local", number: 7, epgId: "news.be", format: "ts" },
		]);
		expect(playlist.movies).toMatchObject([
			{ title: "Movie", year: 2020, ext: "mkv", group: "Films" },
		]);
		expect(() =>
			parseIptvPlaylist("#EXTM3U\n#EXT-X-VERSION:3\nseg.ts", new URL(provider)),
		).toThrow();
	});
});

const xtreamResponses = {
	account: { user_info: { auth: 1, allowed_output_formats: ["m3u8", "ts"] } },
	get_live_streams: [
		{
			num: 1,
			name: "BE| VRT 1",
			stream_id: 3,
			category_id: "1",
			epg_channel_id: "vrt1.be",
			stream_icon: "http://img.example/vrt.png",
			added: "1700000000",
		},
		{ name: "Broken", stream_id: "x" },
	],
	get_live_categories: [{ category_id: "1", category_name: "Belgium" }],
	get_vod_streams: [
		{
			name: "EN - Film (2021)",
			stream_id: 5,
			container_extension: "mkv",
			rating: "7.1",
			added: "1700000100",
			stream_icon: "https://image.tmdb.org/t/p/w600_and_h900_bestv2/f.jpg",
		},
	],
	get_vod_categories: [],
	get_series: [
		{
			name: "NL - Show",
			series_id: 9,
			genre: "Drama / Comedy",
			plot: "A show",
			last_modified: "1700000200",
			cover: "https://image.tmdb.org/t/p/original/s.jpg",
		},
	],
	get_series_categories: [],
	get_vod_info: {
		info: {
			plot: "Plot",
			cast: "A, B",
			director: "D",
			genre: "Thriller, Action",
			duration_secs: 5340,
			releasedate: "2021-02-03",
			backdrop_path: ["https://image.tmdb.org/t/p/w1280/b.jpg"],
			rating: 6.5,
		},
	},
	get_series_info: {
		info: { plot: "Longer plot" },
		episodes: {
			"1": [
				{
					id: "101",
					episode_num: 2,
					season: 1,
					title: "NL - Show - S01E02 - Second",
					container_extension: "mp4",
					info: { duration_secs: 1800 },
				},
				{
					id: "100",
					episode_num: 1,
					season: 1,
					title: "NL - Show - S01E01 - First",
					container_extension: "mkv",
					info: {},
				},
			],
		},
	},
	get_short_epg: {
		epg_listings: [
			{
				title: btoa("Journaal"),
				description: btoa("Nieuws"),
				start_timestamp: "1700000000",
				stop_timestamp: "1700001800",
			},
			{ title: btoa("Weer"), start_timestamp: "1700001800", stop_timestamp: "1700002400" },
		],
	},
};

describe("Xtream API", () => {
	it("loads live, films and series with metadata", async () => {
		const catalog = await loadXtreamCatalog(config, api(xtreamResponses));
		expect(catalog.xtream).toMatchObject({ liveExt: "ts", hls: true });
		expect(catalog.channels).toEqual([
			expect.objectContaining({
				pid: "3",
				title: "VRT 1",
				group: "Belgium",
				epgId: "vrt1.be",
				number: 1,
			}),
		]);
		expect(catalog.movies).toEqual([
			expect.objectContaining({ pid: "5", title: "Film", year: 2021, ext: "mkv", rating: 7.1 }),
		]);
		expect(catalog.series).toEqual([
			expect.objectContaining({ pid: "9", title: "Show", genres: ["Drama", "Comedy"] }),
		]);
		const vod = await getVodInfo(config, api(xtreamResponses), "5");
		expect(vod).toMatchObject({
			plot: "Plot",
			cast: ["A", "B"],
			year: 2021,
			durationSeconds: 5340,
		});
		const series = await getSeriesInfo(config, api(xtreamResponses), catalog.series[0]!);
		expect(series.series.plot).toBe("Longer plot");
		expect(series.episodes.map((episode) => [episode.episode, episode.title, episode.ext])).toEqual(
			[
				[1, "First", "mkv"],
				[2, "Second", "mp4"],
			],
		);
		const epg = await getShortEpg(config, api(xtreamResponses), "3");
		expect(epg[0]).toEqual({
			title: "Journaal",
			description: "Nieuws",
			start: 1700000000000,
			end: 1700001800000,
		});

		const full = { source: "ab12", loadedAt: 0, ...catalog };
		const live = await resolveStream(
			full,
			{ source: "ab12", kind: "live", pid: "3" },
			{ seriesInfo: async () => series },
		);
		expect(live.url.href).toBe(`${provider}/live/demo/test-secret/3.ts`);
		expect(live.fallback?.href).toBe(`${provider}/live/demo/test-secret/3.m3u8`);
		const hls = await resolveStream(
			full,
			{ source: "ab12", kind: "live", pid: "3" },
			{ preferHls: true, seriesInfo: async () => series },
		);
		expect(hls).toMatchObject({ format: "hls", fallback: undefined });
		const episode = await resolveStream(
			full,
			{ source: "ab12", kind: "ep", pid: "9_100" },
			{ seriesInfo: async () => series },
		);
		expect(episode.url.href).toBe(`${provider}/series/demo/test-secret/100.mkv`);
	});

	it("searches and builds shelves through the shared service", async () => {
		const catalog = {
			source: "ab12",
			loadedAt: 0,
			...(await loadXtreamCatalog(config, api(xtreamResponses))),
		};
		const states = new Map<string, { favorite: boolean }>();
		const backend: IptvBackend = {
			sourceIds: async () => ["ab12"],
			options: async () => ({ hiddenGroups: [], showAdult: false }),
			schedule: async () => [],
			catalog: async () => catalog,
			vodInfo: async () => undefined,
			seriesInfo: async () => ({ series: catalog.series[0]!, episodes: [] }),
			epg: async () => new Map(),
			art: (raw) => raw,
			state: {
				get: async (ids) =>
					new Map(ids.flatMap((id) => (states.has(id) ? [[id, states.get(id)!]] : []))),
				list: async () => [],
				update: async (id, patch) => void states.set(id, { favorite: Boolean(patch.favorite) }),
			},
		};
		states.set("iptv:ab12:vod:5", { favorite: true });
		const results = await searchIptv(backend, "fil");
		expect(results.movies).toEqual([
			expect.objectContaining({ id: "iptv:ab12:vod:5", type: "movie", isFavorite: true }),
		]);
		expect(results.channels).toEqual([]);
		// Typos and word order still find titles; series are found by their cast.
		expect((await searchIptv(backend, "shwo")).series?.[0]?.id).toBe("iptv:ab12:series:9");
		expect(JSON.stringify(results)).not.toContain("test-secret");
		const shelves = await iptvShelves(backend);
		expect(shelves.live[0]).toMatchObject({ type: "channel", live: true });
		expect(shelves.movies[0]?.id).toBe("iptv:ab12:vod:5");
		expect(shelves.series[0]?.id).toBe("iptv:ab12:series:9");
	});
});

describe("XMLTV", () => {
	it("parses times with offsets", () => {
		expect(parseXmltvTime("20261120224500 +0100")).toBe(Date.UTC(2026, 10, 20, 21, 45));
		expect(parseXmltvTime("20261120224500")).toBe(Date.UTC(2026, 10, 20, 22, 45));
	});

	it("keeps wanted channels in the window across chunk boundaries", () => {
		const now = Date.UTC(2026, 10, 20, 22, 0);
		const reader = createXmltvReader(new Set(["a.be"]), now, 3 * 3600_000, 0);
		const xml = [
			'<tv><channel id="a.be"><display-name>A</display-name></channel>',
			'<programme start="20261120200000 +0000" stop="20261120210000 +0000" channel="a.be"><title>Old</title></programme>',
			'<programme start="20261120213000 +0000" stop="20261120223000 +0000" channel="a.be"><title lang="nl">Nu &amp; hier</title><desc>Beschrijving</desc></programme>',
			'<programme start="20261120223000 +0000" stop="20261120233000 +0000" channel="b.be"><title>Other</title></programme>',
			'<programme start="20261120223000 +0000" stop="20261120233000 +0000" channel="a.be"><title><![CDATA[Straks]]></title></programme>',
			"</tv>",
		].join("");
		for (let index = 0; index < xml.length; index += 37) reader.push(xml.slice(index, index + 37));
		expect(reader.finish().get("a.be")).toEqual([
			{
				title: "Nu & hier",
				description: "Beschrijving",
				start: Date.UTC(2026, 10, 20, 21, 30),
				end: Date.UTC(2026, 10, 20, 22, 30),
			},
			{
				title: "Straks",
				description: undefined,
				start: Date.UTC(2026, 10, 20, 22, 30),
				end: Date.UTC(2026, 10, 20, 23, 30),
			},
		]);
	});
});

describe("catch-up and categories", () => {
	it("builds timeshift links in the panel's time zone", async () => {
		const { timeshiftStart, xtreamTimeshiftUrl } = await import("./xtream");
		const start = Date.UTC(2026, 10, 21, 12, 0);
		expect(timeshiftStart(start, "Europe/Amsterdam")).toBe("2026-11-21:13-00");
		expect(timeshiftStart(start)).toBe("2026-11-21:12-00");
		const url = xtreamTimeshiftUrl(
			{ ...config, liveExt: "ts", hls: true, timezone: "Europe/Amsterdam" },
			"3",
			start,
			30,
		);
		expect(url.href).toBe(`${provider}/timeshift/demo/test-secret/30/2026-11-21:13-00/3.m3u8`);
	});

	it("resolves recordings only inside the archive window", async () => {
		const { replayPid } = await import("./ids");
		const catalog = {
			source: "ab12",
			loadedAt: 0,
			...(await loadXtreamCatalog(config, api(xtreamResponses))),
		};
		catalog.channels[0] = { ...catalog.channels[0]!, archiveDays: 2 };
		const end = Date.now() - 3600_000;
		const recent = replayPid("3", end - 1800_000, end);
		const target = await resolveStream(
			catalog,
			{ source: "ab12", kind: "arc", pid: recent },
			{ seriesInfo: async () => ({ series: catalog.series[0]!, episodes: [] }) },
		);
		expect(target).toMatchObject({ format: "hls", live: false, durationSeconds: 1800 });
		const old = replayPid("3", Date.now() - 5 * 86400_000, Date.now() - 5 * 86400_000 + 60_000);
		await expect(
			resolveStream(
				catalog,
				{ source: "ab12", kind: "arc", pid: old },
				{ seriesInfo: async () => ({ series: catalog.series[0]!, episodes: [] }) },
			),
		).rejects.toThrow();
	});

	it("hides categories and adult content from the browsing view", async () => {
		const { visibleCatalog, catalogGroups } = await import("./catalog");
		const catalog = {
			source: "ab12",
			loadedAt: 0,
			...(await loadXtreamCatalog(config, api(xtreamResponses))),
		};
		catalog.movies.push({ ...catalog.movies[0]!, pid: "6", adult: true });
		const view = visibleCatalog(catalog, { hiddenGroups: ["live:Belgium"], showAdult: false });
		expect(view.channels).toHaveLength(0);
		expect(view.movies.map((movie) => movie.pid)).toEqual(["5"]);
		expect(visibleCatalog(catalog, { hiddenGroups: [], showAdult: true })).toBe(catalog);
		expect(catalogGroups(catalog).find((group) => group.kind === "live")).toMatchObject({
			name: "Belgium",
			count: 1,
		});
	});
});
