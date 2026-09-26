import { describe, expect, it } from "vitest";
import { buildProxyPath, isAllowedMediaPath, rewriteHlsManifest } from "./hls-rewrite";

const ITEM = "3fa85f6457174562b3fc2c963f66afa6";
const PLAYLIST = new URL(`http://jellyfin.local:8096/videos/${ITEM}/main.m3u8?api_key=secret`);
const TOKEN = "1.1800000000.3fa85f6457174562b3fc2c963f66afa6.abc.sig";

function proxied(line: string) {
	return new URL(line, "http://x");
}

describe("isAllowedMediaPath", () => {
	it("allows video and audio paths, case-insensitively", () => {
		expect(isAllowedMediaPath("/videos/x/stream.mp4")).toBe(true);
		expect(isAllowedMediaPath("/Videos/x/stream.mp4")).toBe(true);
		expect(isAllowedMediaPath("/Audio/x/universal")).toBe(true);
	});

	it("rejects everything else", () => {
		expect(isAllowedMediaPath("/Items/x/Images/Primary")).toBe(false);
		expect(isAllowedMediaPath("/Users")).toBe(false);
	});
});

describe("buildProxyPath", () => {
	it("omits the token when there isn't one", () => {
		expect(buildProxyPath("/videos/a/0.ts")).toBe("/api/jellyfin-stream?path=%2Fvideos%2Fa%2F0.ts");
	});

	it("appends the token when there is one", () => {
		expect(buildProxyPath("/videos/a/0.ts", TOKEN)).toContain(`&st=${encodeURIComponent(TOKEN)}`);
	});
});

describe("rewriteHlsManifest", () => {
	const manifest = [
		"#EXTM3U",
		"#EXT-X-VERSION:3",
		"#EXT-X-TARGETDURATION:6",
		'#EXT-X-KEY:METHOD=AES-128,URI="/videos/ITEM/hls1/main/key"',
		'#EXT-X-MAP:URI="/videos/ITEM/hls1/main/init.mp4"',
		"#EXTINF:6.000000,",
		"hls1/main/0.ts",
		"#EXTINF:6.000000,",
		"/videos/ITEM/hls1/main/1.ts",
		"#EXT-X-ENDLIST",
		"",
	]
		.join("\n")
		.replaceAll("ITEM", ITEM);

	it("rewrites segments and keeps comments intact", () => {
		const output = rewriteHlsManifest(manifest, PLAYLIST);
		const lines = output.split("\n");

		expect(lines[0]).toBe("#EXTM3U");
		expect(lines[1]).toBe("#EXT-X-VERSION:3");
		expect(lines[9]).toBe("#EXT-X-ENDLIST");
		expect(lines[6]).toContain("/api/jellyfin-stream?path=");
		// Relative segment URIs resolve against the playlist's directory.
		expect(proxied(lines[6] as string).searchParams.get("path")).toBe(
			`/videos/${ITEM}/hls1/main/0.ts`,
		);
	});

	it("gives every rewritten URI the token when one is supplied", () => {
		const output = rewriteHlsManifest(manifest, PLAYLIST, TOKEN);

		const rewritten = output
			.split("\n")
			.filter((line) => line.includes("/api/jellyfin-stream?path="));

		// segment x2, #EXT-X-KEY, #EXT-X-MAP
		expect(rewritten).toHaveLength(4);
		for (const line of rewritten) {
			expect(line).toContain(`&st=${encodeURIComponent(TOKEN)}`);
		}
	});

	it("gives no URI a token when none is supplied", () => {
		const output = rewriteHlsManifest(manifest, PLAYLIST);
		expect(output).not.toContain("&st=");
	});

	it("rewrites the decryption key and init map", () => {
		const output = rewriteHlsManifest(manifest, PLAYLIST, TOKEN);

		expect(output).toContain('#EXT-X-KEY:METHOD=AES-128,URI="/api/jellyfin-stream?path=');
		expect(output).toContain('#EXT-X-MAP:URI="/api/jellyfin-stream?path=');
	});

	it("rewrites #EXT-X-MEDIA renditions in a master playlist", () => {
		const master = [
			"#EXTM3U",
			`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="/videos/${ITEM}/hls1/alt/main.m3u8"`,
			"#EXT-X-STREAM-INF:BANDWIDTH=8000000",
			`/videos/${ITEM}/hls1/main/main.m3u8`,
		].join("\n");

		const output = rewriteHlsManifest(master, PLAYLIST, TOKEN);
		expect(output.split("\n")[1]).toContain("/api/jellyfin-stream?path=");
		expect(output.split("\n")[3]).toContain(`&st=${encodeURIComponent(TOKEN)}`);
	});

	it("strips Jellyfin's own key out of every rewritten URI", () => {
		// Jellyfin writes ApiKey into the URIs of the manifest it generates.
		// Passing them through would hand the browser -- and any receiver -- a
		// live access token.
		const withKeys = [
			"#EXTM3U",
			`/videos/${ITEM}/hls1/main/0.ts?ApiKey=supersecret&Tag=abc`,
			`#EXT-X-KEY:METHOD=AES-128,URI="/videos/${ITEM}/hls1/main/key?api_key=supersecret"`,
		].join("\n");

		for (const token of [undefined, TOKEN]) {
			const output = rewriteHlsManifest(withKeys, PLAYLIST, token);
			expect(output).not.toContain("supersecret");
			expect(output).not.toContain("ApiKey");
			expect(output).not.toContain("api_key");
			// Everything else about the URI survives.
			expect(output).toContain("Tag%3Dabc");
		}
	});

	it("leaves cross-origin and non-media URIs alone", () => {
		const input = [
			"#EXTM3U",
			"https://cdn.example.com/segment.ts",
			"/Items/abc/Images/Primary",
			'#EXT-X-KEY:METHOD=NONE,URI="data:text/plain,nope"',
		].join("\n");

		expect(rewriteHlsManifest(input, PLAYLIST, TOKEN)).toBe(input);
	});

	it("preserves blank lines and carriage returns", () => {
		const input = "#EXTM3U\r\n\r\n#EXT-X-ENDLIST\r\n";
		expect(rewriteHlsManifest(input, PLAYLIST, TOKEN)).toBe(input);
	});
});
