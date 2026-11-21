import { createFileRoute, redirect } from "@tanstack/react-router";
import { LibraryBrowse } from "../../components/LibraryBrowse";
import { LibraryView } from "../../components/LibraryView";
import { useI18n } from "../../lib/i18n";
import { fetchSetupStatusRuntime } from "../../lib/runtime-functions";

type SeriesSort = "SortName" | "DateCreated" | "PremiereDate" | "CommunityRating";
type SeriesSortOrder = "Ascending" | "Descending";

export const Route = createFileRoute("/library/series")({
	validateSearch: (search: Record<string, unknown>) => ({
		sort:
			search.sort === "SortName" ||
			search.sort === "DateCreated" ||
			search.sort === "PremiereDate" ||
			search.sort === "CommunityRating"
				? (search.sort as SeriesSort)
				: "DateCreated",
		order:
			search.order === "Ascending" || search.order === "Descending"
				? (search.order as SeriesSortOrder)
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
		...(typeof search.genre === "string" && search.genre ? { genre: search.genre } : {}),
	}),
	loaderDeps: ({ search }) => search,
	loader: async () => {
		const setupStatus = await fetchSetupStatusRuntime();
		if (!setupStatus.configured) {
			throw redirect({ to: "/setup" });
		}
	},
	component: SeriesLibraryPage,
});

function SeriesLibraryPage() {
	const { t } = useI18n();
	const search = Route.useSearch();
	if (search.view !== "grid") return <LibraryBrowse type="Series" />;

	return (
		<LibraryView
			type="Series"
			title={t("route.series.title")}
			subtitle={t("route.series.subtitle")}
			search={search}
			genre={search.genre}
		/>
	);
}
