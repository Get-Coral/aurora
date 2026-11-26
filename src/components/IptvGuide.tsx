import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatClock } from "../lib/clock";
import { useI18n } from "../lib/i18n";
import type { MediaItem, MediaProgramme } from "../lib/media";
import { fetchIptvGuideRowsRuntime } from "../lib/runtime-functions";

const PX_PER_MINUTE = 4;
const WINDOW_HOURS = 6;
const PAGE_SIZE = 30;

function clock(time: number) {
	return formatClock(time);
}

function select(item: MediaItem) {
	window.dispatchEvent(new CustomEvent("aurora:select-media", { detail: item }));
}

function play(item: MediaItem, queue: MediaItem[]) {
	window.dispatchEvent(new CustomEvent("aurora:play-media", { detail: { item, queue } }));
}

function replayItem(channel: MediaItem, programme: MediaProgramme): MediaItem | null {
	if (!programme.replayId) return null;
	return {
		id: programme.replayId,
		source: "iptv",
		type: "episode",
		title: programme.title,
		seriesTitle: channel.title,
		overview: programme.description,
		runtimeMinutes: Math.round((programme.end - programme.start) / 60_000),
		genres: channel.genres,
		posterUrl: channel.posterUrl,
		logoUrl: channel.logoUrl,
		airing: { title: programme.title, start: programme.start, end: programme.end },
		streamUrl: programme.replayId,
	};
}

/**
 * The TV guide as a timeline: channels down, time across. Programmes on now
 * play live, earlier ones play back from the archive where the provider keeps
 * one, later ones open the channel.
 */
export function IptvGuide({
	group,
	query,
	favorites,
	onGroups,
}: {
	group?: string;
	query: string;
	favorites?: boolean;
	onGroups: (groups: string[]) => void;
}) {
	const { t } = useI18n();
	const scrollRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);
	const [shiftHours, setShiftHours] = useState(0);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);

	// The window starts an hour before the current half hour.
	const from = useMemo(() => {
		const base = new Date();
		base.setMinutes(base.getMinutes() < 30 ? 0 : 30, 0, 0);
		return base.getTime() - 3600_000 + shiftHours * 3600_000;
	}, [shiftHours]);
	const to = from + WINDOW_HOURS * 3600_000;
	const width = WINDOW_HOURS * 60 * PX_PER_MINUTE;

	const guide = useInfiniteQuery({
		queryKey: ["iptv-guide", group ?? "", query, favorites ?? false, from],
		queryFn: ({ pageParam }) =>
			fetchIptvGuideRowsRuntime({
				group,
				query,
				favoritesOnly: favorites,
				offset: pageParam,
				limit: PAGE_SIZE,
				from,
				to,
			}),
		initialPageParam: 0,
		getNextPageParam: (last, pages) => {
			const loaded = pages.reduce((sum, page) => sum + page.rows.length, 0);
			return loaded < last.total ? loaded : undefined;
		},
		staleTime: 60_000,
		refetchInterval: 5 * 60_000,
	});
	const rows = guide.data?.pages.flatMap((page) => page.rows) ?? [];
	const channels = rows.map((row) => row.channel);
	const groups = guide.data?.pages[0]?.groups;

	useEffect(() => {
		if (groups) onGroups(groups);
	}, [groups, onGroups]);

	// Open on the current time.
	useEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller || shiftHours !== 0) return;
		scroller.scrollLeft = Math.max(0, ((now - from) / 60_000) * PX_PER_MINUTE - 120);
	}, [from, now, shiftHours]);

	const { fetchNextPage, hasNextPage, isFetchingNextPage } = guide;
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

	const ticks = Array.from({ length: WINDOW_HOURS * 2 }, (_, index) => from + index * 1800_000);
	const nowLeft = ((now - from) / 60_000) * PX_PER_MINUTE;

	return (
		<div className="page-wrap iptv-guide">
			<div className="iptv-guide-nav">
				<button
					type="button"
					className="icon-button"
					onClick={() => setShiftHours((value) => Math.max(-24, value - 3))}
					aria-label={t("iptv.guideEarlier")}
					title={t("iptv.guideEarlier")}
					data-tv-focusable="true"
				>
					<ChevronLeft size={18} />
				</button>
				<button
					type="button"
					className="genre-pill"
					onClick={() => setShiftHours(0)}
					data-tv-focusable="true"
				>
					{t("iptv.guideNow")}
				</button>
				<button
					type="button"
					className="icon-button"
					onClick={() => setShiftHours((value) => Math.min(18, value + 3))}
					aria-label={t("iptv.guideLater")}
					title={t("iptv.guideLater")}
					data-tv-focusable="true"
				>
					<ChevronRight size={18} />
				</button>
				<span className="iptv-guide-range">
					{new Date(from).toLocaleDateString([], {
						weekday: "long",
						day: "numeric",
						month: "long",
					})}
					{" · "}
					{clock(from)}–{clock(to)}
				</span>
			</div>

			<div className="iptv-guide-scroll" ref={scrollRef}>
				<div className="iptv-guide-grid" style={{ width: `calc(14rem + ${width}px)` }}>
					<div className="iptv-guide-ruler">
						<div className="iptv-guide-corner" />
						<div className="iptv-guide-ticks" style={{ width }}>
							{ticks.map((tick) => (
								<span key={tick} style={{ left: ((tick - from) / 60_000) * PX_PER_MINUTE }}>
									{clock(tick)}
								</span>
							))}
						</div>
					</div>

					{rows.map(({ channel, programmes }) => (
						<div key={channel.id} className="iptv-guide-row" data-tv-row>
							<div className="iptv-guide-channel">
								<button
									type="button"
									className="iptv-guide-channel-button"
									onClick={() => select(channel)}
									data-tv-focusable="true"
								>
									<span className="iptv-guide-logo">
										{channel.logoUrl ? (
											<img
												src={channel.logoUrl}
												alt=""
												loading="lazy"
												referrerPolicy="no-referrer"
											/>
										) : null}
									</span>
									<span className="iptv-guide-name">
										{channel.channelNumber ? <small>{channel.channelNumber}</small> : null}
										{channel.title}
									</span>
								</button>
								<button
									type="button"
									className="icon-button"
									onClick={() => play(channel, channels)}
									aria-label={t("dialog.watchLive")}
									title={t("dialog.watchLive")}
								>
									<Play size={14} fill="currentColor" />
								</button>
							</div>
							<div className="iptv-guide-track" style={{ width }}>
								{programmes.length === 0 ? (
									<span className="iptv-guide-empty">{t("dialog.noGuide")}</span>
								) : null}
								{programmes.map((programme) => {
									const start = Math.max(programme.start, from);
									const end = Math.min(programme.end, to);
									const left = ((start - from) / 60_000) * PX_PER_MINUTE;
									const blockWidth = Math.max(2, ((end - start) / 60_000) * PX_PER_MINUTE - 3);
									const state =
										programme.end <= now ? "past" : programme.start <= now ? "now" : "later";
									const replay = state === "past" ? replayItem(channel, programme) : null;
									const progress =
										state === "now"
											? ((now - programme.start) / (programme.end - programme.start)) * 100
											: 0;
									return (
										<button
											key={programme.start}
											type="button"
											className={`iptv-guide-programme iptv-guide-${state}${replay ? " iptv-guide-replay" : ""}`}
											style={{ left, width: blockWidth }}
											title={`${clock(programme.start)}–${clock(programme.end)} · ${programme.title}`}
											onClick={() => {
												if (state === "now") play(channel, channels);
												else if (replay) play(replay, [replay]);
												else select(channel);
											}}
											data-tv-focusable="true"
										>
											<span className="iptv-guide-label">
												<strong>
													{replay ? <RotateCcw size={11} /> : null}
													{programme.title}
												</strong>
												<span>{clock(programme.start)}</span>
											</span>
											{state === "now" ? (
												<i className="iptv-guide-progress" style={{ width: `${progress}%` }} />
											) : null}
										</button>
									);
								})}
								{nowLeft > 0 && nowLeft < width ? (
									<span className="iptv-guide-now-line" style={{ left: nowLeft }} />
								) : null}
							</div>
						</div>
					))}
				</div>
			</div>

			{guide.isLoading ? <p className="settings-locked-note">{t("search.searching")}</p> : null}
			{!guide.isLoading && rows.length === 0 ? (
				<div className="library-empty">
					<h3>{guide.isError ? t("iptv.loadError") : t("iptv.guideEmpty")}</h3>
				</div>
			) : null}
			<div ref={sentinelRef} />
		</div>
	);
}
