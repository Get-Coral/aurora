import type { IptvCatalog } from "./catalog";
import { stableHash } from "./ids";
import { parseIptvPlaylist } from "./m3u";
import { httpUrl, streamFormat, type XtreamConfig, xtreamConfig, xtreamFromPlaylist } from "./urls";
import { loadXtreamCatalog, xtreamPlaylistUrl, xtreamXmltvUrl } from "./xtream";

export type IptvSourceKind = "xtream" | "m3u" | "direct";

/** What the source form submits. */
export interface IptvSourceInput {
	kind: IptvSourceKind;
	name?: string;
	/** Xtream server, M3U playlist or direct stream URL. */
	url?: string;
	username?: string;
	password?: string;
	epgUrl?: string;
}

export type IptvSourceConfig =
	| { kind: "xtream"; xtream: XtreamConfig; epgUrl?: string }
	| { kind: "m3u"; url: string; epgUrl?: string }
	| { kind: "direct"; url: string };

/** How a source is shown: categories to leave out and adult content. */
export interface IptvSourceOptions {
	hiddenGroups: string[];
	showAdult: boolean;
}

export const DEFAULT_SOURCE_OPTIONS: IptvSourceOptions = { hiddenGroups: [], showAdult: false };

export function normalizeSourceOptions(value: unknown): IptvSourceOptions {
	const input = (value && typeof value === "object" ? value : {}) as Partial<IptvSourceOptions>;
	return {
		hiddenGroups: Array.isArray(input.hiddenGroups)
			? [...new Set(input.hiddenGroups.filter((group) => typeof group === "string"))].slice(0, 5000)
			: [],
		showAdult: input.showAdult === true,
	};
}

/** What Aurora may show about a saved source: never a password or full URL. */
export interface IptvSourceSummary {
	id: string;
	name: string;
	kind: IptvSourceKind;
	host: string;
	username?: string;
	hasEpg: boolean;
	updatedAt: number;
}

function optionalUrl(value: string | undefined) {
	return value?.trim() ? httpUrl(value).href : undefined;
}

export function normalizeSourceInput(input: IptvSourceInput): {
	name: string;
	config: IptvSourceConfig;
} {
	const epgUrl = optionalUrl(input.epgUrl);
	let config: IptvSourceConfig;
	if (input.kind === "xtream") {
		config = {
			kind: "xtream",
			xtream: xtreamConfig(input.url ?? "", input.username ?? "", input.password ?? ""),
			epgUrl,
		};
	} else if (input.kind === "m3u") {
		const xtream = xtreamFromPlaylist(input.url ?? "");
		config = xtream
			? { kind: "xtream", xtream, epgUrl }
			: { kind: "m3u", url: httpUrl(input.url ?? "").href, epgUrl };
	} else if (input.kind === "direct") {
		config = { kind: "direct", url: httpUrl(input.url ?? "").href };
	} else {
		throw new Error("Invalid IPTV source");
	}
	const name = input.name?.trim().slice(0, 80) || sourceHost(config);
	return { name, config };
}

export function sourceHost(config: IptvSourceConfig) {
	return new URL(config.kind === "xtream" ? config.xtream.server : config.url).host;
}

export function summarizeSource(
	id: string,
	name: string,
	config: IptvSourceConfig,
	updatedAt: number,
): IptvSourceSummary {
	return {
		id,
		name,
		kind: config.kind,
		host: sourceHost(config),
		username: config.kind === "xtream" ? config.xtream.username : undefined,
		hasEpg: config.kind !== "direct",
		updatedAt,
	};
}

export interface ProviderFetchers {
	json: (url: URL) => Promise<unknown>;
	text: (url: URL) => Promise<string>;
}

export async function loadSourceCatalog(
	source: string,
	config: IptvSourceConfig,
	fetchers: ProviderFetchers,
	name = "",
): Promise<IptvCatalog> {
	const loadedAt = Date.now();
	if (config.kind === "xtream") {
		try {
			const catalog = await loadXtreamCatalog(config.xtream, fetchers.json);
			return {
				source,
				loadedAt,
				...catalog,
				epgUrl: config.epgUrl ?? xtreamXmltvUrl(config.xtream).href,
			};
		} catch (error) {
			// Some panels turn the API off but still serve the playlist download.
			if (error instanceof Error && /sign-in/i.test(error.message)) throw error;
			const url = xtreamPlaylistUrl(config.xtream);
			const playlist = parseIptvPlaylist(
				await fetchers.text(url).catch(() => {
					throw error;
				}),
				url,
			);
			return {
				source,
				loadedAt,
				channels: playlist.channels,
				movies: playlist.movies,
				series: [],
				epgUrl: config.epgUrl ?? playlist.epgUrl ?? xtreamXmltvUrl(config.xtream).href,
			};
		}
	}
	if (config.kind === "m3u") {
		const url = httpUrl(config.url);
		const playlist = parseIptvPlaylist(await fetchers.text(url), url);
		return {
			source,
			loadedAt,
			channels: playlist.channels,
			movies: playlist.movies,
			series: [],
			epgUrl: config.epgUrl ?? playlist.epgUrl,
		};
	}
	const url = httpUrl(config.url);
	const format = streamFormat(url, true);
	const title = name || url.hostname;
	const pid = stableHash(url.href);
	const isFile = format === "file";
	return {
		source,
		loadedAt,
		channels: isFile ? [] : [{ kind: "live", pid, title, group: "", src: url.href, format }],
		movies: isFile
			? [
					{
						kind: "vod",
						pid,
						title,
						group: "",
						src: url.href,
						ext: url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "mp4",
					},
				]
			: [],
		series: [],
	};
}
