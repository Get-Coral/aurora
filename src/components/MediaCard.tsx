import { Check, CheckCircle, Heart, Info, Play, Plus, Radio, Star } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../lib/i18n";
import { isResumable, type MediaItem } from "../lib/media";
import { airingLabel } from "../lib/search-labels";
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
	const [imageFailed, setImageFailed] = useState(false);
	const channel = item.type === "channel";
	// A programme from the guide (search results) shows itself, on its channel.
	const airing = item.airing;
	const onNow = airing ?? item.epg?.now;
	const liveProgress =
		onNow && onNow.start <= Date.now()
			? Math.min(100, Math.max(0, ((Date.now() - onNow.start) / (onNow.end - onNow.start)) * 100))
			: null;

	function handlePrefetch() {
		void prefetchMediaDetails(item).catch(() => undefined);
	}

	return (
		<div
			className={`media-card media-card-${variant}${channel ? " media-card-channel" : ""}${item.played && !channel ? " media-card-watched" : ""}`}
			onClick={onClick}
			onMouseEnter={handlePrefetch}
			onFocus={handlePrefetch}
			onTouchStart={handlePrefetch}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				// OK opens the details, as on Plex and Jellyfin; the remote's
				// play key starts playback straight from the card.
				if (e.key === "Enter") {
					e.preventDefault();
					onClick?.();
				} else if (tvMode && onPlay && (e.key === "MediaPlayPause" || e.key === "MediaPlay")) {
					e.preventDefault();
					onPlay(item);
				}
			}}
			data-tv-focusable="true"
		>
			{(item.backdropUrl ?? item.posterUrl) && !imageFailed ? (
				<img
					onError={() => setImageFailed(true)}
					referrerPolicy="no-referrer"
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

			{channel ? (
				liveProgress != null ? (
					<div className="card-progress-bar">
						<div className="card-progress-fill" style={{ width: `${liveProgress}%` }} />
					</div>
				) : null
			) : item.played ? (
				<div className="card-watched-badge" aria-hidden="true">
					<CheckCircle size={14} />
				</div>
			) : item.progress != null && item.progress > 0 ? (
				<div className="card-progress-bar">
					<div className="card-progress-fill" style={{ width: `${item.progress}%` }} />
				</div>
			) : null}

			<div className="card-topline">
				{/* Only kinds that need saying get a label; a film is the default. */}
				{channel || item.type === "series" || item.type === "episode" ? (
					<span className={channel ? "card-format card-format-live" : "card-format"}>
						{channel ? (
							<>
								<Radio size={12} /> {t("card.live")}
							</>
						) : item.type === "series" ? (
							t("card.series")
						) : (
							t("card.episode")
						)}
					</span>
				) : (
					<span />
				)}
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
					<p className="card-title">{airing ? airing.title : item.title}</p>
					<p className="card-subtitle">
						{channel
							? airing
								? `${airingLabel(t, airing)} · ${item.title}`
								: onNow
									? t("card.onNow", { title: onNow.title })
									: (item.group ?? t("card.live"))
							: [
									item.type === "episode" && item.seriesTitle ? item.seriesTitle : null,
									item.year,
									item.ageRating,
									item.runtimeMinutes ? `${item.runtimeMinutes}m` : null,
								]
									.filter(Boolean)
									.join(" • ")}
					</p>
				</div>

				<span className="card-action" aria-hidden="true">
					<Play size={14} fill="currentColor" />
				</span>
			</div>
		</div>
	);
}
