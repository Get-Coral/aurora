import type { MediaItem } from "./media";

/** Alternates two lists: a, b, a, b… then whatever is left of the longer one. */
export function interleave<T>(a: T[], b: T[]): T[] {
	const out: T[] = [];
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if (i < a.length) out.push(a[i]);
		if (i < b.length) out.push(b[i]);
	}
	return out;
}

/** Highest rated first; titles without a rating go last, in their order. */
export function byRating(items: MediaItem[]): MediaItem[] {
	return items
		.map((item, index) => ({ item, index }))
		.sort((x, y) => (y.item.rating ?? -1) - (x.item.rating ?? -1) || x.index - y.index)
		.map(({ item }) => item);
}
