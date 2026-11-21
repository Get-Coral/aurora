import type { MediaItem } from "./media";

/**
 * Search shared by Jellyfin and IPTV: accent- and case-insensitive, words in
 * any order, word-prefix matching and a little typo tolerance, with one
 * ranking so results from both sources can be merged.
 */

export interface SearchPerson {
	id: string;
	name: string;
	imageUrl?: string;
}

export interface SearchResults {
	query: string;
	/** The few best matches across every section. */
	top: MediaItem[];
	channels: MediaItem[];
	/** Programmes in the TV guide, as their channel with `airing` set. */
	onTv: MediaItem[];
	movies: MediaItem[];
	series: MediaItem[];
	episodes: MediaItem[];
	collections: MediaItem[];
	people: SearchPerson[];
}

export type SearchSection = Exclude<keyof SearchResults, "query" | "top">;

export const SEARCH_SECTIONS: SearchSection[] = [
	"channels",
	"onTv",
	"movies",
	"series",
	"episodes",
	"collections",
	"people",
];

export function emptySearchResults(query = ""): SearchResults {
	return {
		query,
		top: [],
		channels: [],
		onTv: [],
		movies: [],
		series: [],
		episodes: [],
		collections: [],
		people: [],
	};
}

/** Lowercase, no accents, superscripts folded (`ᴿᴬᵂ` → `raw`), punctuation as spaces. */
export function normalizeSearchText(value: string) {
	return value
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

export interface PreparedQuery {
	text: string;
	tokens: string[];
}

export function prepareQuery(query: string): PreparedQuery {
	const text = normalizeSearchText(query);
	return { text, tokens: text ? text.split(" ") : [] };
}

/** Whether two words are at most one edit apart (insert, delete, substitute, swap). */
function withinOneEdit(a: string, b: string) {
	if (a === b) return true;
	if (Math.abs(a.length - b.length) > 1) return false;
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	if (a.length === b.length) {
		if (a.slice(i + 1) === b.slice(i + 1)) return true;
		return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
	}
	const [short, long] = a.length < b.length ? [a, b] : [b, a];
	return short.slice(i) === long.slice(i + 1);
}

/** Quality and region tags providers append to names: they never decide a match. */
const NOISE = new Set([
	"raw",
	"hd",
	"fhd",
	"uhd",
	"sd",
	"4k",
	"8k",
	"hevc",
	"h265",
	"h264",
	"1080p",
	"720p",
	"2160p",
	"backup",
	"multi",
	"sub",
	"vip",
]);

function coreWords(words: string[]) {
	const core = words.filter((word) => !NOISE.has(word) && !/^\d{4}$/.test(word));
	return core.length ? core : words;
}

/**
 * Score a title against a query: lower is better, null is no match.
 * 0 exact (ignoring quality tags and years) · 0.5 the title starts with the
 * query as whole words · 1 starts with it · 2 every word starts a title word
 * · 3 every word appears somewhere · 5 only with typos.
 */
export function scoreText(query: PreparedQuery, normalizedTitle: string): number | null {
	if (!query.tokens.length || !normalizedTitle) return null;
	if (normalizedTitle === query.text) return 0;
	const words = normalizedTitle.split(" ");
	const core = coreWords(words).join(" ");
	if (core === query.text) return 0;
	if (core.startsWith(`${query.text} `) || normalizedTitle.startsWith(`${query.text} `)) return 0.5;
	if (normalizedTitle.startsWith(query.text)) return 1;
	let level = 2;
	for (const token of query.tokens) {
		if (words.some((word) => word.startsWith(token))) continue;
		if (normalizedTitle.includes(token)) {
			level = Math.max(level, 3);
			continue;
		}
		const fuzzy =
			token.length >= 4 &&
			words.some(
				(word) =>
					withinOneEdit(token, word) ||
					(word.length > token.length && withinOneEdit(token, word.slice(0, token.length))),
			);
		if (!fuzzy) return null;
		level = 5;
	}
	return level;
}

/** Typo matches only help when nothing matches properly. */
export function dropTypoMatches<T extends { score: number }>(list: T[]) {
	return list.some((entry) => entry.score < 5) ? list.filter((entry) => entry.score < 5) : list;
}

/** Tie-breakers within a match level: artwork, a short title, then recency. */
export function rankBonus(item: Pick<MediaItem, "posterUrl" | "backdropUrl" | "title">) {
	return (item.posterUrl || item.backdropUrl ? 0 : 0.4) + Math.min(item.title.length, 80) / 400;
}

export function scoreItem(query: PreparedQuery, item: MediaItem) {
	const title = scoreText(query, normalizeSearchText(item.title));
	const series =
		item.seriesTitle != null ? scoreText(query, normalizeSearchText(item.seriesTitle)) : null;
	const best =
		title == null
			? series == null
				? null
				: series + 1
			: series == null
				? title
				: Math.min(title, series + 1);
	return best == null ? null : best + rankBonus(item);
}

/** Sort items by score; items that don't match the query keep their order at the end. */
export function rankItems(query: PreparedQuery, items: MediaItem[], onlyBest = false) {
	const scored = items
		.map((item, index) => ({ item, index, score: scoreItem(query, item) ?? 9 + index / 1000 }))
		.sort((a, b) => a.score - b.score || a.index - b.index);
	return (onlyBest ? dropTypoMatches(scored) : scored).map(({ item }) => item);
}

function dedupe(items: MediaItem[]) {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (seen.has(item.id)) return false;
		seen.add(item.id);
		return true;
	});
}

/** Merge the Jellyfin and IPTV halves into one ranked result. */
export function mergeSearchResults(query: string, parts: Partial<SearchResults>[]): SearchResults {
	const prepared = prepareQuery(query);
	const merged = emptySearchResults(query);
	// Typo matches only count when nothing matched properly in any section.
	const exactSomewhere = parts.some((part) =>
		SEARCH_SECTIONS.some(
			(section) =>
				section !== "people" &&
				section !== "onTv" &&
				(part[section] as MediaItem[] | undefined)?.some((item) => {
					const score = scoreItem(prepared, item);
					return score != null && score < 5;
				}),
		),
	);
	for (const section of SEARCH_SECTIONS) {
		if (section === "people") {
			merged.people = parts.flatMap((part) => part.people ?? []);
			continue;
		}
		const items = dedupe(parts.flatMap((part) => part[section] ?? []));
		// Guide matches are ordered by air time, not by title.
		merged[section] =
			section === "onTv"
				? items
				: rankItems(prepared, items, true).filter(
						(item) => !exactSomewhere || (scoreItem(prepared, item) ?? 9) < 5,
					);
	}
	const candidates = [
		...merged.movies.slice(0, 3),
		...merged.series.slice(0, 3),
		...merged.channels.slice(0, 3),
		...merged.collections.slice(0, 1),
	]
		.map((item) => ({ item, score: scoreItem(prepared, item) }))
		.filter(
			(entry): entry is { item: MediaItem; score: number } =>
				entry.score != null && entry.score < 2.5,
		)
		.sort((a, b) => a.score - b.score);
	merged.top = candidates.slice(0, 1).map(({ item }) => item);
	return merged;
}

const RECENT_KEY = "aurora.recent-searches";

export function readRecentSearches(): string[] {
	if (typeof window === "undefined") return [];
	try {
		const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
	} catch {
		return [];
	}
}

export function rememberSearch(query: string) {
	const value = query.trim();
	if (value.length < 2 || typeof window === "undefined") return;
	try {
		const next = [
			value,
			...readRecentSearches().filter((entry) => entry.toLowerCase() !== value.toLowerCase()),
		].slice(0, 8);
		window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
	} catch {
		// Private mode: no history.
	}
}

export function forgetRecentSearches() {
	try {
		window.localStorage.removeItem(RECENT_KEY);
	} catch {
		// Nothing to clear.
	}
}
