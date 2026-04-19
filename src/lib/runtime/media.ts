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
} from "../../server/functions";
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
} from "../client-media";
import { callRuntime } from "./shared";

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

export async function fetchContinueWatchingRuntime() {
	return callRuntime(
		() => fetchClientContinueWatching(),
		() => fetchContinueWatching(),
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

export async function fetchMyListRuntime() {
	return callRuntime(
		() => fetchClientMyList(),
		() => fetchMyList(),
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

export async function fetchSearchRuntime(input: { data: { query: string } }) {
	return callRuntime(
		() => fetchClientSearch(input.data.query),
		() => fetchSearch(input),
	);
}

export async function fetchWatchHistoryRuntime(input: { data: { page?: number } }) {
	return callRuntime(
		() => fetchClientWatchHistory(input.data.page ?? 0),
		() => fetchWatchHistory(input),
	);
}

export async function fetchRecommendedFromItemRuntime(input: { data: { id: string } }) {
	return callRuntime(
		() => fetchClientRecommendedFromItem(input.data.id),
		() => fetchRecommendedFromItem(input),
	);
}

export async function fetchItemDetailsRuntime(input: { data: { id: string } }) {
	return callRuntime(
		() => fetchClientItemDetails(input.data.id),
		() => fetchItemDetails(input),
	);
}

export async function fetchSeriesDetailsRuntime(input: { data: { id: string } }) {
	return callRuntime(
		() => fetchClientSeriesDetails(input.data.id),
		() => fetchSeriesDetails(input),
	);
}

export async function toggleFavoriteRuntime(input: { data: { id: string; isFavorite: boolean } }) {
	return callRuntime(
		() => toggleClientFavorite(input.data),
		() => toggleFavorite(input),
	);
}

export async function markPlayedRuntime(input: { data: { id: string; played: boolean } }) {
	return callRuntime(
		() => markClientPlayed(input.data),
		() => markPlayed(input),
	);
}
