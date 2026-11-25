import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useI18n } from "../lib/i18n";
import type { MediaItem } from "../lib/media";
import { useTvMode } from "../lib/tv-mode";
import { HeroSection } from "./HeroSection";
import { MediaCard } from "./MediaCard";
import { useFavoriteAction } from "./useFavoriteAction";

export interface BrowseRowSpec {
	id: string;
	title: string;
	/** Items known up front, or a loader that runs once the row is near the screen. */
	items?: MediaItem[];
	load?: () => Promise<MediaItem[]>;
	queryKey?: unknown[];
	onSeeAll?: () => void;
	/** Wide cards for episodes and things in progress. */
	wide?: boolean;
}

function select(item: MediaItem) {
	window.dispatchEvent(new CustomEvent("aurora:select-media", { detail: item }));
}

function play(item: MediaItem, queue: MediaItem[]) {
	if (item.type === "series" || item.type === "collection") return select(item);
	window.dispatchEvent(
		new CustomEvent("aurora:play-media", {
			detail: { item, queue: item.type === "episode" ? [item] : queue },
		}),
	);
}

/** Becomes true once the element comes within reach of the screen. */
function useNearScreen<T extends Element>() {
	const ref = useRef<T>(null);
	const [near, setNear] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (!element || near) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setNear(true);
			},
			{ rootMargin: "600px 0px" },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [near]);
	return { ref, near };
}

export function BrowseRow({ row }: { row: BrowseRowSpec }) {
	const { t } = useI18n();
	const favorite = useFavoriteAction();
	const { ref, near } = useNearScreen<HTMLElement>();
	const trackRef = useRef<HTMLDivElement>(null);
	const [edges, setEdges] = useState({ start: true, end: false });
	const { data: loaded, isLoading } = useQuery({
		queryKey: row.queryKey ?? ["browse-row", row.id],
		queryFn: () => row.load?.() ?? Promise.resolve([] as MediaItem[]),
		enabled: Boolean(row.load) && near,
		staleTime: 5 * 60_000,
	});
	const items = row.items ?? loaded ?? [];

	function updateEdges() {
		const track = trackRef.current;
		if (!track) return;
		setEdges({
			start: track.scrollLeft < 8,
			end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 8,
		});
	}

	useEffect(updateEdges, [items.length]);

	function page(direction: 1 | -1) {
		const track = trackRef.current;
		if (!track) return;
		track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: "smooth" });
	}

	// A loaded row without titles disappears instead of leaving a gap.
	if (row.load && near && !isLoading && !items.length) return null;
	if (!row.load && !items.length) return null;

	return (
		<section ref={ref} className="browse-row">
			<div className="browse-row-head">
				<h2>{row.title}</h2>
				{row.onSeeAll ? (
					<button
						type="button"
						className="browse-row-all"
						onClick={row.onSeeAll}
						data-tv-focusable="true"
					>
						{t("browse.seeAll")} <ChevronRight size={15} />
					</button>
				) : null}
			</div>
			<div className="browse-row-frame">
				{!edges.start ? (
					<button
						type="button"
						className="browse-row-arrow browse-row-arrow-left"
						onClick={() => page(-1)}
						aria-label={t("browse.previous")}
						tabIndex={-1}
					>
						<ChevronLeft size={26} />
					</button>
				) : null}
				<div
					ref={trackRef}
					className={`browse-row-track${row.wide ? " browse-row-wide" : ""}`}
					onScroll={updateEdges}
					data-tv-row
				>
					{items.length
						? items.map((item) => (
								<MediaCard
									key={item.id}
									item={item}
									variant={row.wide || item.type === "channel" ? "standard" : "poster"}
									onClick={() => select(item)}
									onPlay={(target) => play(target, items)}
									onToggleFavorite={(target) =>
										favorite.mutate({ id: target.id, isFavorite: Boolean(target.isFavorite) })
									}
								/>
							))
						: Array.from({ length: 6 }, (_, index) => (
								<div
									// oxlint-disable-next-line react/no-array-index-key -- placeholders have no identity
									key={index}
									className="media-card media-card-poster media-card-skeleton"
									aria-hidden="true"
								/>
							))}
				</div>
				{!edges.end && items.length ? (
					<button
						type="button"
						className="browse-row-arrow browse-row-arrow-right"
						onClick={() => page(1)}
						aria-label={t("browse.next")}
						tabIndex={-1}
					>
						<ChevronRight size={26} />
					</button>
				) : null}
			</div>
		</section>
	);
}

/**
 * A streaming-service style page: a featured title up top, then rows of
 * titles by what's new, rated, yours and by category, each scrolling
 * sideways and loading when it comes near.
 */
export function BrowseRows({
	hero,
	rows,
	title,
	onShowAll,
	toolbar,
	loading,
}: {
	hero: MediaItem[];
	rows: BrowseRowSpec[];
	title: string;
	onShowAll?: () => void;
	toolbar?: ReactNode;
	loading?: boolean;
}) {
	const { t } = useI18n();
	const { tvMode } = useTvMode();
	const [heroIndex, setHeroIndex] = useState(0);
	const heroItem = hero.length ? hero[heroIndex % hero.length] : undefined;

	useEffect(() => {
		if (hero.length < 2) return;
		const timer = setInterval(() => setHeroIndex((index) => index + 1), tvMode ? 15_000 : 12_000);
		return () => clearInterval(timer);
	}, [hero.length, tvMode]);

	return (
		<main className="home-shell browse-shell">
			{heroItem ? (
				<HeroSection
					item={heroItem}
					companionItems={hero.filter((item) => item.id !== heroItem.id).slice(0, 4)}
					onPlay={() => play(heroItem, [heroItem])}
					onMoreInfo={() => select(heroItem)}
					onSelectCompanion={select}
				/>
			) : (
				<div className="browse-hero-spacer" />
			)}
			<div className="home-gradient-band" />
			<div className="page-wrap browse-rows">
				<div className="browse-toolbar">
					<h1>{title}</h1>
					<div className="browse-toolbar-actions">
						{toolbar}
						{onShowAll ? (
							<button
								type="button"
								className="genre-pill"
								onClick={onShowAll}
								data-tv-focusable="true"
							>
								<LayoutGrid size={15} /> {t("browse.allTitles")}
							</button>
						) : null}
					</div>
				</div>
				{loading
					? Array.from({ length: 3 }, (_, index) => (
							<BrowseRow
								// oxlint-disable-next-line react/no-array-index-key -- placeholders have no identity
								key={index}
								row={{ id: `loading-${index}`, title: "", load: () => new Promise(() => {}) }}
							/>
						))
					: rows.map((row) => <BrowseRow key={row.id} row={row} />)}
			</div>
		</main>
	);
}
