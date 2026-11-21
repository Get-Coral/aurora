import type { EpgProgramme, IptvCatalog } from "../../lib/iptv/catalog";
import { httpUrl } from "../../lib/iptv/urls";
import { createXmltvReader } from "../../lib/iptv/xmltv";
import { readCached, writeCached } from "./disk-cache";
import { upstream } from "./network";

const XMLTV_TTL = 3 * 60 * 60 * 1000;
const XMLTV_RETRY = 10 * 60 * 1000;
const MAX_XMLTV_BYTES = 400 * 1024 * 1024;

type Guide = Map<string, EpgProgramme[]>;
const guides = new Map<string, { guide?: Guide; loading?: Promise<void>; expires: number }>();

async function download(catalog: IptvCatalog, url: URL) {
	const ids = new Set(catalog.channels.flatMap((channel) => channel.epgId ?? []));
	if (!ids.size) return new Map() as Guide;
	const { response } = await upstream(url, AbortSignal.timeout(5 * 60_000), { timeoutMs: 60_000 });
	if (!response.body) throw new Error("Empty guide");
	let body: ReadableStream<Uint8Array> = response.body;
	if (/\.gz$/i.test(url.pathname) || /gzip/i.test(response.headers.get("content-type") ?? "")) {
		body = body.pipeThrough(
			new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
		);
	}
	const reader = createXmltvReader(ids, Date.now());
	const decoder = new TextDecoder();
	let bytes = 0;
	for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
		bytes += chunk.byteLength;
		if (bytes > MAX_XMLTV_BYTES) throw new Error("Guide is too large");
		reader.push(decoder.decode(chunk, { stream: true }));
	}
	reader.push(decoder.decode());
	return reader.finish();
}

/**
 * The XMLTV guide for a catalog, if it has been loaded. A missing guide starts
 * loading in the background and returns null, so pages never wait on a
 * download that can run to tens of seconds.
 */
const starting = new Map<string, Promise<Guide | null>>();

export async function xmltvGuide(catalog: IptvCatalog, wait = false): Promise<Guide | null> {
	// One caller at a time decides whether to read the disk or download.
	const pending = starting.get(catalog.source);
	if (pending) {
		await pending;
		return guides.get(catalog.source)?.guide ?? null;
	}
	const run = guideFor(catalog, wait);
	starting.set(catalog.source, run);
	try {
		return await run;
	} finally {
		starting.delete(catalog.source);
	}
}

async function guideFor(catalog: IptvCatalog, wait: boolean): Promise<Guide | null> {
	if (!catalog.epgUrl) return null;
	// Per source, so reloading the catalog doesn't throw away a loaded guide.
	const key = catalog.source;
	const entry = guides.get(key);
	if (entry?.guide && entry.expires > Date.now()) return entry.guide;
	if (entry?.loading) {
		if (wait) await entry.loading;
		return guides.get(key)?.guide ?? entry.guide ?? null;
	}
	if (entry && !entry.guide && entry.expires > Date.now()) return null;
	// After a restart, start from the guide saved on disk.
	let fromDisk: Guide | undefined;
	if (!entry) {
		const disk = await readCached<[string, EpgProgramme[]][]>(`${catalog.source}.guide`, false);
		const age = disk ? Date.now() - disk.savedAt : Number.POSITIVE_INFINITY;
		if (disk && age < 24 * 3600_000) {
			fromDisk = new Map(disk.value);
			if (age < XMLTV_TTL) {
				guides.set(key, { guide: fromDisk, expires: disk.savedAt + XMLTV_TTL });
				return fromDisk;
			}
		}
	}
	const next: { guide?: Guide; loading?: Promise<void>; expires: number } = {
		guide: entry?.guide ?? fromDisk,
		expires: Date.now() + XMLTV_RETRY,
	};
	next.loading = download(catalog, httpUrl(catalog.epgUrl))
		.then((guide) => {
			next.guide = guide;
			void writeCached(`${catalog.source}.guide`, [...guide], false);
			next.expires = Date.now() + XMLTV_TTL;
		})
		.catch(() => {
			next.expires = Date.now() + XMLTV_RETRY;
		})
		.finally(() => {
			next.loading = undefined;
		});
	guides.set(key, next);
	if (wait) await next.loading;
	return next.guide ?? null;
}
