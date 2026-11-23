import { createFileRoute, redirect } from "@tanstack/react-router";
import { LibraryBrowse } from "../../../components/LibraryBrowse";
import { LibraryView } from "../../../components/LibraryView";
import { useI18n } from "../../../lib/i18n";
import { fetchIptvStatusRuntime, fetchSetupStatusRuntime } from "../../../lib/runtime-functions";

type MovieSort = "SortName" | "DateCreated" | "PremiereDate" | "CommunityRating";
type MovieSortOrder = "Ascending" | "Descending";

export const Route = createFileRoute("/library/movies/")({
	validateSearch: (search: Record<string, unknown>) => ({
		sort:
			search.sort === "SortName" ||
			search.sort === "DateCreated" ||
			search.sort === "PremiereDate" ||
			search.sort === "CommunityRating"
				? (search.sort as MovieSort)
				: "DateCreated",
		order:
			search.order === "Ascending" || search.order === "Descending"
				? (search.order as MovieSortOrder)
				: "Descending",
		ratings: typeof search.ratings === "string" ? search.ratings : "",
		decade: typeof search.decade === "string" ? search.decade : "",
		minScore: typeof search.minScore === "number" ? search.minScore : 0,
		watchStatus:
			search.watchStatus === "watched" ||
			search.watchStatus === "unwatched" ||
			search.watchStatus === "inprogress"
				? (search.watchStatus as "watched" | "unwatched" | "inprogress")
				: undefined,
		/** Opens as rows; "grid" lists every title with filters. */
		...(search.view === "grid" ? { view: "grid" as const } : {}),
	}),
	loaderDeps: ({ search }) => search,
	loader: async ({ deps }) => {
		const [setupStatus, iptvStatus] = await Promise.all([
			fetchSetupStatusRuntime(),
			fetchIptvStatusRuntime().catch(() => ({ enabled: false, sources: 0 })),
		]);
		if (setupStatus.configured) return;
		// Without Jellyfin the rows come from IPTV alone, and every title is
		// its grid.
		if (!iptvStatus.enabled || iptvStatus.sources === 0) throw redirect({ to: "/setup" });
		if (deps.view === "grid") throw redirect({ to: "/iptv", search: { tab: "vod", view: "grid" } });
	},
	component: MoviesLibraryPage,
});

function MoviesLibraryPage() {
	const { t } = useI18n();
	const search = Route.useSearch();
	if (search.view !== "grid") return <LibraryBrowse type="Movie" />;

	return (
		<LibraryView
			type="Movie"
			title={t("route.movies.title")}
			subtitle={t("route.movies.subtitle")}
			search={search}
			genre={undefined}
		/>
	);
}
