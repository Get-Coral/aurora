import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MediaCard } from "../components/MediaCard";
import { MediaPlayerDialog } from "../components/MediaPlayerDialog";
import { MediaSpotlightDialog } from "../components/MediaSpotlightDialog";
import { useFavoriteAction } from "../components/useFavoriteAction";
import { useI18n } from "../lib/i18n";
import type { MediaItem } from "../lib/media";
import { fetchSetupStatusRuntime, fetchWatchHistoryRuntime } from "../lib/runtime-functions";

export const Route = createFileRoute("/history")({
	loader: async () => {
		const setupStatus = await fetchSetupStatusRuntime();
		if (!setupStatus.configured) throw redirect({ to: "/setup" });
	},
	component: HistoryPage,
});

function getDateGroup(dateStr: string | undefined): string {
	if (!dateStr) return "Unknown";
	const date = new Date(dateStr);
	if (Number.isNaN(date.getTime())) return "Unknown";

	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const diffDays = Math.round((today.getTime() - itemDay.getTime()) / 86_400_000);

	if (diffDays === 0) return "Today";
	if (diffDays === 1) return "Yesterday";
	if (diffDays < 7) return "Earlier this week";
	if (diffDays < 14) return "Last week";

	// Month + year for older entries
	return date.toLocaleDateString("en", { month: "long", year: "numeric" });
}

function groupItems(items: MediaItem[]): { label: string; items: MediaItem[] }[] {
	const seen = new Map<string, MediaItem[]>();
	const order: string[] = [];

	for (const item of items) {
		const label = getDateGroup(item.watchedAt);
		if (!seen.has(label)) {
			seen.set(label, []);
			order.push(label);
		}
		seen.get(label)!.push(item);
	}

	return order.map((label) => ({ label, items: seen.get(label)! }));
}

function HistoryPage() {
	const { t } = useI18n();
	const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
	const [playingItem, setPlayingItem] = useState<MediaItem | null>(null);
	const [playQueue, setPlayQueue] = useState<MediaItem[]>([]);
	const favoriteMutation = useFavoriteAction();
	const sentinelRef = useRef<HTMLDivElement>(null);

	const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
		queryKey: ["watch-history"],
		queryFn: ({ pageParam }) => fetchWatchHistoryRuntime({ data: { page: pageParam as number } }),
		initialPageParam: 0,
		getNextPageParam: (lastPage) => {
			const totalPages = Math.ceil(lastPage.total / 24);
			return lastPage.page + 1 < totalPages ? lastPage.page + 1 : undefined;
		},
	});

	const items = data?.pages.flatMap((p) => p.items) ?? [];
	const total = data?.pages[0]?.total ?? 0;
	const groups = groupItems(items);

	useEffect(() => {
		const el = sentinelRef.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
			},
			{ rootMargin: "400px" },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	function playMedia(item: MediaItem, queue?: MediaItem[]) {
		if (!item.streamUrl || item.type === "series") return;
		setSelectedItem(null);
		setPlayQueue(queue?.length ? queue : items);
		setPlayingItem(item);
	}

	function handleToggleFavorite(item: MediaItem) {
		setSelectedItem((current) =>
			current?.id === item.id ? { ...current, isFavorite: !current.isFavorite } : current,
		);
		favoriteMutation.mutate({ id: item.id, isFavorite: Boolean(item.isFavorite) });
	}

	return (
		<main className="library-shell">
			<div className="page-wrap library-head">
				<div className="library-copy">
					<Link to="/" className="library-backlink">
						<ArrowLeft size={16} /> {t("library.backHome")}
					</Link>
					<p className="eyebrow">{t("route.history.subtitle")}</p>
					<h1 className="library-title">{t("route.history.title")}</h1>
					<p className="library-summary">{t("route.history.summary")}</p>
				</div>
			</div>

			{items.length === 0 && !isFetchingNextPage ? (
				<div className="page-wrap">
					<div className="library-empty">
						<p className="eyebrow">{t("section.readyWhenYouAre")}</p>
						<h3>{t("route.history.emptyTitle")}</h3>
						<p>{t("route.history.emptyCopy")}</p>
					</div>
				</div>
			) : (
				<div className="page-wrap history-groups">
					{groups.map((group) => (
						<section key={group.label} className="history-group">
							<h2 className="history-group-label">{group.label}</h2>
							<div className="library-grid history-group-grid">
								{group.items.map((item, index) => (
									<MediaCard
										key={item.id}
										item={item}
										priority={index < 6}
										variant={index % 7 === 0 ? "feature" : index % 3 === 0 ? "poster" : "standard"}
										onClick={() => setSelectedItem(item)}
										onPlay={playMedia}
										onToggleFavorite={handleToggleFavorite}
									/>
								))}
							</div>
						</section>
					))}
				</div>
			)}

			<div ref={sentinelRef} />

			<div className="page-wrap library-footer library-footer-compact">
				{isFetchingNextPage ? (
					<span className="eyebrow" style={{ opacity: 0.5 }}>
						{t("search.searching")}
					</span>
				) : total > 0 ? (
					<span>{t("library.totalTitles", { count: total })}</span>
				) : null}
			</div>

			<MediaPlayerDialog
				item={playingItem}
				open={playingItem != null}
				onClose={() => setPlayingItem(null)}
				queue={playQueue}
				onSelectQueueItem={setPlayingItem}
			/>

			<MediaSpotlightDialog
				item={selectedItem}
				open={selectedItem != null}
				onClose={() => setSelectedItem(null)}
				onPlay={playMedia}
				onSelectSimilar={setSelectedItem}
				onToggleFavorite={handleToggleFavorite}
			/>
		</main>
	);
}
