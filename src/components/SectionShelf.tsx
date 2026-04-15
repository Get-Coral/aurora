import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { MediaItem } from "../lib/media";
import { useI18n } from "../lib/i18n";
import { MediaCard } from "./MediaCard";

interface SectionShelfProps {
	id: string;
	title: string;
	subtitle: string;
	items: MediaItem[];
	onSelect: (item: MediaItem) => void;
	onPlay: (item: MediaItem) => void;
	onToggleFavorite?: (item: MediaItem) => void;
	browseTo?: "/library/movies" | "/library/series" | "/my-list" | "/history" | "/collections";
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
	emptyTitle,
	emptyCopy,
}: SectionShelfProps) {
	const { t } = useI18n();

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
						search={
							browseTo === "/library/movies" || browseTo === "/library/series"
								? { sort: "DateCreated", order: "Descending", ratings: "", decade: "", minScore: 0 }
								: undefined
						}
						className="section-trailing section-trailing-button"
						data-tv-focusable="true"
					>
						{t("section.browseMore")} <ChevronRight size={16} />
					</Link>
				) : null}
			</div>

			{items.length ? (
				<div className="shelf-grid">
					{items.map((item, index) => (
						<MediaCard
							key={item.id}
							item={item}
							priority={index < 4}
							variant={index === 0 ? "feature" : index < 3 ? "poster" : "standard"}
							onClick={() => onSelect(item)}
							onPlay={onPlay}
							onToggleFavorite={onToggleFavorite}
						/>
					))}
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
