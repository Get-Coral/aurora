import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { httpUrl } from "../../lib/iptv/urls";

export class IptvSourceError extends Error {
	constructor(
		readonly code: "origin" | "provider" | "disabled",
		readonly status?: number,
	) {
		super("IPTV source request failed");
	}
}

export function configuredOrigins() {
	return (process.env.AURORA_IPTV_ORIGINS ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

/**
 * The desktop app runs this server for one person on their own computer, so
 * there is nothing to protect from server-side requests: like the mobile
 * apps, it may reach any provider the user adds, also one on their network.
 */
function anyOrigin() {
	return process.env.AURORA_IPTV_ANY_ORIGIN === "true";
}

export function iptvEnabled() {
	return anyOrigin() || configuredOrigins().length > 0;
}

export function isAllowedOrigin(url: URL) {
	if (anyOrigin()) return url.protocol === "http:" || url.protocol === "https:";
	return configuredOrigins().includes(url.origin);
}

/**
 * Xtream providers redirect every stream to load balancers whose addresses
 * change per request, so an exact allowlist can't cover them. Unless strict
 * mode is on, Aurora follows such redirects (and HLS segments on them) as long
 * as the target is a public address. The first request always has to go to an
 * allowed origin.
 */
function strictOrigins() {
	return process.env.AURORA_IPTV_STRICT_ORIGINS === "true";
}

const privateRanges = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["224.0.0.0", 3],
] as const) {
	privateRanges.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	privateRanges.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string) {
	const family = isIP(address);
	if (!family) return false;
	const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
	if (mapped) return !privateRanges.check(mapped, "ipv4");
	return !privateRanges.check(address, family === 6 ? "ipv6" : "ipv4");
}

export async function isPublicHost(url: URL) {
	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (isIP(host)) return isPublicAddress(host);
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
	try {
		const addresses = await lookup(host, { all: true });
		return addresses.length > 0 && addresses.every(({ address }) => isPublicAddress(address));
	} catch {
		return false;
	}
}

/** Whether Aurora may contact a URL reached through an allowed origin. */
export async function isAllowedHop(url: URL) {
	if (isAllowedOrigin(url)) return true;
	return !strictOrigins() && (await isPublicHost(url));
}

const baseHeaders = { "user-agent": "Aurora IPTV" };

/**
 * Fetch from a provider. Every hop is checked before it is contacted, and
 * browser cookies or authorization headers are never forwarded.
 * `trusted` marks a URL that already came from an allowed chain (a redirect
 * target or an HLS segment), which may then live on a public load balancer.
 */
export async function upstream(
	initial: URL,
	signal: AbortSignal,
	options: { range?: string | null; trusted?: boolean; timeoutMs?: number } = {},
) {
	let url = initial;
	for (let hops = 0; hops <= 5; hops++) {
		const allowed =
			isAllowedOrigin(url) || ((hops > 0 || options.trusted) && (await isAllowedHop(url)));
		if (!allowed) throw new IptvSourceError("origin");
		// The time limit covers connecting and the response headers only: a live
		// channel or a long recording keeps streaming its body for hours.
		const timeout = new AbortController();
		const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? 15_000);
		let response: Response;
		try {
			response = await fetch(url, {
				redirect: "manual",
				signal: AbortSignal.any([signal, timeout.signal]),
				headers: options.range ? { ...baseHeaders, range: options.range } : baseHeaders,
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
		if (response.ok || response.status === 206) return { response, url };
		await response.body?.cancel();
		throw new IptvSourceError("provider", response.status);
	}
	throw new Error("Too many IPTV redirects");
}

export async function readText(source: Request | Response, limit: number, timeoutMs = 60_000) {
	if (!source.body) throw new Error("Empty response");
	const reader = source.body.getReader();
	const decoder = new TextDecoder();
	const chunks: string[] = [];
	let bytes = 0;
	const deadline = AbortSignal.timeout(timeoutMs);
	const cancel = () => {
		void reader.cancel().catch(() => {});
	};
	deadline.addEventListener("abort", cancel, { once: true });
	try {
		while (true) {
			const chunk = await reader.read();
			deadline.throwIfAborted();
			if (chunk.done) {
				chunks.push(decoder.decode());
				return chunks.join("");
			}
			bytes += chunk.value.byteLength;
			if (bytes > limit) throw new Error("Response is too large");
			chunks.push(decoder.decode(chunk.value, { stream: true }));
		}
	} finally {
		deadline.removeEventListener("abort", cancel);
		await reader.cancel().catch(() => {});
	}
}

export const MAX_CATALOG_BYTES = 64 * 1024 * 1024;

export function providerFetchers(signal: AbortSignal) {
	const text = async (url: URL) => {
		const { response } = await upstream(url, signal, { timeoutMs: 60_000 });
		return readText(response, MAX_CATALOG_BYTES, 120_000);
	};
	return {
		text,
		json: async (url: URL) => JSON.parse(await text(url)) as unknown,
	};
}
