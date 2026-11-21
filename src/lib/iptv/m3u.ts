import type { CatalogChannel, CatalogMovie } from "./catalog";
import { cleanTitle, parseNumber } from "./catalog";
import { stableHash } from "./ids";
import { artworkSource, httpUrl, streamFormat } from "./urls";

function attribute(metadata: string, name: string) {
	return metadata.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1]?.trim() ?? "";
}

export interface ParsedPlaylist {
	channels: CatalogChannel[];
	movies: CatalogMovie[];
	epgUrl?: string;
}

/**
 * Parse an `#EXTM3U` channel playlist. HLS media playlists (`#EXT-X-…`) are
 * rejected: those are single streams, added as a direct URL instead.
 */
export function parseIptvPlaylist(text: string, base: URL): ParsedPlaylist {
	const trimmed = text.trimStart();
	if (!/^#EXTM3U\b/.test(trimmed) || /^#EXT-X-/m.test(text)) {
		throw new Error("Expected a channel playlist");
	}
	const header = trimmed.slice(0, trimmed.search(/\r?\n|$/));
	let epgUrl: string | undefined;
	for (const candidate of (attribute(header, "url-tvg") || attribute(header, "x-tvg-url")).split(
		",",
	)) {
		try {
			epgUrl = httpUrl(candidate, base).href;
			break;
		} catch {
			// Try the next advertised guide.
		}
	}

	const channels: CatalogChannel[] = [];
	const movies: CatalogMovie[] = [];
	const seen = new Set<string>();
	let metadata = "";
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("#EXTINF:")) metadata = line.slice(8);
		if (!line || line.startsWith("#") || !metadata) continue;
		const name = metadata.match(/^(?:[^",]|"[^"]*")*,(.*)$/)?.[1]?.trim();
		const entry = metadata;
		metadata = "";
		if (!name) continue;
		let url: URL;
		try {
			url = httpUrl(line, base);
		} catch {
			continue;
		}
		const pid = stableHash(url.href);
		if (seen.has(pid)) continue;
		seen.add(pid);
		const group = attribute(entry, "group-title");
		const adult = /\b(xxx|adults?|18\+|porn|erotic)\b/i.test(group) || undefined;
		const logo = artworkSource(attribute(entry, "tvg-logo"));
		const vod =
			/\/(movie|series)\//i.test(url.pathname) ||
			/\.(mp4|mkv|webm|mov|m4v|avi)$/i.test(url.pathname);
		if (vod) {
			const { title, year } = cleanTitle(name);
			movies.push({
				kind: "vod",
				pid,
				title,
				year,
				group,
				adult,
				poster: logo,
				ext: url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "mp4",
				src: url.href,
			});
		} else {
			channels.push({
				kind: "live",
				pid,
				title: cleanTitle(name).title,
				group,
				adult,
				number: parseNumber(attribute(entry, "tvg-chno")),
				logo,
				epgId: attribute(entry, "tvg-id") || undefined,
				src: url.href,
				format: streamFormat(url, true),
			});
		}
	}
	return { channels, movies, epgUrl };
}
