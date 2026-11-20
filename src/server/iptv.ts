import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { isRequestAuthorized } from "../lib/auth-store";
import { httpUrl, m3uPlaylist, parseIptvPlaylist, xtreamPlaylist } from "../lib/iptv";
import { loadXtreamCatalog } from "./xtream";

const key = randomBytes(32);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const maxPlaylistBytes = 32 * 1024 * 1024;

class IptvSourceError extends Error {
	constructor(
		readonly code: "origin" | "provider",
		readonly status?: number,
	) {
		super("IPTV source request failed");
	}
}

function allowed(url: URL) {
	return (process.env.AURORA_IPTV_ORIGINS ?? "")
		.split(",")
		.some((origin) => origin.trim() === url.origin);
}

function streamPath(url: URL, format: string) {
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, nonce);
	const payload = Buffer.concat([cipher.update(url.href, "utf8"), cipher.final()]);
	const token = Buffer.concat([nonce, cipher.getAuthTag(), payload]).toString("base64url");
	return `/api/iptv?token=${token}&format=${format}`;
}

function readToken(token: string) {
	const data = Buffer.from(token, "base64url");
	const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
	decipher.setAuthTag(data.subarray(12, 28));
	return httpUrl(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
}

// Check every hop before contacting it. Never forward browser cookies or authorization headers.
async function upstream(initial: URL, signal: AbortSignal, range?: string | null) {
	let url = initial;
	for (let hops = 0; hops <= 5; hops++) {
		if (!allowed(url)) throw new IptvSourceError("origin");
		const timeout = new AbortController();
		const timer = setTimeout(() => timeout.abort(), 15_000);
		let response: Response;
		try {
			response = await fetch(url, {
				redirect: "manual",
				signal: AbortSignal.any([signal, timeout.signal]),
				headers: range ? { range } : undefined,
			});
		} finally {
			clearTimeout(timer);
		}
		const location = response.headers.get("location");
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel();
			url = httpUrl(location, url);
			continue;
		}
		if (response.ok) return { response, url };
		await response.body?.cancel();
		throw new IptvSourceError("provider", response.status);
	}
	throw new Error("Too many IPTV redirects");
}

async function readText(response: Request | Response, limit: number) {
	if (!response.body) throw new Error("Empty playlist");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = "";
	const deadline = AbortSignal.timeout(30_000);
	const cancel = () => {
		void reader.cancel().catch(() => {});
	};
	deadline.addEventListener("abort", cancel, { once: true });
	try {
		while (true) {
			const chunk = await reader.read();
			deadline.throwIfAborted();
			if (chunk.done) return text + decoder.decode();
			bytes += chunk.value.byteLength;
			if (bytes > limit) throw new Error("Playlist is too large");
			text += decoder.decode(chunk.value, { stream: true });
		}
	} finally {
		deadline.removeEventListener("abort", cancel);
		await reader.cancel();
	}
}

export async function iptvRequest(request: Request) {
	if (!isRequestAuthorized(request)) return new Response(null, { status: 401, headers });
	if (request.method !== "POST" && !process.env.AURORA_IPTV_ORIGINS?.trim()) {
		return new Response(null, { status: 503, headers });
	}
	try {
		const address = new URL(request.url);
		if (request.method === "POST") {
			if (
				(request.headers.get("origin") && request.headers.get("origin") !== address.origin) ||
				!request.headers.get("content-type")?.startsWith("application/json")
			) {
				return new Response(null, { status: 403, headers });
			}
			const body = JSON.parse(await readText(request, 16 * 1024));
			const responseHeaders = new Headers(headers);
			const sourceId = request.headers
				.get("cookie")
				?.match(/(?:^|;\s*)aurora_iptv_source=([a-f0-9]{64})(?:;|$)/)?.[1];
			if (body.action === "jellyfin" || body.action === "forget" || body.action === "iptv-home") {
				const { forgetIptvSource, setIptvHome } = await import("../lib/iptv-source-store");
				if (body.action === "forget") forgetIptvSource(sourceId);
				else setIptvHome(sourceId, body.action === "iptv-home");
				return new Response(null, { status: 204, headers });
			}
			const saved =
				body.action === "load-saved"
					? (await import("../lib/iptv-source-store")).loadIptvSource(sourceId)
					: null;
			if (body.action === "load-saved" && !saved)
				return new Response(null, { status: 404, headers });
			if (!process.env.AURORA_IPTV_ORIGINS?.trim())
				return new Response(null, { status: 503, headers });
			const input = saved
				? httpUrl(saved.input)
				: body.mode === "xtream"
					? xtreamPlaylist(body.server, body.username, body.password)
					: m3uPlaylist(body.playlist);
			const direct = saved?.direct ?? body.mode === "stream";
			const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
			async function loadPlaylist() {
				const { response, url } = await upstream(input, signal);
				return parseIptvPlaylist(await readText(response, maxPlaylistBytes), url);
			}
			const catalog = direct
				? null
				: await loadXtreamCatalog(input, async (endpoint) => {
						const { response } = await upstream(endpoint, signal);
						return JSON.parse(await readText(response, maxPlaylistBytes));
					}).catch(() => null);
			if (direct && !allowed(input)) throw new IptvSourceError("origin");
			const format = /\.ts$/i.test(input.pathname)
				? "ts"
				: /\.(mp4|mkv|mov|webm)$/i.test(input.pathname)
					? "file"
					: "hls";
			const sourceEntries = direct
				? [
						{
							title: input.hostname,
							group: "",
							vod: format === "file",
							format,
							url: input,
						},
					]
				: catalog?.length
					? catalog
					: await loadPlaylist();
			const entries = sourceEntries
				.filter((entry) => allowed(entry.url))
				.map(({ url: stream, ...entry }) => {
					const { fallbackUrl, ...item } = { fallbackUrl: undefined, ...entry };
					return {
						...item,
						src: streamPath(stream, item.format),
						fallbackSrc: fallbackUrl ? streamPath(fallbackUrl, "hls") : undefined,
					};
				});

			if (body.saveHome === "on" && entries.length) {
				const { saveIptvSource, IPTV_SOURCE_COOKIE, IPTV_SOURCE_MAX_AGE } = await import(
					"../lib/iptv-source-store"
				);
				const id = saveIptvSource(sourceId, input, direct);
				responseHeaders.set(
					"set-cookie",
					`${IPTV_SOURCE_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${IPTV_SOURCE_MAX_AGE}${address.protocol === "https:" ? "; Secure" : ""}`,
				);
			}
			if (saved || (body.saveHome === "on" && entries.length))
				responseHeaders.set("x-aurora-iptv-saved", "1");
			if (saved?.home || (body.saveHome === "on" && entries.length))
				responseHeaders.set("x-aurora-iptv-home", "1");
			return Response.json(entries, { headers: responseHeaders });
		}

		let target: URL;
		try {
			target = readToken(address.searchParams.get("token") ?? "");
		} catch {
			return new Response(null, { status: 410, headers });
		}
		const format = address.searchParams.get("format");
		const ffmpeg = /\.mkv$/i.test(target.pathname) ? process.env.AURORA_IPTV_FFMPEG : undefined;
		const { response, url } = await upstream(
			target,
			request.signal,
			ffmpeg ? null : request.headers.get("range"),
		);
		if (ffmpeg && response.body) {
			const { transcodeIptv } = await import("./iptv-transcode");
			return new Response(await transcodeIptv(response.body, ffmpeg, request.signal), {
				headers: { ...headers, "content-type": "video/mp4" },
			});
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (format === "hls" || /\.m3u8$/i.test(url.pathname) || /mpegurl/i.test(contentType)) {
			const manifest = await readText(response, 2 * 1024 * 1024);
			if (!/^#EXTM3U\b/.test(manifest.trimStart())) throw new Error("Invalid HLS manifest");
			const proxy = (uri: string) => streamPath(httpUrl(uri, url), "file");
			const rewritten = manifest
				.split(/\r?\n/)
				.map((raw) => {
					const line = raw.trim();
					if (!line) return line;
					if (!line.startsWith("#")) return proxy(line);
					return line.replace(/\bURI="([^"]+)"/g, (_, uri) => `URI="${proxy(uri)}"`);
				})
				.join("\n");
			return new Response(rewritten, {
				headers: { ...headers, "content-type": "application/vnd.apple.mpegurl" },
			});
		}
		const mediaHeaders = new Headers(headers);
		mediaHeaders.set(
			"content-type",
			/^(video|audio)\/[\w.+-]+$/i.test(contentType) ? contentType : "application/octet-stream",
		);
		mediaHeaders.set("content-security-policy", "default-src 'none'; sandbox");
		for (const name of ["accept-ranges", "content-range", "content-length"]) {
			const value = response.headers.get(name);
			if (value && (name !== "content-length" || !response.headers.has("content-encoding")))
				mediaHeaders.set(name, value);
		}
		return new Response(response.body, { status: response.status, headers: mediaHeaders });
	} catch (error) {
		if (request.method === "GET" && error instanceof IptvSourceError && error.code === "origin") {
			return new Response(null, { status: 421, headers });
		}
		if (request.method === "POST" && error instanceof IptvSourceError) {
			return Response.json({ code: error.code, status: error.status }, { status: 502, headers });
		}
		return new Response(null, { status: 502, headers });
	}
}
