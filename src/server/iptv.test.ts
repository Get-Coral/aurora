import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IptvEntry } from "../lib/iptv";
import { iptvRequest } from "./iptv";

const { authorized } = vi.hoisted(() => ({ authorized: vi.fn() }));
vi.mock("../lib/auth-store", () => ({ isRequestAuthorized: authorized }));

const aurora = "https://aurora.example";
const provider = "http://provider.example";
const fetchMock = vi.fn<typeof fetch>();

function load(source: object) {
	return iptvRequest(
		new Request(`${aurora}/api/iptv`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: aurora },
			body: JSON.stringify(source),
		}),
	);
}

function play(src: string, headers?: HeadersInit) {
	return iptvRequest(new Request(new URL(src, aurora), { headers }));
}

describe("IPTV routes", () => {
	beforeEach(() => {
		vi.stubEnv("AURORA_IPTV_ORIGINS", provider);
		vi.stubGlobal("fetch", fetchMock);
		authorized.mockReturnValue(true);
		fetchMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("loads an Xtream catalog and proxies a TS channel without exposing its upstream URL", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				[
					"#EXTM3U",
					'#EXTINF:-1 group-title="News, Local",News HD',
					"/live/demo/test-secret/1.ts",
					"#EXTINF:-1,Movie",
					"/movie/demo/test-secret/2.mp4",
				].join("\n"),
			),
		);
		const result = await load({
			mode: "xtream",
			server: provider,
			username: "demo",
			password: "test-secret",
		});
		expect(result.status).toBe(200);
		const [url] = fetchMock.mock.calls[0] ?? [];
		expect(String(url)).toBe(
			`${provider}/get.php?username=demo&password=test-secret&type=m3u_plus&output=ts`,
		);
		const body = await result.text();
		expect(body).not.toContain("test-secret");
		expect(body).not.toContain(provider);
		const entries: IptvEntry[] = JSON.parse(body);
		expect(entries).toMatchObject([
			{ title: "News HD", group: "News, Local", vod: false, format: "ts" },
			{ title: "Movie", vod: true, format: "file" },
		]);
		fetchMock.mockResolvedValueOnce(
			new Response("ts bytes", { headers: { "content-type": "video/mp2t" } }),
		);
		const stream = await play(entries[0].src);
		expect(await stream.text()).toBe("ts bytes");
		expect(stream.headers.get("cache-control")).toBe("no-store");

		fetchMock.mockResolvedValueOnce(
			new Response("movie bytes", { status: 206, headers: { "content-range": "bytes 0-10/100" } }),
		);
		const partial = await play(entries[1].src, { range: "bytes=0-10" });
		expect(partial.status).toBe(206);
		expect(partial.headers.get("content-range")).toBe("bytes 0-10/100");
		expect(fetchMock.mock.lastCall?.[1]?.headers).toEqual({ range: "bytes=0-10" });
	});

	it("accepts an Xtream M3U link pasted with a trailing comma", async () => {
		const playlist = `${provider}/get.php?username=demo&password=placeholder&type=m3u_plus&output=ts`;
		fetchMock.mockResolvedValueOnce(new Response("#EXTM3U\n#EXTINF:-1,Local\n/live.ts"));
		expect((await load({ mode: "m3u", playlist: `${playlist},` })).status).toBe(200);
		expect(String(fetchMock.mock.lastCall?.[0])).toBe(playlist);
	});

	it("rewrites nested HLS URLs, segments and encryption keys", async () => {
		fetchMock
			.mockResolvedValueOnce(new Response("#EXTM3U\n#EXTINF:-1,Live\n/live/master.m3u8"))
			.mockResolvedValueOnce(
				new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nvariant.m3u8"),
			)
			.mockResolvedValueOnce(
				new Response(
					'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key?secret=demo"\n#EXTINF:4,\nclip.ts',
				),
			)
			.mockResolvedValueOnce(new Response("test segment"));
		const result = await load({ mode: "m3u", playlist: `${provider}/channels.m3u` });
		const [entry]: IptvEntry[] = await result.json();
		const master = await (await play(entry.src)).text();
		const variant = await (await play(master.split("\n")[2])).text();
		expect(variant).toMatch(/URI="\/api\/iptv\?token=/);
		expect(variant).not.toContain("secret");
		expect(await (await play(variant.split("\n")[3])).text()).toBe("test segment");
		expect(String(fetchMock.mock.lastCall?.[0])).toBe(`${provider}/live/clip.ts`);
	});

	it("rejects unauthorized requests, unapproved redirects and forged tokens", async () => {
		const source = { mode: "m3u", playlist: `${provider}/channels.m3u` };
		authorized.mockReturnValueOnce(false);
		expect((await load(source)).status).toBe(401);
		expect(fetchMock).not.toHaveBeenCalled();
		fetchMock.mockResolvedValueOnce(
			new Response(null, { status: 302, headers: { location: "http://other.example/list" } }),
		);
		const blocked = await load(source);
		expect(blocked.status).toBe(502);
		expect(await blocked.json()).toEqual({ code: "origin" });
		expect((await play("/api/iptv?token=invalid")).status).toBe(502);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
