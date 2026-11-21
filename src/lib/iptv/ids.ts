/**
 * IPTV item ids: `iptv:<source>:<kind>:<pid>`.
 *
 * They only use `[a-z0-9_:]`, so they survive `normalizeItemId` and fit in a
 * signed stream token (which splits on dots), and they never contain provider
 * credentials or URLs.
 */
export type IptvKind = "live" | "vod" | "series" | "ep" | "arc";

const KINDS = new Set<IptvKind>(["live", "vod", "series", "ep", "arc"]);
const PART = /^[a-z0-9_]+$/;

export interface IptvIdParts {
	source: string;
	kind: IptvKind;
	pid: string;
}

export function isIptvId(id: string | null | undefined): id is string {
	return typeof id === "string" && id.startsWith("iptv:");
}

export function iptvId(source: string, kind: IptvKind, pid: string | number) {
	const value = String(pid).toLowerCase();
	if (!PART.test(source) || !PART.test(value)) throw new Error("Invalid IPTV id");
	return `iptv:${source}:${kind}:${value}`;
}

export function parseIptvId(id: string | null | undefined): IptvIdParts | null {
	if (!isIptvId(id)) return null;
	const [, source, kind, pid, ...rest] = id.split(":");
	if (rest.length || !source || !pid || !PART.test(source) || !PART.test(pid)) return null;
	if (!KINDS.has(kind as IptvKind)) return null;
	return { source, kind: kind as IptvKind, pid };
}

/** Episode pids carry their series: `<seriesPid>_<episodePid>`. */
export function episodePid(seriesPid: string, episode: string | number) {
	return `${seriesPid}_${String(episode).toLowerCase()}`;
}

export function splitEpisodePid(pid: string) {
	const index = pid.indexOf("_");
	return index > 0 ? { series: pid.slice(0, index), episode: pid.slice(index + 1) } : null;
}

/**
 * A short, stable, non-cryptographic hash (cyrb53). Used for M3U entries that
 * have no provider id, so the same playlist line keeps the same item id.
 */
export function stableHash(value: string) {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		h1 = Math.imul(h1 ^ code, 2654435761);
		h2 = Math.imul(h2 ^ code, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Catch-up recordings: `<channelPid>_<startMinute>_<minutes>`. */
export function replayPid(channelPid: string, start: number, end: number) {
	return `${channelPid}_${Math.floor(start / 60_000)}_${Math.max(1, Math.ceil((end - start) / 60_000))}`;
}

export function splitReplayPid(pid: string) {
	const match = pid.match(/^([a-z0-9]+)_(\d+)_(\d+)$/);
	if (!match) return null;
	const start = Number(match[2]) * 60_000;
	return { channel: match[1] as string, start, end: start + Number(match[3]) * 60_000 };
}
