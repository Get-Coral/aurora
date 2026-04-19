import { createServerFn } from "@tanstack/react-start";

const DECADE_RANGES: Record<string, { min: string; max: string }> = {
	"2020s": { min: "2020-01-01", max: "2029-12-31" },
	"2010s": { min: "2010-01-01", max: "2019-12-31" },
	"2000s": { min: "2000-01-01", max: "2009-12-31" },
	"1990s": { min: "1990-01-01", max: "1999-12-31" },
	"1980s": { min: "1980-01-01", max: "1989-12-31" },
	Older: { min: "1900-01-01", max: "1979-12-31" },
};

export const fetchContinueWatching = createServerFn({ method: "GET" }).handler(async () => {
	const [{ getContinueWatching }, { fromJellyfin }] = await Promise.all([
		import("../../lib/jellyfin"),
		import("../../lib/media-server"),
	]);
	const items = await getContinueWatching();
	return items.map(fromJellyfin);
});

export const fetchFeatured = createServerFn({ method: "GET" }).handler(async () => {
	const [{ getFeaturedItem }, { fromJellyfin }] = await Promise.all([
		import("../../lib/jellyfin"),
		import("../../lib/media-server"),
	]);
	const item = await getFeaturedItem();
	return item ? fromJellyfin(item) : null;
});

export const fetchLatestMovies = createServerFn({ method: "GET" }).handler(async () => {
	const [{ getLatestMedia }, { fromJellyfin }] = await Promise.all([
		import("../../lib/jellyfin"),
		import("../../lib/media-server"),
	]);
	const items = await getLatestMedia("Movie");
	return items.map(fromJellyfin);
});

export const fetchLatestSeries = createServerFn({ method: "GET" }).handler(async () => {
	const [{ getLatestMedia }, { fromJellyfin }] = await Promise.all([
		import("../../lib/jellyfin"),
		import("../../lib/media-server"),
	]);
	const items = await getLatestMedia("Series");
	return items.map(fromJellyfin);
});

export const fetchFavoriteMovies = createServerFn({ method: "GET" }).handler(async () => {
	const [{ getFavoriteItems }, { fromJellyfin }] = await Promise.all([
		import("../../lib/jellyfin"),
		import("../../lib/media-server"),
	]);
	const items = await getFavoriteItems("Movie");
	return items.map(fromJellyfin);
});

export const fetchMyList = createServerFn({ method: "GET" }).handler(async () => {
	const [{ getFavoriteItems }, { fromJellyfin }] = await Promise.all([
		import("../../lib/jellyfin"),
		import("../../lib/media-server"),
	]);
	const [movies, series] = await Promise.all([
		getFavoriteItems("Movie"),
		getFavoriteItems("Series"),
	]);

	return [...movies, ...series].map(fromJellyfin);
});

export const fetchRecommendedFromItem = createServerFn({ method: "GET" })
	.inputValidator((input: { id: string }) => input)
	.handler(async ({ data }) => {
		const [{ getSimilarItems }, { fromJellyfin }] = await Promise.all([
			import("../../lib/jellyfin"),
			import("../../lib/media-server"),
		]);
		const items = await getSimilarItems(data.id);
		return items.map(fromJellyfin);
	});

export const fetchLibrary = createServerFn({ method: "GET" })
	.inputValidator(
		(input: {
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
		}) => input,
	)
	.handler(async ({ data }) => {
		const [{ getLibraryItems }, { fromJellyfin }] = await Promise.all([
			import("../../lib/jellyfin"),
			import("../../lib/media-server"),
		]);
		const page = data.page ?? 0;
		const decadeRange = data.decade ? DECADE_RANGES[data.decade] : undefined;
		const result = await getLibraryItems(data.type, {
			sortBy: data.sortBy ?? "DateCreated",
			sortOrder: data.sortOrder ?? "Descending",
			limit: 24,
			startIndex: page * 24,
			genre: data.genre,
			filters: data.favoritesOnly ? "IsFavorite" : undefined,
			watchStatus: data.watchStatus,
			officialRatings: data.ratings || undefined,
			minCommunityRating: data.minScore ?? undefined,
			minPremiereDate: decadeRange?.min,
			maxPremiereDate: decadeRange?.max,
		});
		return {
			items: result.Items.map(fromJellyfin),
			total: result.TotalRecordCount,
			page,
		};
	});

export const fetchWatchHistory = createServerFn({ method: "GET" })
	.inputValidator((input: { page?: number }) => input)
	.handler(async ({ data }) => {
		const [{ getWatchHistory }, { fromJellyfin }] = await Promise.all([
			import("../../lib/jellyfin"),
			import("../../lib/media-server"),
		]);
		const page = data.page ?? 0;
		const result = await getWatchHistory({ limit: 24, startIndex: page * 24 });
		return {
			items: result.Items.map(fromJellyfin),
			total: result.TotalRecordCount,
			page,
		};
	});

export const fetchCollections = createServerFn({ method: "GET" }).handler(async () => {
	const [{ getCollections }, { fromJellyfin }] = await Promise.all([
		import("../../lib/jellyfin"),
		import("../../lib/media-server"),
	]);
	const items = await getCollections();
	return items.map(fromJellyfin);
});

export const fetchCollectionItems = createServerFn({ method: "GET" })
	.inputValidator((input: { id: string }) => input)
	.handler(async ({ data }) => {
		const [{ getCollectionItems, getItem }, { fromJellyfin }] = await Promise.all([
			import("../../lib/jellyfin"),
			import("../../lib/media-server"),
		]);
		const [items, collection] = await Promise.all([getCollectionItems(data.id), getItem(data.id)]);
		return {
			collection: fromJellyfin(collection),
			items: items.map(fromJellyfin),
		};
	});

export const createCollection = createServerFn({ method: "POST" })
	.inputValidator((input: { name: string }) => input)
	.handler(async ({ data }) => {
		const { createCollection: apiCreate } = await import("../../lib/jellyfin");
		return apiCreate(data.name);
	});

export const deleteCollection = createServerFn({ method: "POST" })
	.inputValidator((input: { id: string }) => input)
	.handler(async ({ data }) => {
		const { deleteItem } = await import("../../lib/jellyfin");
		await deleteItem(data.id);
	});

export const renameCollection = createServerFn({ method: "POST" })
	.inputValidator((input: { id: string; name: string }) => input)
	.handler(async ({ data }) => {
		const { updateItemName } = await import("../../lib/jellyfin");
		await updateItemName(data.id, data.name);
	});

export const addToCollection = createServerFn({ method: "POST" })
	.inputValidator((input: { collectionId: string; itemIds: string[] }) => input)
	.handler(async ({ data }) => {
		const { addItemsToCollection } = await import("../../lib/jellyfin");
		await addItemsToCollection(data.collectionId, data.itemIds);
	});

export const removeFromCollection = createServerFn({ method: "POST" })
	.inputValidator((input: { collectionId: string; itemId: string }) => input)
	.handler(async ({ data }) => {
		const { removeItemsFromCollection } = await import("../../lib/jellyfin");
		await removeItemsFromCollection(data.collectionId, [data.itemId]);
	});

export const fetchMostPlayed = createServerFn({ method: "GET" }).handler(async () => {
	const [{ getMostPlayed }, { fromJellyfin }] = await Promise.all([
		import("../../lib/jellyfin"),
		import("../../lib/media-server"),
	]);
	const items = await getMostPlayed("Movie", 12);
	return items.map(fromJellyfin);
});

export const fetchItem = createServerFn({ method: "GET" })
	.inputValidator((input: { id: string }) => input)
	.handler(async ({ data }) => {
		const [{ getItem }, { fromJellyfin }] = await Promise.all([
			import("../../lib/jellyfin"),
			import("../../lib/media-server"),
		]);
		const item = await getItem(data.id);
		return fromJellyfin(item);
	});

export const fetchItemDetails = createServerFn({ method: "GET" })
	.inputValidator((input: { id: string }) => input)
	.handler(async ({ data }) => {
		const [{ getItem, getSimilarItems }, { fromJellyfin, fromJellyfinDetailed }] =
			await Promise.all([import("../../lib/jellyfin"), import("../../lib/media-server")]);
		const [item, similar] = await Promise.all([getItem(data.id), getSimilarItems(data.id)]);

		return {
			item: fromJellyfinDetailed(item),
			similar: similar.map(fromJellyfin),
		};
	});

export const fetchSeriesDetails = createServerFn({ method: "GET" })
	.inputValidator((input: { id: string }) => input)
	.handler(async ({ data }) => {
		const [
			{ getItem, getEpisodesForSeries, getNextUpForSeries, getSimilarItems },
			{ fromJellyfin, fromJellyfinDetailed },
		] = await Promise.all([import("../../lib/jellyfin"), import("../../lib/media-server")]);
		const [item, episodes, nextUp, similar] = await Promise.all([
			getItem(data.id),
			getEpisodesForSeries(data.id),
			getNextUpForSeries(data.id),
			getSimilarItems(data.id),
		]);

		return {
			item: fromJellyfinDetailed(item),
			episodes: episodes.map(fromJellyfin),
			nextUp: nextUp.map(fromJellyfin),
			similar: similar.map(fromJellyfin),
		};
	});

export const fetchSearch = createServerFn({ method: "GET" })
	.inputValidator((input: { query: string }) => input)
	.handler(async ({ data }) => {
		if (!data.query.trim()) return [];
		const [{ searchItems }, { fromJellyfin }] = await Promise.all([
			import("../../lib/jellyfin"),
			import("../../lib/media-server"),
		]);
		const items = await searchItems(data.query);
		return items.map(fromJellyfin);
	});

export const markPlayed = createServerFn({ method: "POST" })
	.inputValidator((input: { id: string; played: boolean }) => input)
	.handler(async ({ data }) => {
		const { setPlayed } = await import("../../lib/jellyfin");
		const result = await setPlayed(data.id, data.played);
		return { id: data.id, played: result.Played };
	});

export const toggleFavorite = createServerFn({ method: "POST" })
	.inputValidator((input: { id: string; isFavorite: boolean }) => input)
	.handler(async ({ data }) => {
		const { setFavorite } = await import("../../lib/jellyfin");
		const result = await setFavorite(data.id, data.isFavorite);
		return { id: data.id, isFavorite: result.IsFavorite };
	});
