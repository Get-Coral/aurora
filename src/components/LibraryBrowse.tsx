import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CURATED_MOVIE_GENRES } from "../lib/genres";
import { useI18n } from "../lib/i18n";
import type { MediaItem } from "../lib/media";
import {
	fetchContinueWatchingRuntime,
	fetchLibraryGenresRuntime,
	fetchLibraryRuntime,
} from "../lib/runtime-functions";
import { type BrowseRowSpec, BrowseRows } from "./BrowseRows";

type LibraryType = "Movie" | "Series";
type Sort = "SortName" | "DateCreated" | "PremiereDate" | "CommunityRating";

/** Genres people browse by first; the library's other genres follow. */
function orderGenres(genres: string[]) {
	const curated = CURATED_MOVIE_GENRES.filter((genre) => genres.includes(genre));
	return [...curated, ...genres.filter((genre) => !curated.includes(genre))];
}

/**
 * Jellyfin films or series as rows: in progress, new, rated, your list, not
 * seen yet, then one row per genre in the library. Each row loads when it
 * comes near the screen.
 */
export function LibraryBrowse({ type }: { type: LibraryType }) {
	const { t } = useI18n();
	const navigate = useNavigate();
	const path = type === "Movie" ? "/library/movies" : "/library/series";

	const load =
		(data: {
			sortBy?: Sort;
			sortOrder?: "Ascending" | "Descending";
			genre?: string;
			favoritesOnly?: boolean;
			watchStatus?: "unwatched";
		}) =>
		async () =>
			(
				await fetchLibraryRuntime({
					data: { type, sortOrder: "Descending", ...data },
				})
			).items;

	const { data: newest = [] } = useQuery({
		queryKey: ["library-rows", type, "added"],
		queryFn: load({ sortBy: "DateCreated" }),
		staleTime: 5 * 60_000,
	});
	const { data: genres = [] } = useQuery({
		queryKey: ["library-genres", type],
		queryFn: () => fetchLibraryGenresRuntime(type),
		staleTime: 30 * 60_000,
	});

	function showGrid(search: { sort?: Sort; watchStatus?: "unwatched"; genre?: string } = {}) {
		const base = {
			sort: search.sort ?? ("DateCreated" as Sort),
			order: "Descending" as const,
			ratings: "",
			decade: "",
			minScore: 0,
			watchStatus: search.watchStatus,
			view: "grid" as const,
		};
		if (search.genre && type === "Movie") {
			void navigate({
				to: "/library/movies/genre/$genre",
				params: { genre: search.genre },
				search: base,
			});
			return;
		}
		if (type === "Movie") void navigate({ to: "/library/movies", search: base });
		else
			void navigate({
				to: "/library/series",
				search: { ...base, ...(search.genre ? { genre: search.genre } : {}) },
			});
	}

	const inProgress = (items: MediaItem[]) =>
		items.filter(
			(item) =>
				item.source !== "iptv" &&
				(type === "Movie" ? item.type === "movie" : item.type === "episode"),
		);

	const rows: BrowseRowSpec[] = [
		{
			id: "continue",
			title: t("browse.row.continue"),
			queryKey: ["continue-watching"],
			load: async () => inProgress(await fetchContinueWatchingRuntime()),
			wide: true,
		},
		{
			id: "added",
			title: t("browse.row.added"),
			items: newest,
			onSeeAll: () => showGrid({ sort: "DateCreated" }),
		},
		{
			id: "rated",
			title: t("browse.row.rated"),
			queryKey: ["library-rows", type, "rated"],
			load: load({ sortBy: "CommunityRating" }),
			onSeeAll: () => showGrid({ sort: "CommunityRating" }),
		},
		{
			id: "favorites",
			title: t("browse.row.favorites"),
			queryKey: ["library-rows", type, "favorites"],
			load: load({ favoritesOnly: true, sortBy: "DateCreated" }),
			onSeeAll: () => void navigate({ to: "/my-list" }),
		},
		{
			id: "unwatched",
			title: t("browse.row.unwatched"),
			queryKey: ["library-rows", type, "unwatched"],
			load: load({ watchStatus: "unwatched", sortBy: "PremiereDate" }),
			onSeeAll: () => showGrid({ watchStatus: "unwatched", sort: "PremiereDate" }),
		},
		...orderGenres(genres).map((genre) => ({
			id: `genre:${genre}`,
			title: genre,
			queryKey: ["library-rows", type, "genre", genre],
			load: load({ genre, sortBy: "CommunityRating" as Sort }),
			onSeeAll: () => showGrid({ genre, sort: "CommunityRating" }),
		})),
	];

	return (
		<BrowseRows
			hero={newest.filter((item) => item.backdropUrl).slice(0, 5)}
			rows={rows}
			title={type === "Movie" ? t("route.movies.title") : t("route.series.title")}
			onShowAll={() => showGrid()}
			key={path}
		/>
	);
}
