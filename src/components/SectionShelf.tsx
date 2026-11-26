import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { useI18n } from "../lib/i18n";
import type { MediaItem } from "../lib/media";
import { useTvMode } from "../lib/tv-mode";
import { MediaCard } from "./MediaCard";

interface SectionShelfProps {
	id: string;
	title: string;
	subtitle: string;
	items: MediaItem[];
	onSelect: (item: MediaItem) => void;
	onPlay: (item: MediaItem) => void;
	onToggleFavorite?: (item: MediaItem) => void;
	browseTo?:
		| "/library/movies"
		| "/library/series"
		| "/my-list"
		| "/history"
		| "/collections"
		| "/iptv";
	browseSearch?: { tab?: "live" | "guide" };
	emptyTitle?: string;
	emptyCopy?: string;
}

export function SectionShelf({
	id,
	title,
	subtitle,
	items,
	onSelect,
	onPlay,
	onToggleFavorite,
	browseTo,
	browseSearch,
	emptyTitle,
	emptyCopy,
}: SectionShelfProps) {
	const { t } = useI18n();
	const { tvMode } = useTvMode();
	// On a TV every card in a row has the same size, so Left/Right walks an
	// even line: films and series as posters, channels and episodes (and
	// everything in "continue watching") as wide tiles.
	const variantFor = (item: MediaItem, index: number): "feature" | "poster" | "standard" => {
		if (item.type === "channel") return "standard";
		if (tvMode) {
			return id !== "continue" && (item.type === "movie" || item.type === "series")
				? "poster"
				: "standard";
		}
		return index === 0 ? "feature" : index < 3 ? "poster" : "standard";
	};
	const linkSearch =
		browseTo === "/library/movies" || browseTo === "/library/series"
			? { sort: "DateCreated", order: "Descending", ratings: "", decade: "", minScore: 0 }
			: browseTo === "/iptv"
				? { tab: browseSearch?.tab ?? "live" }
				: undefined;

	return (
		<section id={id} className="shelf-section">
			<div className="section-heading">
				<div>
					<p className="eyebrow">{subtitle}</p>
					<h2 className="section-title">{title}</h2>
				</div>
				{browseTo ? (
					<Link
						to={browseTo}
						search={linkSearch}
						className="section-trailing section-trailing-button"
						data-tv-focusable="true"
					>
						{t("section.browseMore")} <ChevronRight size={16} />
					</Link>
				) : null}
			</div>

			{items.length ? (
				// A row for TV navigation: coming back to it lands on the card
				// that was focused last, not the one geometrically nearest.
				<div className="shelf-grid" data-tv-row>
					{items.map((item, index) => (
						<MediaCard
							key={item.id}
							item={item}
							priority={index < 4}
							variant={variantFor(item, index)}
							onClick={() => onSelect(item)}
							onPlay={onPlay}
							onToggleFavorite={onToggleFavorite}
						/>
					))}
					{browseTo ? (
						// On a TV, "Browse more" is the last stop of the row
						// (CSS shows it only there), so Down from a card always
						// lands in the next row instead of on a link between them.
						<Link
							to={browseTo}
							search={linkSearch}
							className="shelf-more-card"
							data-tv-focusable="true"
						>
							<ChevronRight size={28} />
							<span>{t("section.browseMore")}</span>
						</Link>
					) : null}
				</div>
			) : (
				<div className="empty-shelf">
					<div className="empty-shelf-copy">
						<p className="eyebrow">{t("section.readyWhenYouAre")}</p>
						<h3>{emptyTitle ?? t("section.emptyTitle")}</h3>
						<p>{emptyCopy ?? t("section.emptyCopy")}</p>
					</div>
				</div>
			)}
		</section>
	);
}
