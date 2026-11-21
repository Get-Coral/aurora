import { isRequestAuthorized } from "../lib/auth-store";
import { parseIptvId } from "../lib/iptv/ids";
import { resolveStream } from "../lib/iptv/streams";
import { httpUrl } from "../lib/iptv/urls";
import { loadServerCatalog, serverSeriesInfo } from "./iptv/backend";
import { IptvSourceError, iptvEnabled, readText, upstream } from "./iptv/network";
import { openStreamUrl, sealStreamUrl, verifyImage } from "./iptv/tokens";

const baseHeaders = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function respond(status: number) {
	return new Response(null, { status, headers: baseHeaders });
}

/**
 * A receiver playing over AirPlay/Cast fetches the stream itself, without
 * Aurora's cookie. The same signed token Jellyfin streams use stands in.
 */
async function tokenAllows(token: string | null, itemId: string) {
	if (!token) return false;
	const { OPEN_SESSION_REF, normalizeItemId, verifyStreamToken } = await import(
		"../lib/stream-token"
	);
	const claims = verifyStreamToken(token);
	if (!claims || claims.itemId !== normalizeItemId(itemId)) return false;
	if (claims.sessionRef === OPEN_SESSION_REF) return true;
	const { getSessionByTokenHash } = await import("../lib/auth-store");
	return Boolean(getSessionByTokenHash(claims.sessionRef));
}

function mediaFormat(url: URL, contentType: string, hinted?: string | null) {
	if (hinted === "hls" || /\.m3u8$/i.test(url.pathname) || /mpegurl/i.test(contentType))
		return "hls";
	return "media";
}

function corsHeaders(headers: Headers) {
	headers.set("access-control-allow-origin", "*");
	headers.set(
		"access-control-expose-headers",
		"content-length, content-range, accept-ranges, content-type",
	);
	return headers;
}

/** Files browsers can't play as they are. */
export function needsConversion(url: URL) {
	return /\.(mkv|avi)$/i.test(url.pathname);
}

/** Follow (and check) redirects without downloading, for tools that open the URL themselves. */
export async function finalUrl(signal: AbortSignal, target: URL, trusted: boolean) {
	const { response, url } = await upstream(target, signal, { range: "bytes=0-0", trusted });
	await response.body?.cancel();
	return url;
}

function subtitleKey(itemId: string) {
	return itemId.replace(/[^a-z0-9]+/gi, "-");
}

/** The conversion whose subtitles are being written right now. */
let activeSubtitles: { itemId: string; key: string } | null = null;

async function subtitle(itemId: string, index: number) {
	if (activeSubtitles?.itemId !== itemId || !Number.isInteger(index) || index < 0)
		return respond(404);
	const [{ readFile }, { subtitleFile }] = await Promise.all([
		import("node:fs/promises"),
		import("./iptv-transcode"),
	]);
	try {
		const text = await readFile(subtitleFile(activeSubtitles.key, index), "utf8");
		return new Response(text || "WEBVTT\n", {
			headers: { ...baseHeaders, "content-type": "text/vtt; charset=utf-8" },
		});
	} catch {
		return respond(404);
	}
}

async function proxy(
	request: Request,
	target: URL,
	itemId: string,
	options: {
		format?: string | null;
		trusted: boolean;
		start?: number;
		streamToken?: string | null;
		/** Convert even a browser-friendly file (another audio track, subtitles). */
		remux?: boolean;
		audioIndex?: number;
	},
) {
	const ffmpeg =
		process.env.AURORA_IPTV_FFMPEG && (needsConversion(target) || options.remux)
			? process.env.AURORA_IPTV_FFMPEG
			: undefined;
	if (ffmpeg) {
		const [{ transcodeIptv, subtitleFile }, probe] = await Promise.all([
			import("./iptv-transcode"),
			import("./iptv-probe"),
		]);
		// Resolve redirects (and check every hop) before ffmpeg opens the URL
		// itself, so it can seek with range requests.
		const url = await finalUrl(request.signal, target, options.trusted);
		const media = await probe.probeIptvMedia(itemId, url, ffmpeg).catch(() => undefined);
		const audioIndex = Math.min(
			options.audioIndex ?? 0,
			Math.max(0, (media?.audio.length ?? 1) - 1),
		);
		const key = subtitleKey(itemId);
		const body = await transcodeIptv(url, ffmpeg, request.signal, {
			start: options.start ?? 0,
			copyVideo: probe.canCopyVideo(media),
			audioIndex,
			copyAudio: probe.canCopyAudio(media?.audio[audioIndex]),
			subtitles: (media?.subtitles ?? []).map((subtitle) => ({
				index: subtitle.index,
				file: subtitleFile(key, subtitle.index),
			})),
		});
		activeSubtitles = { itemId, key };
		return new Response(body, {
			headers: corsHeaders(new Headers({ ...baseHeaders, "content-type": "video/mp4" })),
		});
	}

	const { response, url } = await upstream(target, request.signal, {
		range: request.headers.get("range"),
		trusted: options.trusted,
	});
	const contentType = response.headers.get("content-type") ?? "";
	if (mediaFormat(url, contentType, options.format) === "hls") {
		const manifest = await readText(response, 2 * 1024 * 1024, 20_000);
		if (!/^#EXTM3U\b/.test(manifest.trimStart())) throw new Error("Invalid HLS manifest");
		const suffix = options.streamToken ? `&st=${encodeURIComponent(options.streamToken)}` : "";
		const link = (uri: string) => {
			const next = httpUrl(uri, url);
			const nested = /\.m3u8$/i.test(next.pathname) ? "&format=hls" : "";
			return `/api/iptv?token=${sealStreamUrl(next, itemId)}${nested}${suffix}`;
		};
		const rewritten = manifest
			.split(/\r?\n/)
			.map((raw) => {
				const line = raw.trim();
				if (!line) return line;
				if (!line.startsWith("#")) return link(line);
				return line.replace(/\bURI="([^"]+)"/g, (_, uri: string) => `URI="${link(uri)}"`);
			})
			.join("\n");
		return new Response(rewritten, {
			headers: corsHeaders(
				new Headers({ ...baseHeaders, "content-type": "application/vnd.apple.mpegurl" }),
			),
		});
	}

	const headers = corsHeaders(new Headers(baseHeaders));
	headers.set(
		"content-type",
		/^(video|audio)\/[\w.+-]+$/i.test(contentType)
			? contentType
			: /\.ts$/i.test(url.pathname)
				? "video/mp2t"
				: /\.mp4$/i.test(url.pathname)
					? "video/mp4"
					: "application/octet-stream",
	);
	headers.set("content-security-policy", "default-src 'none'; sandbox");
	for (const name of ["accept-ranges", "content-range", "content-length"]) {
		const value = response.headers.get(name);
		if (value && (name !== "content-length" || !response.headers.has("content-encoding")))
			headers.set(name, value);
	}
	return new Response(response.body, { status: response.status, headers });
}

async function image(request: Request, encoded: string, signature: string) {
	const url = verifyImage(encoded, signature);
	if (!url) return respond(404);
	const { response } = await upstream(url, request.signal, { trusted: true, timeoutMs: 10_000 });
	const type = response.headers.get("content-type") ?? "";
	const length = Number(response.headers.get("content-length") ?? 0);
	if (
		!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(type.split(";")[0]?.trim() ?? "") ||
		length > MAX_IMAGE_BYTES
	) {
		await response.body?.cancel();
		return respond(415);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > MAX_IMAGE_BYTES) return respond(413);
	return new Response(bytes, {
		headers: {
			"content-type": type,
			"cache-control": "private, max-age=86400",
			"x-content-type-options": "nosniff",
			"content-security-policy": "default-src 'none'; sandbox",
		},
	});
}

export async function iptvRequest(request: Request) {
	if (request.method !== "GET" && request.method !== "HEAD") return respond(405);
	const address = new URL(request.url);
	const params = address.searchParams;
	const streamToken = params.get("st");
	try {
		const imageParam = params.get("image");
		if (imageParam) {
			if (!isRequestAuthorized(request)) return respond(401);
			if (!iptvEnabled()) return respond(503);
			return await image(request, imageParam, params.get("sig") ?? "");
		}

		const sealed = params.get("token");
		if (sealed) {
			const opened = openStreamUrl(sealed);
			if (!opened) return respond(410);
			if (!isRequestAuthorized(request) && !(await tokenAllows(streamToken, opened.itemId)))
				return respond(401);
			if (!iptvEnabled()) return respond(503);
			return await proxy(request, opened.url, opened.itemId, {
				format: params.get("format"),
				trusted: true,
				streamToken,
			});
		}

		const id = params.get("id") ?? "";
		const parts = parseIptvId(id);
		if (!parts) return respond(404);
		if (!isRequestAuthorized(request) && !(await tokenAllows(streamToken, id))) return respond(401);
		if (!iptvEnabled()) return respond(503);
		const { listIptvSourceIds } = await import("../lib/iptv-source-store");
		if (!listIptvSourceIds().includes(parts.source)) return respond(404);
		const catalog = await loadServerCatalog(parts.source);
		let target: Awaited<ReturnType<typeof resolveStream>>;
		try {
			target = await resolveStream(catalog, parts, {
				preferHls: params.get("prefer") === "hls",
				seriesInfo: (pid) => serverSeriesInfo(catalog, pid),
			});
		} catch {
			return respond(404);
		}
		const useFallback = params.get("fallback") === "1" && target.fallback;
		const subtitleIndex = params.get("subtitle");
		if (subtitleIndex != null) return await subtitle(id, Number(subtitleIndex));
		const start = Number(params.get("start") ?? 0);
		const audio = Number(params.get("audio") ?? 0);
		return await proxy(request, useFallback ? (target.fallback as URL) : target.url, id, {
			format: useFallback ? "hls" : target.format,
			trusted: false,
			start: Number.isFinite(start) && start > 0 ? start : 0,
			streamToken,
			remux: params.get("remux") === "1" && !target.live,
			audioIndex: Number.isInteger(audio) && audio >= 0 ? audio : 0,
		});
	} catch (error) {
		if (error instanceof IptvSourceError && error.code === "origin") return respond(421);
		// Panels answer a full account (too many connections) in several ways.
		if (
			error instanceof IptvSourceError &&
			error.code === "provider" &&
			[429, 458, 509, 551].includes(error.status ?? 0)
		)
			return new Response(null, {
				status: 429,
				headers: { ...baseHeaders, "x-aurora-provider-status": String(error.status) },
			});
		if (error instanceof IptvSourceError && error.code === "provider")
			return new Response(null, {
				status: 502,
				headers: { ...baseHeaders, "x-aurora-provider-status": String(error.status ?? "") },
			});
		return respond(502);
	}
}
