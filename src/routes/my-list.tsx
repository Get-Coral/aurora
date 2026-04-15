import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { LibraryView } from "../components/LibraryView";
import { useI18n } from "../lib/i18n";
import { fetchMyListRuntime, fetchSetupStatusRuntime } from "../lib/runtime-functions";

export const Route = createFileRoute("/my-list")({
	loader: async ({ context: { queryClient } }) => {
		const setupStatus = await fetchSetupStatusRuntime();

		if (!setupStatus.configured) {
			throw redirect({ to: "/setup" });
		}

		await queryClient.ensureQueryData({
			queryKey: ["my-list"],
			queryFn: () => fetchMyListRuntime(),
		});
	},
	component: MyListPage,
});

function MyListPage() {
	const { t } = useI18n();
	const { data } = useSuspenseQuery({
		queryKey: ["my-list"],
		queryFn: () => fetchMyListRuntime(),
	});

	return (
		<LibraryView
			type="Movie"
			title={t("route.myList.title")}
			subtitle={t("route.myList.subtitle")}
			search={{ sort: "DateCreated" }}
			mode="my-list"
			customItems={data}
		/>
	);
}
