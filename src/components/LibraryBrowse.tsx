import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { CURATED_MOVIE_GENRES } from "../lib/genres";
import { useI18n } from "../lib/i18n";
import type { IptvBrowseRow } from "../lib/iptv/service";
import type { MediaItem } from "../lib/media";
import { byRating, interleave } from "../lib/merge-rows";
import {
	fetchContinueWatchingRuntime,
	fetchIptvBrowseRowsRuntime,
	fetchIptvStatusRuntime,
	fetchLibraryGenresRuntime,
	fetchLibraryRuntime,
	fetchSetupStatusRuntime,
} from "../lib/runtime-functions";
import { type BrowseRowSpec, BrowseRows } from "./BrowseRows";

type LibraryType = "Movie" | "Series";
type Sort = "SortName" | "DateCreated" | "PremiereDate" | "CommunityRating";
type IptvFilter = IptvBrowseRow["filter"];

/** Genres people browse by first; the library's other genres follow. */
function orderGenres(genres: string[]) {
	const curated = CURATED_MOVIE_GENRES.filter((genre) => genres.includes(genre));
	return [...curated, ...genres.filter((genre) => !curated.includes(genre))];
}

/**
 * Films or series as rows, from every source there is: Jellyfin and IPTV.
 * With both, the rows people expect once (continue, new, top rated, my list)
 * hold titles from both; then the provider's own categories, then the
 * Jellyfin genres. Each Jellyfin row loads when it comes near the screen.
 */
export function LibraryBrowse({ type }: { type: LibraryType }) {
	const { t, locale } = useI18n();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const path = type === "Movie" ? "/library/movies" : "/library/series";
	const kind = type === "Movie" ? "vod" : "series";

	const { data: setupStatus } = useQuery({
		queryKey: ["setup-status"],
		queryFn: () => fetchSetupStatusRuntime(),
		staleTime: 60_000,
	});
	const { data: iptvStatus } = useQuery({
		queryKey: ["iptv-status"],
		queryFn: () => fetchIptvStatusRuntime(),
		staleTime: 60_000,
	});
	const hasJellyfin = Boolean(setupStatus?.configured);
	const hasIptv = Boolean(iptvStatus?.enabled && iptvStatus.sources > 0);
	const both = hasJellyfin && hasIptv;

	const iptvRowsQuery = {
		queryKey: ["iptv-rows", kind, locale],
		queryFn: () => fetchIptvBrowseRowsRuntime({ kind, locale }),
		staleTime: 5 * 60_000,
	};
	const { data: iptv, isLoading: iptvLoading } = useQuery({ ...iptvRowsQuery, enabled: hasIptv });
	/** The IPTV rows, waiting for them if they are still on their way. */
	const iptvRows = async () =>
		hasIptv ? (await queryClient.fetchQuery(iptvRowsQuery)).rows : ([] as IptvBrowseRow[]);
	const iptvItems = async (key: IptvBrowseRow["titleKey"]) =>
		(await iptvRows()).find((row) => row.titleKey === key)?.items ?? [];

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
		enabled: hasJellyfin,
	});
	const { data: genres = [] } = useQuery({
		queryKey: ["library-genres", type],
		queryFn: () => fetchLibraryGenresRuntime(type),
		staleTime: 30 * 60_000,
		enabled: hasJellyfin,
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

	/** Every IPTV film or series, filtered the way a row was. */
	function showIptvGrid(filter: IptvFilter = {}) {
		void navigate({
			to: "/iptv",
			search: {
				tab: kind,
				view: "grid",
				group: filter.group,
				genre: filter.genre,
				sort: filter.sort,
				favorites: filter.favorites,
			},
		});
	}

	// Continue watching holds Jellyfin and IPTV alike; IPTV titles only show
	// while there is an IPTV source to play them from.
	const inProgress = (items: MediaItem[]) =>
		items.filter(
			(item) =>
				(item.source !== "iptv" || hasIptv) &&
				(type === "Movie" ? item.type === "movie" : item.type === "episode"),
		);

	const jellyfinRows: BrowseRowSpec[] = [
		{
			id: "continue",
			title: t("browse.row.continue"),
			queryKey: ["continue-watching", hasIptv],
			load: async () => inProgress(await fetchContinueWatchingRuntime()),
			wide: true,
		},
		{
			id: "added",
			title: t("browse.row.added"),
			...(both
				? {
						queryKey: ["library-rows", type, "added", "with-iptv"],
						load: async () => interleave(newest, await iptvItems("added")),
					}
				: { items: newest }),
			onSeeAll: () => showGrid({ sort: "DateCreated" }),
		},
		{
			id: "rated",
			title: t("browse.row.rated"),
			queryKey: ["library-rows", type, "rated", both],
			load: async () => {
				const [jellyfin, fromIptv] = await Promise.all([
					load({ sortBy: "CommunityRating" })(),
					both ? iptvItems("rated") : Promise.resolve([]),
				]);
				return both ? byRating([...jellyfin, ...fromIptv]) : jellyfin;
			},
			onSeeAll: () => showGrid({ sort: "CommunityRating" }),
		},
		{
			id: "favorites",
			title: t("browse.row.favorites"),
			queryKey: ["library-rows", type, "favorites", both],
			load: async () => {
				const [jellyfin, fromIptv] = await Promise.all([
					load({ favoritesOnly: true, sortBy: "DateCreated" })(),
					both ? iptvItems("favorites") : Promise.resolve([]),
				]);
				return [...jellyfin, ...fromIptv];
			},
			onSeeAll: () => void navigate({ to: "/my-list" }),
		},
		{
			id: "unwatched",
			title: t("browse.row.unwatched"),
			queryKey: ["library-rows", type, "unwatched"],
			load: load({ watchStatus: "unwatched", sortBy: "PremiereDate" }),
			onSeeAll: () => showGrid({ watchStatus: "unwatched", sort: "PremiereDate" }),
		},
	];

	// The provider's rows. Next to Jellyfin only its categories are left: the
	// rows above already hold its continue, new, top rated and my list.
	const providerRows: BrowseRowSpec[] = (iptv?.rows ?? [])
		.filter((row) => !both || !row.titleKey)
		.map((row) => ({
			id: `iptv:${row.id}`,
			title: row.titleKey ? t(`browse.row.${row.titleKey}`) : (row.title ?? ""),
			items: row.items,
			wide: row.titleKey === "continue",
			onSeeAll: row.titleKey === "continue" ? undefined : () => showIptvGrid(row.filter),
		}));

	const genreRows: BrowseRowSpec[] = orderGenres(genres).map((genre) => ({
		id: `genre:${genre}`,
		title: genre,
		queryKey: ["library-rows", type, "genre", genre],
		load: load({ genre, sortBy: "CommunityRating" as Sort }),
		onSeeAll: () => showGrid({ genre, sort: "CommunityRating" }),
	}));

	const rows = hasJellyfin ? [...jellyfinRows, ...providerRows, ...genreRows] : providerRows;
	const hero = interleave(
		newest.filter((item) => item.backdropUrl),
		iptv?.hero ?? [],
	).slice(0, 5);

	return (
		<BrowseRows
			hero={hero}
			rows={rows}
			loading={hasIptv && !hasJellyfin && iptvLoading}
			title={type === "Movie" ? t("route.movies.title") : t("route.series.title")}
			onShowAll={() => (hasJellyfin ? showGrid() : showIptvGrid())}
			key={path}
		/>
	);
}
