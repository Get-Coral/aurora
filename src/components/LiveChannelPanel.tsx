import { Tv, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { useI18n } from "../lib/i18n";
import type { MediaItem } from "../lib/media";

/**
 * The channels you came from, with what's on, to switch without leaving the
 * player. The current channel is in view and focused when it opens, so a
 * remote can go straight up or down.
 */
export function LiveChannelPanel({
	channels,
	currentId,
	guide,
	onSelect,
	onClose,
}: {
	channels: MediaItem[];
	currentId: string;
	guide?: Record<string, MediaItem["epg"]>;
	onSelect: (channel: MediaItem) => void;
	onClose: () => void;
}) {
	const { t } = useI18n();
	const listRef = useRef<HTMLOListElement>(null);

	useEffect(() => {
		const current = listRef.current?.querySelector<HTMLButtonElement>(
			".player-channel-current button",
		);
		current?.scrollIntoView({ block: "center" });
		current?.focus({ preventScroll: true });
	}, []);

	return (
		<aside
			className="player-channel-panel"
			aria-label={t("player.channels")}
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => {
				// Up/down move through the list here instead of zapping.
				if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault();
					event.stopPropagation();
					const buttons = Array.from(
						listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
					);
					const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
					const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
					next?.focus();
					next?.scrollIntoView({ block: "nearest" });
				}
				if (event.key === "Escape") {
					event.stopPropagation();
					onClose();
				}
			}}
		>
			<div className="player-channel-head">
				<p className="eyebrow">{t("player.channels")}</p>
				<button
					type="button"
					className="icon-button"
					onClick={onClose}
					aria-label={t("player.closeChannels")}
				>
					<X size={18} />
				</button>
			</div>
			<ol ref={listRef}>
				{channels.map((channel) => {
					const epg = guide?.[channel.id] ?? channel.epg;
					const now = epg?.now;
					const progress = now
						? Math.min(100, Math.max(0, ((Date.now() - now.start) / (now.end - now.start)) * 100))
						: 0;
					return (
						<li
							key={channel.id}
							className={channel.id === currentId ? "player-channel-current" : undefined}
						>
							<button
								type="button"
								onClick={() => onSelect(channel)}
								data-tv-focusable="true"
								aria-current={channel.id === currentId}
							>
								<span className="player-channel-logo">
									{channel.logoUrl ? (
										<img src={channel.logoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
									) : (
										<Tv size={16} />
									)}
								</span>
								<span className="player-channel-copy">
									<strong>
										{channel.channelNumber ? <small>{channel.channelNumber}</small> : null}
										{channel.title}
									</strong>
									<span>{now?.title ?? channel.group ?? ""}</span>
									{now ? (
										<i className="player-channel-progress">
											<i style={{ width: `${progress}%` }} />
										</i>
									) : null}
								</span>
							</button>
						</li>
					);
				})}
			</ol>
		</aside>
	);
}
