import {
	addClientItemsToCollection,
	createClientCollection,
	deleteClientCollection,
	fetchClientCollectionItems,
	fetchClientCollections,
	fetchClientContinueWatching,
	fetchClientFavoriteItems,
	fetchClientFeatured,
	fetchClientItemDetails,
	fetchClientLatestMedia,
	fetchClientLibrary,
	fetchClientMostPlayed,
	fetchClientMyList,
	fetchClientRecommendedFromItem,
	fetchClientSearch,
	fetchClientSeriesDetails,
	fetchClientWatchHistory,
	markClientPlayed,
	removeClientItemFromCollection,
	renameClientCollection,
	toggleClientFavorite,
} from "@/lib/client-media";
import { isIptvId } from "@/lib/iptv/ids";
import type { MediaItem } from "@/lib/media";
import {
	addToCollection,
	createCollection,
	deleteCollection,
	fetchCollectionItems,
	fetchCollections,
	fetchContinueWatching,
	fetchFavoriteMovies,
	fetchFeatured,
	fetchItemDetails,
	fetchLatestMovies,
	fetchLatestSeries,
	fetchLibrary,
	fetchMostPlayed,
	fetchMyList,
	fetchRecommendedFromItem,
	fetchSearch,
	fetchSeriesDetails,
	fetchWatchHistory,
	markPlayed,
	removeFromCollection,
	renameCollection,
	toggleFavorite,
} from "@/server/functions";
import {
	fetchIptvItemDetailsRuntime,
	fetchIptvListRuntime,
	fetchIptvRelatedRuntime,
	fetchIptvSeriesDetailsRuntime,
	iptvActive,
	searchIptvRuntime,
	setIptvFavoriteRuntime,
	setIptvPlayedRuntime,
} from "./iptv";
import { callRuntime } from "./shared";

/**
 * Run the Jellyfin and IPTV halves of a list side by side. Either may fail
 * (or simply not be set up) without taking the other down.
 */
async function mergeSources(
	jellyfin: () => Promise<MediaItem[]>,
	iptv: () => Promise<MediaItem[]>,
	order: "date" | "jellyfin-first" = "jellyfin-first",
) {
	const active = await iptvActive();
	const [left, right] = await Promise.allSettled([jellyfin(), active ? iptv() : []]);
	// Without IPTV, Jellyfin errors surface exactly as before.
	if (left.status === "rejected" && (!active || right.status === "rejected")) throw left.reason;
	const a = left.status === "fulfilled" ? left.value : [];
	const b = right.status === "fulfilled" ? right.value : [];
	if (order === "jellyfin-first") return [...a, ...b];
	const time = (item: MediaItem) => (item.watchedAt ? Date.parse(item.watchedAt) || 0 : 0);
	return [...a, ...b]
		.map((item, index) => ({ item, index }))
		.sort((x, y) => time(y.item) - time(x.item) || x.index - y.index)
		.map(({ item }) => item);
}

export async function fetchLibraryRuntime(input: {
	data: {
		type: "Movie" | "Series";
		page?: number;
		sortBy?: "SortName" | "DateCreated" | "PremiereDate" | "CommunityRating";
		sortOrder?: "Ascending" | "Descending";
		genre?: string;
		favoritesOnly?: boolean;
		ratings?: string;
		decade?: string;
		minScore?: number;
		watchStatus?: "watched" | "unwatched" | "inprogress";
	};
}) {
	return callRuntime(
		() => fetchClientLibrary(input.data),
		() => fetchLibrary(input),
	);
}

export async function fetchFeaturedRuntime() {
	return callRuntime(
		() => fetchClientFeatured(),
		() => fetchFeatured(),
	);
}

async function jellyfinFetchContinueWatchingRuntime() {
	return callRuntime(
		() => fetchClientContinueWatching(),
		() => fetchContinueWatching(),
	);
}

export async function fetchContinueWatchingRuntime() {
	return mergeSources(
		() => jellyfinFetchContinueWatchingRuntime(),
		() => fetchIptvListRuntime("continue", 20),
		"date",
	);
}

export async function fetchLatestMoviesRuntime() {
	return callRuntime(
		() => fetchClientLatestMedia("Movie"),
		() => fetchLatestMovies(),
	);
}

export async function fetchLatestSeriesRuntime() {
	return callRuntime(
		() => fetchClientLatestMedia("Series"),
		() => fetchLatestSeries(),
	);
}

export async function fetchFavoriteMoviesRuntime() {
	return callRuntime(
		() => fetchClientFavoriteItems("Movie"),
		() => fetchFavoriteMovies(),
	);
}

export async function fetchMostPlayedRuntime() {
	return callRuntime(
		() => fetchClientMostPlayed("Movie", 12),
		() => fetchMostPlayed(),
	);
}

async function jellyfinFetchMyListRuntime() {
	return callRuntime(
		() => fetchClientMyList(),
		() => fetchMyList(),
	);
}

export async function fetchMyListRuntime() {
	return mergeSources(
		() => jellyfinFetchMyListRuntime(),
		() => fetchIptvListRuntime("favorites", 200),
	);
}

export async function fetchCollectionsRuntime() {
	return callRuntime(
		() => fetchClientCollections(),
		() => fetchCollections(),
	);
}

export async function fetchCollectionItemsRuntime(input: { data: { id: string } }) {
	return callRuntime(
		() => fetchClientCollectionItems(input.data.id),
		() => fetchCollectionItems(input),
	);
}

export async function createCollectionRuntime(input: { data: { name: string } }) {
	return callRuntime(
		() => createClientCollection(input.data.name),
		() => createCollection(input),
	);
}

export async function deleteCollectionRuntime(input: { data: { id: string } }) {
	return callRuntime(
		() => deleteClientCollection(input.data.id),
		() => deleteCollection(input),
	);
}

export async function renameCollectionRuntime(input: { data: { id: string; name: string } }) {
	return callRuntime(
		() => renameClientCollection(input.data.id, input.data.name),
		() => renameCollection(input),
	);
}

export async function addToCollectionRuntime(input: {
	data: { collectionId: string; itemIds: string[] };
}) {
	return callRuntime(
		() => addClientItemsToCollection(input.data.collectionId, input.data.itemIds),
		() => addToCollection(input),
	);
}

export async function removeFromCollectionRuntime(input: {
	data: { collectionId: string; itemId: string };
}) {
	return callRuntime(
		() => removeClientItemFromCollection(input.data.collectionId, input.data.itemId),
		() => removeFromCollection(input),
	);
}

async function jellyfinFetchSearchRuntime(input: { data: { query: string } }) {
	return callRuntime(
		() => fetchClientSearch(input.data.query),
		() => fetchSearch(input),
	);
}

export async function fetchSearchRuntime(input: { data: { query: string } }) {
	return mergeSources(
		() => jellyfinFetchSearchRuntime(input),
		() => searchIptvRuntime(input.data.query),
	);
}

async function jellyfinFetchWatchHistoryRuntime(input: { data: { page?: number } }) {
	return callRuntime(
		() => fetchClientWatchHistory(input.data.page ?? 0),
		() => fetchWatchHistory(input),
	);
}

export async function fetchWatchHistoryRuntime(input: { data: { page?: number } }) {
	const page = input.data.page ?? 0;
	const active = await iptvActive();
	const [jellyfin, iptv] = await Promise.allSettled([
		jellyfinFetchWatchHistoryRuntime(input),
		page === 0 && active ? fetchIptvListRuntime("history", 200) : Promise.resolve([]),
	]);
	if (jellyfin.status === "rejected" && (!active || iptv.status === "rejected"))
		throw jellyfin.reason;
	const base =
		jellyfin.status === "fulfilled" ? jellyfin.value : { items: [] as MediaItem[], total: 0, page };
	const extra = iptv.status === "fulfilled" ? iptv.value : [];
	if (!extra.length) return base;
	const time = (item: MediaItem) => (item.watchedAt ? Date.parse(item.watchedAt) || 0 : 0);
	return {
		...base,
		items: [...base.items, ...extra].sort((a, b) => time(b) - time(a)),
		total: base.total + extra.length,
	};
}

async function jellyfinFetchRecommendedFromItemRuntime(input: { data: { id: string } }) {
	return callRuntime(
		() => fetchClientRecommendedFromItem(input.data.id),
		() => fetchRecommendedFromItem(input),
	);
}

export async function fetchRecommendedFromItemRuntime(input: { data: { id: string } }) {
	if (isIptvId(input.data.id)) return fetchIptvRelatedRuntime(input.data.id);
	return jellyfinFetchRecommendedFromItemRuntime(input);
}

async function jellyfinFetchItemDetailsRuntime(input: { data: { id: string } }) {
	return callRuntime(
		() => fetchClientItemDetails(input.data.id),
		() => fetchItemDetails(input),
	);
}

export async function fetchItemDetailsRuntime(input: { data: { id: string } }) {
	if (isIptvId(input.data.id)) return fetchIptvItemDetailsRuntime(input.data.id);
	return jellyfinFetchItemDetailsRuntime(input);
}

async function jellyfinFetchSeriesDetailsRuntime(input: { data: { id: string } }) {
	return callRuntime(
		() => fetchClientSeriesDetails(input.data.id),
		() => fetchSeriesDetails(input),
	);
}

export async function fetchSeriesDetailsRuntime(input: { data: { id: string } }) {
	if (isIptvId(input.data.id)) return fetchIptvSeriesDetailsRuntime(input.data.id);
	return jellyfinFetchSeriesDetailsRuntime(input);
}

async function jellyfinToggleFavoriteRuntime(input: { data: { id: string; isFavorite: boolean } }) {
	return callRuntime(
		() => toggleClientFavorite(input.data),
		() => toggleFavorite(input),
	);
}

export async function toggleFavoriteRuntime(input: { data: { id: string; isFavorite: boolean } }) {
	if (isIptvId(input.data.id)) {
		await setIptvFavoriteRuntime(input.data.id, !input.data.isFavorite);
		return { id: input.data.id, isFavorite: !input.data.isFavorite };
	}
	return jellyfinToggleFavoriteRuntime(input);
}

async function jellyfinMarkPlayedRuntime(input: { data: { id: string; played: boolean } }) {
	return callRuntime(
		() => markClientPlayed(input.data),
		() => markPlayed(input),
	);
}

export async function markPlayedRuntime(input: { data: { id: string; played: boolean } }) {
	if (isIptvId(input.data.id)) {
		await setIptvPlayedRuntime(input.data.id, input.data.played);
		return { id: input.data.id, played: input.data.played };
	}
	return jellyfinMarkPlayedRuntime(input);
}
