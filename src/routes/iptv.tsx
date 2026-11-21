import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	CalendarClock,
	Clapperboard,
	Film,
	Heart,
	Search,
	Settings2,
	Tv,
	X,
} from "lucide-react";
import { type ReactNode, useDeferredValue, useEffect, useRef, useState } from "react";
import { type BrowseRowSpec, BrowseRows } from "../components/BrowseRows";
import { IptvGuide } from "../components/IptvGuide";
import { MediaCard } from "../components/MediaCard";
import { useFavoriteAction } from "../components/useFavoriteAction";
import { useI18n } from "../lib/i18n";
import type { MediaItem } from "../lib/media";
import {
	fetchIptvBrowseRowsRuntime,
	fetchIptvBrowseRuntime,
	fetchIptvStatusRuntime,
} from "../lib/runtime-functions";

type Tab = "live" | "guide" | "vod" | "series";
type Sort = "default" | "added" | "title" | "rating";

interface IptvSearch {
	tab: Tab;
	group?: string;
	genre?: string;
	/** Films and series open as rows; "grid" shows every title with filters. */
	view?: "grid";
	sort?: Sort;
	favorites?: boolean;
}

const PAGE_SIZE = 48;
const SKELETON_KEYS = Array.from({ length: 12 }, (_, index) => `iptv-skeleton-${index}`);

export const Route = createFileRoute("/iptv")({
	validateSearch: (search: Record<string, unknown>): IptvSearch => ({
		tab:
			search.tab === "vod" || search.tab === "series" || search.tab === "guide"
				? search.tab
				: "live",
		group: typeof search.group === "string" && search.group ? search.group : undefined,
		genre: typeof search.genre === "string" && search.genre ? search.genre : undefined,
		view: search.view === "grid" ? "grid" : undefined,
		sort:
			search.sort === "added" || search.sort === "title" || search.sort === "rating"
				? search.sort
				: undefined,
		favorites: search.favorites === true || search.favorites === "true" ? true : undefined,
	}),
	component: IptvPage,
});

function dispatchSelect(item: MediaItem) {
	window.dispatchEvent(new CustomEvent("aurora:select-media", { detail: item }));
}

function dispatchPlay(item: MediaItem, list: MediaItem[] = [item]) {
	if (item.type === "series") return dispatchSelect(item);
	// Channels zap through the list on screen; titles play on their own.
	const queue = item.type === "channel" ? list.filter((entry) => entry.type === "channel") : [item];
	window.dispatchEvent(new CustomEvent("aurora:play-media", { detail: { item, queue } }));
}

function IptvPage() {
	const { t } = useI18n();
	const navigate = useNavigate({ from: "/iptv" });
	const { tab, group, genre, sort, favorites, view } = Route.useSearch();
	const [query, setQuery] = useState("");
	const search = useDeferredValue(query.trim());
	const favoriteMutation = useFavoriteAction();
	const sentinelRef = useRef<HTMLDivElement>(null);

	const { data: status } = useQuery({
		queryKey: ["iptv-status"],
		queryFn: () => fetchIptvStatusRuntime(),
	});

	useEffect(() => {
		setQuery("");
	}, [tab]);

	// Films and series start as rows; filters and "all titles" show the grid.
	const rowsView =
		(tab === "vod" || tab === "series") &&
		view !== "grid" &&
		!group &&
		!genre &&
		!sort &&
		!favorites;

	const browse = useInfiniteQuery({
		queryKey: [
			"iptv-browse",
			tab,
			group ?? "",
			genre ?? "",
			sort ?? "default",
			favorites ?? false,
			search,
		],
		queryFn: ({ pageParam }) =>
			fetchIptvBrowseRuntime({
				kind: tab === "guide" ? "live" : tab,
				group,
				genre,
				query: search,
				sort: sort ?? (tab === "live" ? "default" : "added"),
				favoritesOnly: favorites,
				offset: pageParam,
				limit: PAGE_SIZE,
			}),
		initialPageParam: 0,
		getNextPageParam: (last, pages) => {
			const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
			return loaded < last.total ? loaded : undefined;
		},
		enabled: Boolean(status?.enabled && status.sources > 0) && tab !== "guide" && !rowsView,
		// Live guide data goes stale; refresh what's on now every few minutes.
		refetchInterval: tab === "live" ? 5 * 60_000 : false,
		staleTime: 60_000,
	});

	const items = browse.data?.pages.flatMap((page) => page.items) ?? [];
	const total = browse.data?.pages[0]?.total ?? 0;
	const [guideGroups, setGuideGroups] = useState<string[]>([]);
	const groups = [...((tab === "guide" ? guideGroups : browse.data?.pages[0]?.groups) ?? [])].sort(
		(a, b) => a.localeCompare(b),
	);
	const { fetchNextPage, hasNextPage, isFetchingNextPage } = browse;

	useEffect(() => {
		const sentinel = sentinelRef.current;
		if (!sentinel) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
			},
			{ rootMargin: "600px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [fetchNextPage, hasNextPage, isFetchingNextPage]);

	function update(next: Partial<IptvSearch>) {
		void navigate({ search: (current: IptvSearch) => ({ ...current, ...next }), replace: true });
	}

	const tabs: { value: Tab; label: string; icon: typeof Tv }[] = [
		{ value: "live", label: t("iptv.live"), icon: Tv },
		{ value: "guide", label: t("iptv.guide"), icon: CalendarClock },
		{ value: "vod", label: t("iptv.movies"), icon: Film },
		{ value: "series", label: t("iptv.series"), icon: Clapperboard },
	];

	const unavailable = status && (!status.enabled || status.sources === 0);

	const tabPills = tabs.map(({ value, label, icon: Icon }) => (
		<button
			key={value}
			type="button"
			className={`genre-pill${tab === value ? " genre-pill-active" : ""}`}
			aria-pressed={tab === value}
			onClick={() =>
				update({
					tab: value,
					group: undefined,
					genre: undefined,
					sort: undefined,
					favorites: undefined,
					view: undefined,
				})
			}
			data-tv-focusable="true"
		>
			<Icon size={15} /> {label}
		</button>
	));

	if (rowsView && !unavailable) {
		return (
			<IptvRows
				kind={tab as "vod" | "series"}
				tabs={tabPills}
				onFilter={(filter) => update({ ...filter, view: "grid" })}
			/>
		);
	}

	return (
		<main className="library-shell">
			<div className="page-wrap library-head">
				<div className="library-copy">
					<Link to="/" className="library-backlink" data-tv-focusable="true">
						<ArrowLeft size={16} /> {t("library.backHome")}
					</Link>
					<p className="eyebrow">{t("iptv.eyebrow")}</p>
					<h1 className="library-title">
						{tab === "live"
							? t("iptv.live")
							: tab === "guide"
								? t("iptv.guide")
								: tab === "vod"
									? t("iptv.movies")
									: t("iptv.series")}
					</h1>
					<p className="library-summary">
						{tab === "live"
							? t("iptv.liveSummary")
							: tab === "guide"
								? t("iptv.guideSummary")
								: t("iptv.vodSummary")}
					</p>
				</div>
			</div>

			<div className="page-wrap library-toolbar iptv-toolbar">
				<div className="genre-strip">{tabPills}</div>
				<div className="toolbar-controls">
					<label className="iptv-search">
						<Search size={15} aria-hidden="true" />
						<input
							type="search"
							value={query}
							placeholder={tab === "live" ? t("iptv.searchChannels") : t("iptv.searchTitles")}
							aria-label={t("iptv.search")}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</label>
					<select
						className="toolbar-sort-select"
						value={group ?? ""}
						aria-label={t("iptv.groups")}
						onChange={(event) => update({ group: event.target.value || undefined })}
					>
						<option value="">{t("iptv.allGroups")}</option>
						{groups.map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</select>
					{tab === "vod" || tab === "series" ? (
						<select
							className="toolbar-sort-select"
							value={sort ?? "added"}
							aria-label={t("iptv.sort")}
							onChange={(event) => update({ sort: event.target.value as Sort })}
						>
							<option value="added">{t("library.sort.dateCreated")}</option>
							<option value="title">{t("library.sort.sortName")}</option>
							<option value="rating">{t("library.sort.communityRating")}</option>
						</select>
					) : null}
					<button
						type="button"
						className={`filter-toggle${favorites ? " filter-toggle-active" : ""}`}
						aria-pressed={Boolean(favorites)}
						onClick={() => update({ favorites: favorites ? undefined : true })}
						data-tv-focusable="true"
					>
						<Heart size={15} fill={favorites ? "currentColor" : "none"} /> {t("iptv.favorites")}
					</button>
				</div>
			</div>

			{genre ? (
				<div className="page-wrap active-filters">
					<button
						type="button"
						className="active-filter-chip"
						onClick={() => update({ genre: undefined })}
						data-tv-focusable="true"
					>
						{genre} <X size={11} />
					</button>
				</div>
			) : null}
			{group ? (
				<div className="page-wrap active-filters">
					<button
						type="button"
						className="active-filter-chip"
						onClick={() => update({ group: undefined })}
						data-tv-focusable="true"
					>
						{group} <X size={11} />
					</button>
				</div>
			) : null}

			{unavailable ? (
				<div className="page-wrap">
					<div className="library-empty">
						<p className="eyebrow">{t("section.readyWhenYouAre")}</p>
						<h3>{status.enabled ? t("iptv.noSources") : t("iptv.disabled")}</h3>
						{status.enabled ? (
							<Link to="/settings" className="filter-clear" data-tv-focusable="true">
								<Settings2 size={13} /> {t("iptv.manageSources")}
							</Link>
						) : null}
					</div>
				</div>
			) : tab === "guide" ? (
				status ? (
					<IptvGuide group={group} query={search} favorites={favorites} onGroups={setGuideGroups} />
				) : null
			) : (
				<div
					className={`page-wrap library-grid ${tab === "live" ? "iptv-channel-grid" : "iptv-poster-grid"}`}
				>
					{browse.isLoading || !status
						? SKELETON_KEYS.map((key) => (
								<div
									key={key}
									className="media-card media-card-standard media-card-skeleton"
									aria-hidden="true"
								/>
							))
						: items.map((item, index) => (
								<MediaCard
									key={item.id}
									item={item}
									priority={index < 8}
									variant={tab === "live" ? "standard" : "poster"}
									onClick={() => dispatchSelect(item)}
									onPlay={(target) => dispatchPlay(target, items)}
									onToggleFavorite={(target) =>
										favoriteMutation.mutate({
											id: target.id,
											isFavorite: Boolean(target.isFavorite),
										})
									}
								/>
							))}
					{!browse.isLoading && status && items.length === 0 ? (
						<div className="library-empty">
							<p className="eyebrow">{t("section.readyWhenYouAre")}</p>
							<h3>{browse.isError ? t("iptv.loadError") : t("iptv.noResults")}</h3>
							{browse.isError ? (
								<button
									type="button"
									className="filter-clear"
									onClick={() => void browse.refetch()}
									data-tv-focusable="true"
								>
									{t("iptv.retry")}
								</button>
							) : null}
						</div>
					) : null}
				</div>
			)}

			<div ref={sentinelRef} />

			{!unavailable && tab !== "guide" ? (
				<div className="page-wrap library-footer library-footer-compact">
					{browse.isLoading || isFetchingNextPage ? (
						<span className="eyebrow" style={{ opacity: 0.5 }}>
							{t("search.searching")}
						</span>
					) : (
						<span>{t("library.totalTitles", { count: total })}</span>
					)}
				</div>
			) : null}
		</main>
	);
}

/** Films or series as rows, like a streaming service's front page. */
function IptvRows({
	kind,
	tabs,
	onFilter,
}: {
	kind: "vod" | "series";
	tabs: ReactNode;
	onFilter: (filter: Partial<IptvSearch>) => void;
}) {
	const { t, locale } = useI18n();
	const { data, isLoading } = useQuery({
		queryKey: ["iptv-rows", kind, locale],
		queryFn: () => fetchIptvBrowseRowsRuntime({ kind, locale }),
		staleTime: 5 * 60_000,
	});
	const rows: BrowseRowSpec[] = (data?.rows ?? []).map((row) => ({
		id: row.id,
		title: row.titleKey ? t(`browse.row.${row.titleKey}`) : (row.title ?? ""),
		items: row.items,
		wide: row.titleKey === "continue",
		onSeeAll:
			row.titleKey === "continue"
				? undefined
				: () =>
						onFilter({
							group: row.filter.group,
							genre: row.filter.genre,
							sort: row.filter.sort,
							favorites: row.filter.favorites,
						}),
	}));
	return (
		<BrowseRows
			hero={data?.hero ?? []}
			rows={rows}
			loading={isLoading}
			title={kind === "vod" ? t("iptv.movies") : t("iptv.series")}
			toolbar={<div className="genre-strip">{tabs}</div>}
			onShowAll={() => onFilter({})}
		/>
	);
}
