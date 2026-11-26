import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-iptv-"));
process.env.AURORA_DATA_DIR = dataDir;
delete process.env.AURORA_IPTV_SOURCE_KEY;
delete process.env.AURORA_IPTV_FFMPEG;

const { authorized } = vi.hoisted(() => ({ authorized: vi.fn() }));
vi.mock("../lib/auth-store", () => ({
	isRequestAuthorized: authorized,
	getSessionByTokenHash: () => null,
	getSessionByToken: () => null,
	isLoginEnforced: () => false,
	SESSION_COOKIE_NAME: "aurora_session",
}));
vi.mock("@tanstack/react-start/server", () => ({ getCookie: () => undefined }));

const aurora = "https://aurora.example";
const provider = "http://provider.example";
const fetchMock = vi.fn<typeof fetch>();

async function modules() {
	const [{ iptvRequest }, store, backend, tokens] = await Promise.all([
		import("./iptv"),
		import("../lib/iptv-source-store"),
		import("./iptv/backend"),
		import("./iptv/tokens"),
	]);
	return { iptvRequest, store, backend, tokens };
}

async function get(target: string, headers?: HeadersInit) {
	const { iptvRequest } = await modules();
	return iptvRequest(new Request(new URL(target, aurora), { headers }));
}

async function addPlaylist(lines: string[]) {
	const { store, backend } = await modules();
	for (const id of store.listIptvSourceIds()) store.deleteIptvSource(id);
	const id = store.saveIptvSource({ kind: "m3u", url: `${provider}/channels.m3u` });
	fetchMock.mockResolvedValueOnce(new Response(["#EXTM3U", ...lines].join("\n")));
	const catalog = await backend.loadServerCatalog(id);
	return { id, catalog };
}

afterAll(() => {
	try {
		fs.rmSync(dataDir, { recursive: true, force: true });
	} catch {
		// The SQLite handle stays open for the process lifetime.
	}
});

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

	it("plays a channel and a film by id without exposing the upstream URL", async () => {
		const { id, catalog } = await addPlaylist([
			'#EXTINF:-1 group-title="News",News HD',
			"/live/demo/test-secret/1.ts",
			"#EXTINF:-1,Movie",
			"/movie/demo/test-secret/2.mp4",
		]);
		const channel = `iptv:${id}:live:${catalog.channels[0]?.pid}`;
		const movie = `iptv:${id}:vod:${catalog.movies[0]?.pid}`;

		fetchMock.mockResolvedValueOnce(
			new Response("ts bytes", { headers: { "content-type": "video/mp2t" } }),
		);
		const stream = await get(`/api/iptv?id=${channel}`);
		expect(await stream.text()).toBe("ts bytes");
		expect(stream.headers.get("cache-control")).toBe("no-store");
		expect(String(fetchMock.mock.lastCall?.[0])).toBe(`${provider}/live/demo/test-secret/1.ts`);

		fetchMock.mockResolvedValueOnce(
			new Response("movie bytes", { status: 206, headers: { "content-range": "bytes 0-10/100" } }),
		);
		const partial = await get(`/api/iptv?id=${movie}`, { range: "bytes=0-10" });
		expect(partial.status).toBe(206);
		expect(partial.headers.get("content-range")).toBe("bytes 0-10/100");
		expect(fetchMock.mock.lastCall?.[1]?.headers).toMatchObject({ range: "bytes=0-10" });

		expect((await get(`/api/iptv?id=iptv:${id}:live:unknown`)).status).toBe(404);
		expect((await get("/api/iptv?id=iptv:000000000000:live:1")).status).toBe(404);
	});

	it("rewrites nested HLS, keys and segments with links that survive a restart", async () => {
		const { id, catalog } = await addPlaylist(["#EXTINF:-1,Live", "/live/master.m3u8"]);
		const channel = `iptv:${id}:live:${catalog.channels[0]?.pid}`;
		fetchMock
			.mockResolvedValueOnce(
				new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nvariant.m3u8"),
			)
			.mockResolvedValueOnce(
				new Response(
					'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key?secret=demo"\n#EXTINF:4,\nclip.ts',
				),
			);
		const master = await (await get(`/api/iptv?id=${channel}`)).text();
		const variant = await (await get(master.split("\n")[2] ?? "")).text();
		expect(variant).toMatch(/URI="\/api\/iptv\?token=/);
		expect(variant).not.toContain("secret");

		vi.resetModules();
		fetchMock.mockResolvedValueOnce(new Response("test segment"));
		expect(await (await get(variant.split("\n")[3] ?? "")).text()).toBe("test segment");
		expect(String(fetchMock.mock.lastCall?.[0])).toBe(`${provider}/live/clip.ts`);
	});

	it("follows provider redirects to public load balancers only", async () => {
		const { id, catalog } = await addPlaylist(["#EXTINF:-1,Live", "/live/1.ts"]);
		const channel = `iptv:${id}:live:${catalog.channels[0]?.pid}`;
		fetchMock
			.mockResolvedValueOnce(
				new Response(null, { status: 302, headers: { location: "http://203.0.113.9/play/1" } }),
			)
			.mockResolvedValueOnce(new Response("balanced"));
		expect(await (await get(`/api/iptv?id=${channel}`)).text()).toBe("balanced");

		fetchMock.mockResolvedValueOnce(
			new Response(null, { status: 302, headers: { location: "http://10.0.0.5/admin" } }),
		);
		expect((await get(`/api/iptv?id=${channel}`)).status).toBe(421);

		vi.stubEnv("AURORA_IPTV_STRICT_ORIGINS", "true");
		fetchMock.mockResolvedValueOnce(
			new Response(null, { status: 302, headers: { location: "http://203.0.113.9/play/1" } }),
		);
		expect((await get(`/api/iptv?id=${channel}`)).status).toBe(421);
		expect(fetchMock).toHaveBeenCalledTimes(5);
	});

	it("rejects unauthorized requests, forged links and unknown images", async () => {
		const { id, catalog } = await addPlaylist(["#EXTINF:-1,Live", "/live/1.ts"]);
		const channel = `iptv:${id}:live:${catalog.channels[0]?.pid}`;
		authorized.mockReturnValue(false);
		expect((await get(`/api/iptv?id=${channel}`)).status).toBe(401);

		const { mintStreamToken, OPEN_SESSION_REF } = await import("../lib/stream-token");
		const other = mintStreamToken({
			itemId: `iptv:${id}:live:other`,
			sessionRef: OPEN_SESSION_REF,
		});
		expect((await get(`/api/iptv?id=${channel}&st=${other.token}`)).status).toBe(401);
		const valid = mintStreamToken({ itemId: channel, sessionRef: OPEN_SESSION_REF });
		fetchMock.mockResolvedValueOnce(new Response("cast"));
		expect(await (await get(`/api/iptv?id=${channel}&st=${valid.token}`)).text()).toBe("cast");

		authorized.mockReturnValue(true);
		expect((await get("/api/iptv?token=invalid")).status).toBe(410);
		const { tokens } = await modules();
		const signed = tokens.signedImagePath("http://203.0.113.9/logo.png");
		expect((await get(signed.replace(/sig=[^&]+/, "sig=forged"))).status).toBe(404);
		fetchMock.mockResolvedValueOnce(
			new Response("<html>", { headers: { "content-type": "text/html" } }),
		);
		expect((await get(signed)).status).toBe(415);
		fetchMock.mockResolvedValueOnce(
			new Response("png", { headers: { "content-type": "image/png" } }),
		);
		const logo = await get(signed);
		expect(logo.status).toBe(200);
		expect(logo.headers.get("cache-control")).toContain("max-age");
	});

	it("never lists credentials and drops a legacy cookie source into the list", async () => {
		const { store } = await modules();
		for (const id of store.listIptvSourceIds()) store.deleteIptvSource(id);
		store.saveIptvSource({
			kind: "m3u",
			url: `${provider}/get.php?username=demo&password=test-secret&type=m3u_plus&output=ts`,
		});
		const listed = JSON.stringify(store.listIptvSources());
		expect(listed).not.toContain("test-secret");
		expect(store.listIptvSources()[0]).toMatchObject({ kind: "xtream", username: "demo" });
		expect(fs.readFileSync(path.join(dataDir, "aurora.sqlite")).toString("latin1")).not.toContain(
			"test-secret",
		);
	});

	it("keeps streaming a body past the connect timeout", async () => {
		const { upstream } = await import("./iptv/network");
		let signal: AbortSignal | undefined;
		fetchMock.mockImplementationOnce(async (_url, init) => {
			signal = init?.signal ?? undefined;
			return new Response(
				new ReadableStream({
					async start(controller) {
						await new Promise((resolve) => setTimeout(resolve, 80));
						controller.enqueue(new TextEncoder().encode("still streaming"));
						controller.close();
					},
				}),
			);
		});
		const { response } = await upstream(
			new URL(`${provider}/live/1.ts`),
			new AbortController().signal,
			{
				timeoutMs: 20,
			},
		);
		expect(await response.text()).toBe("still streaming");
		expect(signal?.aborted).toBe(false);
	});

	it("serves the catalog from disk after a restart, even when the provider is down", async () => {
		const { id, catalog } = await addPlaylist(["#EXTINF:-1,Saved channel", "/live/saved.ts"]);
		await new Promise((resolve) => setTimeout(resolve, 100));
		const cacheDir = path.join(dataDir, "iptv-cache");
		const file = fs.readdirSync(cacheDir).find((name) => name.startsWith(`${id}.catalog`));
		expect(file).toBeDefined();
		// Encrypted at rest: no provider URLs in the file.
		expect(fs.readFileSync(path.join(cacheDir, file as string)).toString("latin1")).not.toContain(
			"provider.example",
		);
		vi.resetModules();
		fetchMock.mockRejectedValue(new Error("provider down"));
		const { backend } = await modules();
		const restored = await backend.loadServerCatalog(id);
		expect(restored.channels.map((channel) => channel.title)).toEqual(
			catalog.channels.map((channel) => channel.title),
		);
		fetchMock.mockReset();
	});
});
