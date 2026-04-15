import { Clock3, Heart, Play, Sparkles, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isResumable, type MediaItem } from "../lib/media";
import { useI18n } from "../lib/i18n";
import { useTvMode } from "../lib/tv-mode";

interface HeroSectionProps {
	item: MediaItem;
	continueItem?: MediaItem | null;
	companionItems?: MediaItem[];
	onPlay?: () => void;
	onPlayContinue?: (item: MediaItem) => void;
	onMoreInfo?: () => void;
	onSelectCompanion?: (item: MediaItem) => void;
}

function formatRuntime(minutes?: number) {
	if (!minutes) return null;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function HeroSection({
	item,
	continueItem,
	companionItems = [],
	onPlay,
	onPlayContinue,
	onMoreInfo,
	onSelectCompanion,
}: HeroSectionProps) {
	const { t } = useI18n();
	const { tvMode } = useTvMode();
	const itemIsResumable = isResumable(item);
	const continueIsResumable = continueItem ? isResumable(continueItem) : false;

	// Cross-fade: track previous item so both backdrop and content can transition
	const [prevItem, setPrevItem] = useState<MediaItem | null>(null);
	const [fadeKey, setFadeKey] = useState(0);
	const prevItemIdRef = useRef(item.id);
	const prevItemRef = useRef<MediaItem>(item);

	useEffect(() => {
		if (item.id === prevItemIdRef.current) return;
		setPrevItem(prevItemRef.current);
		setFadeKey((k) => k + 1);
		prevItemIdRef.current = item.id;
		prevItemRef.current = item;
	}, [item.id]);

	function renderCopyContent(i: MediaItem, isResumableItem: boolean) {
		const rt = formatRuntime(i.runtimeMinutes);
		const meta = [i.year, rt, i.ageRating].filter(Boolean);
		return (
			<>
				{i.genres.length > 0 ? (
					<p className="eyebrow hero-kicker">{i.genres.slice(0, 3).join(" • ")}</p>
				) : null}

				{i.logoUrl ? (
					<img src={i.logoUrl} alt={i.title} className="hero-logo" />
				) : (
					<h1 className="hero-title">{i.title}</h1>
				)}

				<div className="hero-meta">
					{meta.map((entry) => (
						<span key={entry}>{entry}</span>
					))}
					{i.rating != null ? (
						<span className="hero-rating">
							<Star size={14} fill="currentColor" /> {i.rating.toFixed(1)}
						</span>
					) : null}
				</div>

				{i.overview ? <p className="hero-overview">{i.overview}</p> : null}

				<div className="hero-actions">
					<button
						className="primary-action"
						onClick={onPlay}
						type="button"
						data-tv-focusable="true"
					>
						<Play size={18} fill="currentColor" />
						{isResumableItem ? t("hero.resumeNow") : t("hero.playNow")}
					</button>
					<button
						className="secondary-action"
						onClick={onMoreInfo}
						type="button"
						data-tv-focusable="true"
					>
						{t("hero.moreInfo")}
					</button>
				</div>

				{!tvMode ? (
					<div className="hero-stat-strip">
						<div>
							<span className="hero-stat-value">{i.genres[0] ?? t("hero.cinematic")}</span>
							<span className="hero-stat-label">{t("hero.mood")}</span>
						</div>
						<div>
							<span className="hero-stat-value">{rt ?? t("hero.readyTonight")}</span>
							<span className="hero-stat-label">{t("hero.runtime")}</span>
						</div>
						<div>
							<span className="hero-stat-value">{i.year ?? t("hero.freshPick")}</span>
							<span className="hero-stat-label">{t("hero.release")}</span>
						</div>
					</div>
				) : null}
			</>
		);
	}

	return (
		<section id="spotlight" className="hero-shell">
			{/* Outgoing backdrop fades out */}
			{prevItem?.backdropUrl ? (
				<img
					src={prevItem.backdropUrl}
					alt=""
					className="hero-backdrop hero-backdrop-out"
					style={{ objectPosition: "center 18%" }}
				/>
			) : null}
			{/* Incoming backdrop fades in on top */}
			{item.backdropUrl ? (
				<img
					key={fadeKey}
					src={item.backdropUrl}
					alt=""
					className="hero-backdrop hero-backdrop-in"
					style={{ objectPosition: "center 18%" }}
				/>
			) : (
				<div className="hero-backdrop-fallback" />
			)}

			<div className="hero-backdrop-overlay" />

			<div className="hero-content page-wrap">
				<div style={{ position: "relative" }}>
					{/* Outgoing text content fades out absolutely */}
					{prevItem ? (
						<div className="hero-copy hero-copy-out" aria-hidden="true">
							{renderCopyContent(prevItem, isResumable(prevItem))}
						</div>
					) : null}
					{/* Incoming text content fades in */}
					<div key={fadeKey} className={`hero-copy ${fadeKey === 0 ? "fade-up" : "hero-copy-in"}`}>
						{renderCopyContent(item, itemIsResumable)}
					</div>
				</div>

				{continueItem && !tvMode ? (
					<aside className="continue-panel fade-up">
						<div className="hero-panel-head">
							<div>
								<p className="eyebrow">{t("hero.continueWatching")}</p>
								<strong>{t("hero.pickUpInstantly")}</strong>
							</div>
							<Clock3 size={18} />
						</div>
						<div className="continue-media">
							{(continueItem.backdropUrl ?? continueItem.posterUrl) ? (
								<img
									src={continueItem.backdropUrl ?? continueItem.posterUrl}
									alt={continueItem.title}
									className="continue-image"
								/>
							) : (
								<div className="continue-image continue-image-fallback" />
							)}
						</div>

						<div className="continue-copy">
							<h2>{continueItem.title}</h2>
							<p>
								{continueItem.seriesTitle
									? t("hero.episodeLabel", {
											seriesTitle: continueItem.seriesTitle,
											episodeNumber: continueItem.episodeNumber ?? "?",
										})
									: (continueItem.overview ?? t("hero.pickUpInstantly"))}
							</p>
						</div>

						<div className="progress-bar">
							<div
								className="progress-bar-fill"
								style={{ width: `${continueItem.progress ?? 0}%` }}
							/>
						</div>

						<div className="continue-footer">
							<span>
								{continueItem.progress
									? t("hero.progressWatched", { progress: Math.round(continueItem.progress) })
									: t("hero.readyToResume")}
							</span>
							<button
								className="secondary-action"
								onClick={() =>
									continueIsResumable ? onPlayContinue?.(continueItem) : onMoreInfo?.()
								}
								type="button"
								data-tv-focusable="true"
							>
								{continueIsResumable ? t("hero.resumeNow") : t("hero.open")}
							</button>
						</div>

						{companionItems.length ? (
							<div className="hero-queue">
								<div className="hero-panel-head">
									<div>
										<p className="eyebrow">{t("hero.queueAfterThat")}</p>
										<strong>{t("hero.queueCopy")}</strong>
									</div>
									<Sparkles size={18} />
								</div>
								<div className="hero-queue-list">
									{companionItems.slice(0, 3).map((companion) => (
										<button
											key={companion.id}
											type="button"
											className="hero-queue-item"
											onClick={() => onSelectCompanion?.(companion)}
											data-tv-focusable="true"
										>
											{companion.posterUrl ? (
												<img
													src={companion.posterUrl}
													alt={companion.title}
													className="hero-queue-poster"
												/>
											) : (
												<div className="hero-queue-poster hero-queue-poster-fallback" />
											)}
											<span>
												<strong>{companion.title}</strong>
												<em>
													{[
														companion.type === "series" ? t("player.series") : t("player.movie"),
														companion.year,
													]
														.filter(Boolean)
														.join(" • ")}
												</em>
											</span>
										</button>
									))}
								</div>
							</div>
						) : null}
					</aside>
				) : null}
			</div>
		</section>
	);
}
