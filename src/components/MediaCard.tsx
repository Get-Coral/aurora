import { Check, CheckCircle, Heart, Info, Play, Plus, Star } from "lucide-react";
import { isResumable, type MediaItem } from "../lib/media";
import { useI18n } from "../lib/i18n";
import { useTvMode } from "../lib/tv-mode";
import { usePrefetchMediaDetails } from "./usePrefetchMediaDetails";

interface MediaCardProps {
	item: MediaItem;
	onClick?: () => void;
	priority?: boolean;
	variant?: "feature" | "poster" | "standard";
	onPlay?: (item: MediaItem) => void;
	onToggleFavorite?: (item: MediaItem) => void;
}

export function MediaCard({
	item,
	onClick,
	priority = false,
	variant = "standard",
	onPlay,
	onToggleFavorite,
}: MediaCardProps) {
	const { t } = useI18n();
	const { tvMode } = useTvMode();
	const resumable = isResumable(item);
	const prefetchMediaDetails = usePrefetchMediaDetails();

	function handlePrefetch() {
		void prefetchMediaDetails(item).catch(() => undefined);
	}

	return (
		<div
			className={`media-card media-card-${variant}${item.played ? " media-card-watched" : ""}`}
			onClick={onClick}
			onMouseEnter={handlePrefetch}
			onFocus={handlePrefetch}
			onTouchStart={handlePrefetch}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					if (tvMode && onPlay) {
						onPlay(item);
					} else {
						onClick?.();
					}
				}
			}}
			data-tv-focusable="true"
		>
			{(item.backdropUrl ?? item.posterUrl) ? (
				<img
					src={
						variant === "poster"
							? (item.posterUrl ?? item.backdropUrl)
							: (item.backdropUrl ?? item.posterUrl)
					}
					alt={item.title}
					loading={priority ? "eager" : "lazy"}
				/>
			) : (
				<div className="media-card-fallback">
					<span>{item.title.slice(0, 1)}</span>
				</div>
			)}

			<div className="card-overlay" />

			{item.played ? (
				<div className="card-watched-badge" aria-label="Watched">
					<CheckCircle size={14} />
				</div>
			) : item.progress != null && item.progress > 0 ? (
				<div className="card-progress-bar">
					<div className="card-progress-fill" style={{ width: `${item.progress}%` }} />
				</div>
			) : null}

			<div className="card-topline">
				<span className="card-format">
					{item.type === "series"
						? t("card.series")
						: variant === "feature"
							? t("card.tonight")
							: t("card.feature")}
				</span>
				<div className="card-badges">
					{item.isFavorite ? (
						<span className="card-favorite">
							<Heart size={12} fill="currentColor" /> {t("card.favorite")}
						</span>
					) : null}
					{item.rating != null ? (
						<span className="card-rating">
							<Star size={12} fill="currentColor" /> {item.rating.toFixed(1)}
						</span>
					) : null}
				</div>
			</div>

			<div className="card-hover-actions">
				<button
					type="button"
					className="card-action-button card-action-primary"
					onClick={(event) => {
						event.stopPropagation();
						onPlay?.(item);
					}}
					aria-label={resumable ? t("card.resume") : t("card.play")}
				>
					<Play size={14} fill="currentColor" />
					<span className="card-action-label">{resumable ? t("card.resume") : t("card.play")}</span>
				</button>
				<button
					type="button"
					className="card-action-button"
					onClick={(event) => {
						event.stopPropagation();
						onClick?.();
					}}
					aria-label={t("card.details")}
				>
					<Info size={14} />
					<span className="card-action-label">{t("card.details")}</span>
				</button>
				<button
					type="button"
					className="card-action-button"
					onClick={(event) => {
						event.stopPropagation();
						onToggleFavorite?.(item);
					}}
					aria-label={item.isFavorite ? t("card.removeFromMyList") : t("card.addToMyList")}
				>
					{item.isFavorite ? (
						<>
							<Check size={14} />
							<span className="card-action-label card-action-label-wide">{t("card.inMyList")}</span>
						</>
					) : (
						<>
							<Plus size={14} />
							<span className="card-action-label">{t("card.myList")}</span>
						</>
					)}
				</button>
			</div>

			<div className="card-body">
				<div className="card-copy">
					<p className="card-title">{item.title}</p>
					<p className="card-subtitle">
						{[item.year, item.ageRating, item.runtimeMinutes ? `${item.runtimeMinutes}m` : null]
							.filter(Boolean)
							.join(" • ") || t("card.instantlyAvailable")}
					</p>
				</div>

				<span className="card-action" aria-hidden="true">
					<Play size={14} fill="currentColor" />
				</span>
			</div>
		</div>
	);
}
