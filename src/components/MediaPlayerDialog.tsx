import { useQuery } from "@tanstack/react-query";
import {
	Airplay,
	Captions,
	Cast,
	Film,
	Maximize,
	Minimize,
	Pause,
	Play,
	RotateCcw,
	RotateCw,
	Search,
	SkipForward,
	SlidersHorizontal,
	Volume2,
	VolumeX,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AURORA_BACK_EVENT } from "../lib/back-navigation";
import { useI18n } from "../lib/i18n";
import {
	prepareSeekReloadUrl,
	setStreamStartTicks,
	setTranscodeQuality,
	withStreamToken,
} from "../lib/jellyfin-stream-proxy";
import type { MediaItem } from "../lib/media";
import { getClientPlaybackContext } from "../lib/platform";
import {
	clampProgress,
	isTimeBuffered,
	ratioFromPointer,
	resolveDuration,
	watchedRatio,
} from "../lib/player-timeline";
import {
	beginPlaybackSessionRuntime,
	createStreamTokenRuntime,
	fetchOnlineSubtitleRuntime,
	fetchOpenSubtitlesKeyRuntime,
	reportPlaybackStateRuntime,
	searchOnlineSubtitlesRuntime,
} from "../lib/runtime-functions";
import { moveTvFocus } from "../lib/tv-spatial-navigation";
import { useLockBodyScroll } from "./useLockBodyScroll";
import { useRemotePlayback } from "./useRemotePlayback";

interface MediaPlayerDialogProps {
	item: MediaItem | null;
	open: boolean;
	onClose: () => void;
	queue?: MediaItem[];
	onSelectQueueItem?: (item: MediaItem) => void;
}

interface VttCue {
	start: number;
	end: number;
	text: string;
}

interface TranscodeQualityProfile {
	maxStreamingBitrate: number;
	videoBitrate: number;
	audioBitrate: number;
}

const TRANSCODE_QUALITY_LADDER: TranscodeQualityProfile[] = [
	{ maxStreamingBitrate: 3_000_000, videoBitrate: 2_200_000, audioBitrate: 128_000 },
	{ maxStreamingBitrate: 5_000_000, videoBitrate: 3_800_000, audioBitrate: 160_000 },
	{ maxStreamingBitrate: 8_000_000, videoBitrate: 6_000_000, audioBitrate: 192_000 },
	{ maxStreamingBitrate: 12_000_000, videoBitrate: 9_000_000, audioBitrate: 192_000 },
	{ maxStreamingBitrate: 20_000_000, videoBitrate: 15_000_000, audioBitrate: 256_000 },
	{ maxStreamingBitrate: 40_000_000, videoBitrate: 28_000_000, audioBitrate: 320_000 },
	{ maxStreamingBitrate: 120_000_000, videoBitrate: 80_000_000, audioBitrate: 320_000 },
];

const BUFFER_DOWNGRADE_DELAY_MS = 1500;
const STABLE_PLAYBACK_UPGRADE_DELAY_MS = 45000;
const CONTROLS_HIDE_DELAY_MS = 3000;
// While a seek is on its way, timeupdates further than this from the target
// come from the old position (or the stream that is being replaced) and must
// not drag the bar back.
const SEEK_LANDING_TOLERANCE_S = 2;
// Give up on a seek that never lands (stalled transcode, rejected seek) so the
// bar can't stay frozen on the target.
const SEEK_LANDING_TIMEOUT_MS = 10000;
// Live seeking while dragging is limited to downloaded content; this keeps it
// from issuing a seek for every pointermove.
const SCRUB_LIVE_SEEK_INTERVAL_MS = 200;
const KEYBOARD_SEEK_STEP_S = 10;

function readTranscodeUrl(streamUrl: string) {
	try {
		if (streamUrl.startsWith("/api/jellyfin-stream")) {
			const outer = new URL(streamUrl, "http://x");
			const rawPath = outer.searchParams.get("path");
			if (!rawPath) return null;
			return new URL(rawPath, "http://x");
		}
		return new URL(streamUrl, "http://x");
	} catch {
		return null;
	}
}

function getTranscodeQualityIndex(streamUrl: string) {
	const url = readTranscodeUrl(streamUrl);
	if (!url) return null;

	const maxStreamingBitrate = Number(url.searchParams.get("MaxStreamingBitrate"));
	if (!Number.isFinite(maxStreamingBitrate) || maxStreamingBitrate <= 0) return null;

	let nearestIndex = 0;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const [index, profile] of TRANSCODE_QUALITY_LADDER.entries()) {
		const distance = Math.abs(profile.maxStreamingBitrate - maxStreamingBitrate);
		if (distance < nearestDistance) {
			nearestIndex = index;
			nearestDistance = distance;
		}
	}

	return nearestIndex;
}

function getRuntimeSeconds(item: MediaItem | null | undefined) {
	return item?.runtimeSeconds ?? (item?.runtimeMinutes ? item.runtimeMinutes * 60 : undefined);
}

/** The buffered range covering `time`, in stream time, if there is one. */
function findBufferedRangeAt(
	video: HTMLVideoElement,
	time: number,
): { start: number; end: number } | null {
	for (let i = 0; i < video.buffered.length; i++) {
		const start = video.buffered.start(i);
		const end = video.buffered.end(i);
		if (time >= start && time <= end) return { start, end };
	}
	return null;
}

function isNativeHlsStreamUrl(streamUrl: string) {
	const url = readTranscodeUrl(streamUrl);
	if (!url) return false;
	return url.pathname.endsWith(".m3u8") || url.searchParams.get("SegmentContainer") === "ts";
}

// The player binds its shortcuts on window, so anything typed into the subtitle
// filter would otherwise pause, seek or mute the video.
function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName.toLowerCase();
	return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function parseVttTime(s: string): number {
	const m = s.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/);
	if (!m) return 0;
	return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

function parseVtt(raw: string): VttCue[] {
	const cues: VttCue[] = [];
	const blocks = raw.replace(/\r\n/g, "\n").split(/\n\n+/);
	for (const block of blocks) {
		const lines = block.trim().split("\n");
		const timingIdx = lines.findIndex((l) => l.includes("-->"));
		if (timingIdx === -1) continue;
		const [startStr, endStr] = lines[timingIdx].split("-->");
		const text = lines
			.slice(timingIdx + 1)
			.join("\n")
			.replace(/<[^>]+>/g, "")
			.trim();
		if (text) cues.push({ start: parseVttTime(startStr), end: parseVttTime(endStr), text });
	}
	return cues;
}

function formatTime(seconds: number) {
	if (!seconds || Number.isNaN(seconds)) return "0:00";
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	return `${m}:${String(s).padStart(2, "0")}`;
}

function formatQualityLabel(profile: TranscodeQualityProfile) {
	const mbps = profile.maxStreamingBitrate / 1_000_000;
	const rounded = Number(mbps.toFixed(mbps >= 10 ? 0 : 1));
	return `${rounded} Mbps`;
}

function describeMediaError(error: MediaError | null) {
	if (!error) return null;

	const codeName =
		error.code === MediaError.MEDIA_ERR_ABORTED
			? "MEDIA_ERR_ABORTED"
			: error.code === MediaError.MEDIA_ERR_NETWORK
				? "MEDIA_ERR_NETWORK"
				: error.code === MediaError.MEDIA_ERR_DECODE
					? "MEDIA_ERR_DECODE"
					: error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
						? "MEDIA_ERR_SRC_NOT_SUPPORTED"
						: "UNKNOWN";

	return {
		code: error.code,
		codeName,
		message: error.message,
	};
}

function snapshotMediaState(video: HTMLVideoElement | null) {
	if (!video) return null;

	return {
		currentTime: Number(video.currentTime.toFixed(3)),
		duration: Number.isFinite(video.duration) ? Number(video.duration.toFixed(3)) : video.duration,
		paused: video.paused,
		muted: video.muted,
		ended: video.ended,
		readyState: video.readyState,
		networkState: video.networkState,
		currentSrc: video.currentSrc,
		error: describeMediaError(video.error),
	};
}

export function MediaPlayerDialog({
	item,
	open,
	onClose,
	queue,
	onSelectQueueItem,
}: MediaPlayerDialogProps) {
	const { t } = useI18n();
	useLockBodyScroll(open);
	const playbackClient = getClientPlaybackContext();
	const debugPlayback = process.env.NODE_ENV === "development";
	const containerRef = useRef<HTMLDivElement>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const seekDraggingRef = useRef(false);
	const ignoreVideoClickUntilRef = useRef(0);
	const qualityIndexRef = useRef<number | null>(null);
	const qualitySwitchInFlightRef = useRef(false);
	const bufferingDowngradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const stablePlaybackUpgradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [playbackSession, setPlaybackSession] = useState<{
		streamUrl: string;
		canSyncProgress: boolean;
		playMethod?: "DirectPlay" | "Transcode";
		playSessionId?: string;
		mediaSourceId?: string;
		sessionId?: string;
		subtitleTracks: {
			index: number;
			label: string;
			language: string;
			url: string;
		}[];
	} | null>(null);
	// Signed token that lets an AirPlay/Cast receiver fetch the stream without
	// Aurora's session cookie. Null when login isn't enforced (the proxy is
	// open anyway) or inside the native shell (direct Jellyfin URLs).
	const [streamToken, setStreamToken] = useState<string | null>(null);
	const lastReportedSecondRef = useRef(0);
	const stopReportedRef = useRef(false);
	// Tracks how many seconds into the movie the current stream segment starts.
	// When seeking beyond the buffer on a transcode, we reload the stream with
	// StartTimeTicks=X; after that reload video.currentTime=0 means X seconds
	// into the movie, so all time math must add this offset.
	const startTimeOffsetRef = useRef(0);
	// Set to true while a seek-triggered reload is in progress so that
	// handleLoadedMetadata skips the normal resume-position restore.
	const seekPendingRef = useRef(false);
	// Absolute movie time we expect the current seek-triggered reload to land on.
	// We only promote this into startTimeOffsetRef after the new stream proves it
	// actually starts at that offset.
	const pendingSeekTargetRef = useRef<number | null>(null);
	// Movie time the bar is pinned to while a seek is on its way. Safari's HLS
	// and a restarting transcode can take seconds to report the new position;
	// without this the bar would jump back to where playback was.
	const optimisticSeekTargetRef = useRef<number | null>(null);
	const optimisticSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Native/fullscreen media controls can change video.currentTime directly.
	// Track programmatic seeks so we only intercept user-driven native seeking.
	const internalSeekCountRef = useRef(0);
	const seekReloadRequestIdRef = useRef(0);
	const pendingUserSeekRef = useRef<number | null>(null);
	// Movie time being dragged to; mirrors scrubTime for the pointer handlers.
	const scrubTimeRef = useRef<number | null>(null);
	const lastScrubSeekAtRef = useRef(0);
	// Last movie time the element actually played, for the stop report: by the
	// time an effect cleanup runs the element may already be reset to 0.
	const lastKnownPositionRef = useRef(0);

	// What the latest render shows, for effect cleanups to tell a stream swap
	// apart from closing the player or moving to another item.
	const openRef = useRef(open);
	openRef.current = open;
	const activeItemIdRef = useRef(item?.id);
	activeItemIdRef.current = item?.id;
	const unmountingRef = useRef(false);
	// Declared before the playback effects so its cleanup runs first on
	// unmount (navigating away while playing), which is also a final stop.
	useEffect(() => {
		unmountingRef.current = false;
		return () => {
			unmountingRef.current = true;
		};
	}, []);

	const playButtonRef = useRef<HTMLButtonElement>(null);
	// Latest seek functions for the Media Session handlers, which are only
	// registered once per item.
	const mediaControlsRef = useRef<{ seekBy(delta: number): void; seekTo(time: number): void }>({
		seekBy: () => undefined,
		seekTo: () => undefined,
	});

	const [currentTime, setCurrentTime] = useState(0);
	const [scrubTime, setScrubTime] = useState<number | null>(null);
	const [duration, setDuration] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const [isBuffering, setIsBuffering] = useState(true);
	const [isMuted, setIsMuted] = useState(false);
	const [autoplayMuted, setAutoplayMuted] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [controlsVisible, setControlsVisible] = useState(true);
	const controlsVisibleRef = useRef(controlsVisible);
	controlsVisibleRef.current = controlsVisible;
	const [qualityPickerOpen, setQualityPickerOpen] = useState(false);
	const [subtitlePickerOpen, setSubtitlePickerOpen] = useState(false);
	const [subtitleFilter, setSubtitleFilter] = useState("");
	const [activeSubtitle, setActiveSubtitle] = useState<number | null>(null);
	const [manualQualityIndex, setManualQualityIndex] = useState<number | null>(null);
	const [onlineCues, setOnlineCues] = useState<VttCue[]>([]);
	const [loadingOnlineSubtitle, setLoadingOnlineSubtitle] = useState(false);
	const [onlineSubtitleError, setOnlineSubtitleError] = useState(false);
	const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null);
	const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const subtitleDivRef = useRef<HTMLDivElement>(null);
	const subtitleListRef = useRef<HTMLDivElement>(null);
	const onlineCuesRef = useRef<VttCue[]>([]);
	const subtitleOffsetRef = useRef(0);
	// Keep a ref in sync so the RAF subtitle loop can read cues without capturing stale state
	onlineCuesRef.current = onlineCues;

	const { data: osApiKey } = useQuery({
		queryKey: ["opensubtitles-key"],
		queryFn: () => fetchOpenSubtitlesKeyRuntime(),
		staleTime: Number.POSITIVE_INFINITY,
	});

	const { data: onlineSubtitles = [], isFetching: searchingSubtitles } = useQuery({
		queryKey: ["online-subtitles", item?.id],
		queryFn: () =>
			searchOnlineSubtitlesRuntime({
				data: {
					title: item!.type === "episode" ? (item!.seriesTitle ?? item!.title) : item!.title,
					year: item!.year,
					season: item!.seasonNumber,
					episode: item!.episodeNumber,
				},
			}),
		enabled: Boolean(open && item && osApiKey),
		staleTime: 0,
	});

	const baseStreamUrl =
		playbackSession?.streamUrl ?? (playbackClient.prefersSafeVideo ? null : item?.streamUrl);
	// Carry the signed token on every stream URL, not just while casting: a
	// receiver is handed `video.currentSrc` as it stands the moment the user
	// picks a device, so swapping it in afterwards is already too late. The
	// token is item-scoped and dies with the session, so it grants nothing the
	// page's own cookie doesn't.
	const streamUrl = baseStreamUrl ? withStreamToken(baseStreamUrl, streamToken) : baseStreamUrl;
	const remote = useRemotePlayback(videoRef, {
		enabled: open && Boolean(streamUrl),
		srcKey: streamUrl ?? null,
	});
	// Ref so the adaptive-quality and seek closures can read this without
	// re-subscribing every time a receiver connects.
	const remoteActiveRef = useRef(false);
	remoteActiveRef.current = remote.active;
	// AirPlay on Apple platforms, Cast everywhere else. prefersSafeVideo is
	// already true for exactly iOS and desktop Safari, minus the Android TV
	// branch which also sets it.
	const isAirplayPlatform =
		playbackClient.prefersSafeVideo && playbackClient.platform !== "android-tv";
	const isNativeHlsPlayback =
		playbackSession?.playMethod === "Transcode" &&
		streamUrl != null &&
		isNativeHlsStreamUrl(streamUrl);
	const canSelectQuality = playbackSession?.playMethod === "Transcode";
	// A quality change rebuilds the stream URL, which remounts the <video> and
	// so destroys the element holding the remote session. The local element also
	// sits in `waiting` for the whole handoff, which would drive the ladder
	// steadily downwards on its own.
	const canAutoAdjustQuality = canSelectQuality && !isNativeHlsPlayback && !remote.active;
	const isPreparingStream =
		Boolean(item?.streamUrl) && playbackClient.prefersSafeVideo && playbackSession == null;
	const runtimeSeconds = getRuntimeSeconds(item);
	// While dragging, the bar follows the pointer rather than the video.
	const displayTime = scrubTime ?? currentTime;
	const progress = clampProgress(displayTime, duration);
	const currentIndex = item && queue?.length ? queue.findIndex((q) => q.id === item.id) : -1;
	const nextItem = currentIndex >= 0 ? (queue?.[currentIndex + 1] ?? null) : null;
	const showNextButton = item?.type === "episode" && nextItem !== null;
	const displayedQualityLabel =
		manualQualityIndex == null
			? t("player.qualityAuto")
			: formatQualityLabel(TRANSCODE_QUALITY_LADDER[manualQualityIndex]);

	const nativeSubtitleTracks = playbackSession?.subtitleTracks ?? [];
	// A handful of tracks fits on screen; only a long list is worth filtering.
	const showSubtitleFilter = nativeSubtitleTracks.length + onlineSubtitles.length > 8;
	// onlineSubtitles arrives async, so the threshold can flip false while the
	// filter still holds text — never filter by a query that isn't on screen.
	const subtitleQuery = showSubtitleFilter ? subtitleFilter.trim().toLowerCase() : "";
	const matchesSubtitleQuery = (label: string, language?: string) =>
		!subtitleQuery ||
		label.toLowerCase().includes(subtitleQuery) ||
		(language?.toLowerCase().includes(subtitleQuery) ?? false);
	// Filter the rendered buttons only: track.index is the position in
	// subtitleTracks that selectSubtitle feeds to video.textTracks.
	const visibleSubtitleTracks = nativeSubtitleTracks.filter((track) =>
		matchesSubtitleQuery(track.label, track.language),
	);
	const visibleOnlineSubtitles = onlineSubtitles.filter((sub) =>
		matchesSubtitleQuery(sub.label, sub.language),
	);
	const showOnlineSubtitleSection =
		!subtitleQuery ||
		visibleOnlineSubtitles.length > 0 ||
		searchingSubtitles ||
		loadingOnlineSubtitle ||
		onlineSubtitleError;
	const noSubtitleMatches =
		Boolean(subtitleQuery) &&
		visibleSubtitleTracks.length === 0 &&
		visibleOnlineSubtitles.length === 0;

	function logPlayback(event: string, details?: Record<string, unknown>) {
		if (!debugPlayback) return;
		console.info("[aurora-playback]", event, {
			itemId: item?.id,
			title: item?.title,
			platform: playbackClient.platform,
			prefersSafeVideo: playbackClient.prefersSafeVideo,
			playMethod: playbackSession?.playMethod,
			isNativeHlsPlayback,
			resumeTicks: item?.playbackPositionTicks ?? 0,
			startTimeOffset: startTimeOffsetRef.current,
			seekPending: seekPendingRef.current,
			pendingSeekTarget: pendingSeekTargetRef.current,
			qualityIndex: qualityIndexRef.current,
			manualQualityIndex,
			...details,
		});
	}

	// Reset + prewarm playback session when the selected item changes.
	useEffect(() => {
		stopReportedRef.current = false;
		lastReportedSecondRef.current = 0;
		startTimeOffsetRef.current = 0;
		seekPendingRef.current = false;
		pendingSeekTargetRef.current = null;
		clearOptimisticSeek();
		seekDraggingRef.current = false;
		scrubTimeRef.current = null;
		setScrubTime(null);
		lastKnownPositionRef.current = (item?.playbackPositionTicks ?? 0) / 10_000_000;
		setIsBuffering(true);
		setPlaybackSession(null);
		setStreamToken(null);
		setCurrentTime(0);
		setDuration(getRuntimeSeconds(item) ?? 0);
		setIsPlaying(false);
		setQualityPickerOpen(false);
		setActiveSubtitle(null);
		setSubtitlePickerOpen(false);
		setSubtitleFilter("");
		setManualQualityIndex(null);
		setAutoplayMuted(false);
		setOnlineCues([]);
		setAutoplayCountdown(null);
		pendingUserSeekRef.current = null;
		qualityIndexRef.current = null;
		qualitySwitchInFlightRef.current = false;
		if (bufferingDowngradeTimerRef.current) clearTimeout(bufferingDowngradeTimerRef.current);
		if (stablePlaybackUpgradeTimerRef.current) clearTimeout(stablePlaybackUpgradeTimerRef.current);
		videoRef.current?.querySelector("track[data-online]")?.remove();

		if (!item?.streamUrl) return;

		let cancelled = false;
		const client = playbackClient;
		logPlayback("session:start", {
			streamUrl: item.streamUrl,
			client,
		});

		void Promise.all([
			beginPlaybackSessionRuntime({ data: { id: item.id, client } }),
			// Best effort: without a token the player still works in the
			// browser, it just can't hand the stream to a TV.
			createStreamTokenRuntime({ data: { id: item.id } }).catch(() => ({
				token: null as string | null,
			})),
		])
			.then(([session, minted]) => {
				if (cancelled) return;
				setStreamToken(minted.token);
				logPlayback("session:resolved", {
					sessionPlayMethod: session.playMethod,
					sessionStreamUrl: session.streamUrl,
					subtitleTrackCount: session.subtitleTracks.length,
				});
				// For transcoded streams, bake the resume position into StartTimeTicks
				// so that Jellyfin starts the transcode from the right point. This
				// avoids a seek-beyond-buffer that causes iOS to restart at 0:00.
				const resumeTicks = item!.playbackPositionTicks ?? 0;
				const isNativeHlsSession =
					session.playMethod === "Transcode" && isNativeHlsStreamUrl(session.streamUrl);
				if (resumeTicks > 0 && session.playMethod === "Transcode" && !isNativeHlsSession) {
					logPlayback("session:resume-from-ticks", {
						resumeTicks,
						resumeSeconds: resumeTicks / 10_000_000,
						sessionStreamUrl: session.streamUrl,
					});
					startTimeOffsetRef.current = 0;
					seekPendingRef.current = true;
					pendingSeekTargetRef.current = resumeTicks / 10_000_000;
					setPlaybackSession({
						...session,
						streamUrl: setStreamStartTicks(session.streamUrl, resumeTicks),
					});
				} else if (resumeTicks > 0 && isNativeHlsSession) {
					logPlayback("session:resume-via-element-seek", {
						resumeTicks,
						resumeSeconds: resumeTicks / 10_000_000,
						sessionStreamUrl: session.streamUrl,
					});
					setPlaybackSession(session);
				} else {
					logPlayback("session:start-from-zero", {
						sessionStreamUrl: session.streamUrl,
					});
					setPlaybackSession(session);
				}
			})
			.catch((error: unknown) => {
				logPlayback("session:error", {
					error: error instanceof Error ? error.message : String(error),
				});
				if (!cancelled)
					setPlaybackSession({
						streamUrl: item.streamUrl!,
						canSyncProgress: false,
						playMethod: "DirectPlay",
						subtitleTracks: [],
					});
			});

		return () => {
			cancelled = true;
			logPlayback("session:cleanup");
		};
	}, [debugPlayback, item]);

	// Reload video when stream URL changes
	useEffect(() => {
		if (!open || !streamUrl) return;
		ignoreVideoClickUntilRef.current = Date.now() + 750;
		qualityIndexRef.current =
			playbackSession?.playMethod === "Transcode" ? getTranscodeQualityIndex(streamUrl) : null;
		const video = videoRef.current;
		// `key={streamUrl}` gives every stream a fresh element, which never
		// fires `seeking` for seeks counted against the old one.
		internalSeekCountRef.current = 0;
		logPlayback("stream:load", {
			streamUrl,
			videoState: snapshotMediaState(video),
		});
		video?.load();

		return () => {
			if (!video) return;
			logPlayback("stream:teardown", {
				streamUrl,
				videoState: snapshotMediaState(video),
			});
			video.pause();
			video.removeAttribute("src");
			for (const track of Array.from(video.querySelectorAll("track"))) {
				track.removeAttribute("src");
			}
			video.load();
		};
	}, [open, playbackSession?.playMethod, streamUrl]);

	// Jellyfin progress sync
	useEffect(() => {
		const video = videoRef.current;
		if (!video || !open || !item?.streamUrl) return;
		const media = video;

		function secondsToTicks(s: number) {
			return Math.max(0, Math.floor(s * 10_000_000));
		}

		async function attemptAutoplay() {
			try {
				logPlayback("autoplay:attempt", {
					videoState: snapshotMediaState(media),
				});
				await media.play();
				logPlayback("autoplay:success", {
					videoState: snapshotMediaState(media),
				});
			} catch (error) {
				logPlayback("autoplay:failed", {
					error: error instanceof Error ? error.message : String(error),
					videoState: snapshotMediaState(media),
				});
				if (media.muted) return;
				media.muted = true;
				try {
					logPlayback("autoplay:retry-muted", {
						videoState: snapshotMediaState(media),
					});
					await media.play();
					logPlayback("autoplay:retry-muted-success", {
						videoState: snapshotMediaState(media),
					});
				} catch (mutedError) {
					logPlayback("autoplay:retry-muted-failed", {
						error: mutedError instanceof Error ? mutedError.message : String(mutedError),
						videoState: snapshotMediaState(media),
					});
					// Leave playback paused if the browser still rejects autoplay.
				}
			}
		}

		function buildPayload(overrides?: {
			isPaused?: boolean;
			isStopped?: boolean;
			played?: boolean;
		}) {
			return {
				id: item!.id,
				positionTicks: secondsToTicks(video!.currentTime + startTimeOffsetRef.current),
				playMethod: playbackSession?.playMethod,
				playSessionId: playbackSession?.playSessionId,
				mediaSourceId: playbackSession?.mediaSourceId,
				sessionId: playbackSession?.sessionId,
				...overrides,
			};
		}

		function syncProgress(overrides?: {
			isPaused?: boolean;
			isStopped?: boolean;
			played?: boolean;
			force?: boolean;
		}) {
			if (!item) return;
			// Movie time, and a distance rather than a difference: after seeking
			// back the position is behind the last report, and a plain
			// difference would hold reports back until playback caught up again.
			const currentSecond = Math.floor(video!.currentTime + startTimeOffsetRef.current);
			if (!overrides?.force && Math.abs(currentSecond - lastReportedSecondRef.current) < 8) return;
			lastReportedSecondRef.current = currentSecond;
			void reportPlaybackStateRuntime({ data: buildPayload(overrides) }).catch(() => undefined);
		}

		function handleLoadedMetadata() {
			logPlayback("media:loadedmetadata", {
				videoState: snapshotMediaState(video),
			});
			if (seekPendingRef.current && streamUrl && isNativeHlsStreamUrl(streamUrl)) {
				// An HLS reload (quality change) gets a playlist that covers the
				// whole film from 0:00 (see prepareSeekReloadUrl), so seek the
				// element itself; the bar stays pinned to the target until the
				// seek lands.
				const pendingTarget = pendingSeekTargetRef.current ?? 0;
				startTimeOffsetRef.current = 0;
				seekPendingRef.current = false;
				pendingSeekTargetRef.current = null;
				if (pendingTarget > 0) setVideoCurrentTime(pendingTarget);
				logPlayback("media:hls-reload-seek", {
					pendingTarget,
					videoState: snapshotMediaState(video),
				});
				void attemptAutoplay();
				return;
			}
			if (seekPendingRef.current) {
				const pendingTarget = pendingSeekTargetRef.current ?? startTimeOffsetRef.current;

				// Jellyfin transcode responses can report a tiny placeholder duration
				// during metadata load even when StartTimeTicks was honored. Trust the
				// requested offset for movie-time UI and progress reporting.
				const streamOffsetApplied = pendingTarget > 0;
				startTimeOffsetRef.current = streamOffsetApplied ? pendingTarget : 0;
				setCurrentTime((streamOffsetApplied ? pendingTarget : 0) + video!.currentTime);

				seekPendingRef.current = false;
				pendingSeekTargetRef.current = null;
				clearOptimisticSeek();
				logPlayback("media:resume-offset-applied", {
					pendingTarget,
					videoState: snapshotMediaState(video),
				});
				void attemptAutoplay();
				return;
			}
			if (item!.playbackPositionTicks) {
				logPlayback("media:seek-to-resume-position", {
					resumeSeconds: item!.playbackPositionTicks / 10_000_000,
					videoState: snapshotMediaState(video),
				});
				const resumeAt = item!.playbackPositionTicks / 10_000_000;
				beginOptimisticSeek(resumeAt);
				setVideoCurrentTime(resumeAt);
			}
			void attemptAutoplay();
		}
		function handleLoadedData() {
			logPlayback("media:loadeddata", {
				videoState: snapshotMediaState(video),
			});
			setIsBuffering(false);
		}
		function handleTimeUpdate() {
			if (!seekPendingRef.current) {
				lastKnownPositionRef.current = video!.currentTime + startTimeOffsetRef.current;
			}
			if (playbackSession?.canSyncProgress) syncProgress();
		}
		function handlePause() {
			syncProgress({ isPaused: true, force: true });
		}
		function handleEnded() {
			logPlayback("media:ended", {
				videoState: snapshotMediaState(video),
			});
			if (stopReportedRef.current) return;
			stopReportedRef.current = true;
			syncProgress({ isStopped: true, played: true, force: true });
		}
		function handleMediaEvent(eventName: string) {
			logPlayback(`media:${eventName}`, {
				videoState: snapshotMediaState(video),
			});
		}
		const handleCanPlay = () => handleMediaEvent("canplay");
		const handleStalled = () => handleMediaEvent("stalled");
		const handleSuspend = () => handleMediaEvent("suspend");
		const handleEmptied = () => handleMediaEvent("emptied");
		const handleAbort = () => handleMediaEvent("abort");
		const handleError = () => handleMediaEvent("error");
		video.addEventListener("loadedmetadata", handleLoadedMetadata);
		video.addEventListener("loadeddata", handleLoadedData);
		video.addEventListener("timeupdate", handleTimeUpdate);
		video.addEventListener("pause", handlePause);
		video.addEventListener("ended", handleEnded);
		video.addEventListener("canplay", handleCanPlay);
		video.addEventListener("stalled", handleStalled);
		video.addEventListener("suspend", handleSuspend);
		video.addEventListener("emptied", handleEmptied);
		video.addEventListener("abort", handleAbort);
		video.addEventListener("error", handleError);

		return () => {
			video.removeEventListener("loadedmetadata", handleLoadedMetadata);
			video.removeEventListener("loadeddata", handleLoadedData);
			video.removeEventListener("timeupdate", handleTimeUpdate);
			video.removeEventListener("pause", handlePause);
			video.removeEventListener("ended", handleEnded);
			video.removeEventListener("canplay", handleCanPlay);
			video.removeEventListener("stalled", handleStalled);
			video.removeEventListener("suspend", handleSuspend);
			video.removeEventListener("emptied", handleEmptied);
			video.removeEventListener("abort", handleAbort);
			video.removeEventListener("error", handleError);

			// Every stream ends its own Jellyfin play session, so a seek reload or
			// quality change stops the old transcode. This must not mark the item
			// as stopped for good: the new stream reports progress, its end
			// marks the item played, and closing the player stops it again.
			// The Chrome pre-session stream (playbackSession null) has no
			// session to stop.
			if (stopReportedRef.current || !playbackSession) return;
			// Read from refs: the stream-load cleanup above has already reset
			// the element, so video.currentTime is 0 by now.
			const position = pendingSeekTargetRef.current ?? lastKnownPositionRef.current;
			const length =
				getRuntimeSeconds(item) ??
				resolveDuration({
					isTranscode: playbackSession.playMethod === "Transcode",
					videoDuration: video.duration,
					offset: startTimeOffsetRef.current,
					runtimeSeconds: undefined,
				});
			// Only the final stop may mark the item played; a reload stop that
			// happens near the end (a seek to the credits) must not.
			const isFinalStop =
				unmountingRef.current || !openRef.current || activeItemIdRef.current !== item?.id;
			const played = isFinalStop && watchedRatio(position, length) >= 0.94 ? true : undefined;
			void reportPlaybackStateRuntime({
				data: {
					...buildPayload({ isStopped: true, played }),
					positionTicks: secondsToTicks(position),
				},
			}).catch(() => undefined);
		};
	}, [debugPlayback, item, open, playbackSession, streamUrl]);

	// Player UI state tracking
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;

		function clearAdaptiveTimers() {
			if (bufferingDowngradeTimerRef.current) {
				clearTimeout(bufferingDowngradeTimerRef.current);
				bufferingDowngradeTimerRef.current = null;
			}
			if (stablePlaybackUpgradeTimerRef.current) {
				clearTimeout(stablePlaybackUpgradeTimerRef.current);
				stablePlaybackUpgradeTimerRef.current = null;
			}
		}

		function reloadAtCurrentTimeWithQuality(index: number) {
			if (!playbackSession || qualitySwitchInFlightRef.current) return;
			const media = videoRef.current;
			if (!media) return;
			const currentMovieTime = media.currentTime + startTimeOffsetRef.current;
			qualityIndexRef.current = index;
			qualitySwitchInFlightRef.current = true;
			pendingSeekTargetRef.current = currentMovieTime;
			beginOptimisticSeek(currentMovieTime);
			seekPendingRef.current = true;
			setIsBuffering(true);
			void reloadStreamAtMovieTime(currentMovieTime, {
				qualityProfile: TRANSCODE_QUALITY_LADDER[index],
			});
		}

		function scheduleAdaptiveUpgrade() {
			if (!canAutoAdjustQuality) return;
			if (manualQualityIndex != null) return;
			if (seekPendingRef.current || qualitySwitchInFlightRef.current) return;
			const currentIndex = qualityIndexRef.current;
			if (currentIndex == null || currentIndex >= TRANSCODE_QUALITY_LADDER.length - 1) return;

			if (stablePlaybackUpgradeTimerRef.current)
				clearTimeout(stablePlaybackUpgradeTimerRef.current);
			stablePlaybackUpgradeTimerRef.current = setTimeout(() => {
				reloadAtCurrentTimeWithQuality(currentIndex + 1);
			}, STABLE_PLAYBACK_UPGRADE_DELAY_MS);
		}

		function scheduleAdaptiveDowngrade() {
			if (!canAutoAdjustQuality) return;
			if (manualQualityIndex != null) return;
			const media = videoRef.current;
			if (!media) return;
			if (media.paused || seekPendingRef.current || qualitySwitchInFlightRef.current) return;

			const fallbackIndex = TRANSCODE_QUALITY_LADDER.length - 1;
			const currentIndex = qualityIndexRef.current ?? fallbackIndex;
			if (currentIndex <= 0) return;

			if (bufferingDowngradeTimerRef.current) return;
			bufferingDowngradeTimerRef.current = setTimeout(() => {
				bufferingDowngradeTimerRef.current = null;
				reloadAtCurrentTimeWithQuality(currentIndex - 1);
			}, BUFFER_DOWNGRADE_DELAY_MS);
		}

		const onTimeUpdate = () => {
			const nextTime = video.currentTime + startTimeOffsetRef.current;
			const optimisticTarget = optimisticSeekTargetRef.current;
			if (optimisticTarget != null) {
				// Both directions: a backward seek must not be pulled forward by
				// the old position any more than a forward seek pulled back.
				if (Math.abs(nextTime - optimisticTarget) > SEEK_LANDING_TOLERANCE_S) return;
				clearOptimisticSeek();
			}
			setCurrentTime(nextTime);
		};
		const onSeeked = () => {
			// The element is where it settled (HLS lands on a segment boundary,
			// not always exactly on the target). A stream that is still being
			// replaced keeps the bar pinned until the new one has loaded.
			if (seekPendingRef.current || optimisticSeekTargetRef.current == null) return;
			clearOptimisticSeek();
			setCurrentTime(video.currentTime + startTimeOffsetRef.current);
		};
		const onSeeking = () => {
			if (internalSeekCountRef.current > 0) {
				internalSeekCountRef.current -= 1;
				return;
			}
			if (seekPendingRef.current) return;
			if (playbackSession?.playMethod !== "Transcode") return;
			if (isNativeHlsPlayback) {
				pendingUserSeekRef.current = null;
				return;
			}
			const pendingUserSeek = pendingUserSeekRef.current;
			if (pendingUserSeek == null) {
				return;
			}
			pendingUserSeekRef.current = null;
			seekToMovieTime(pendingUserSeek);
		};
		const onDurationChange = () => {
			// Transcodes report a duration that is Infinity (Safari HLS), only the
			// part after StartTimeTicks, or still growing while it downloads, and
			// durationchange fires before loadedmetadata has updated the offset.
			// resolveDuration keeps Jellyfin's exact runtime for those.
			const next = resolveDuration({
				isTranscode: playbackSession?.playMethod === "Transcode",
				videoDuration: video.duration,
				offset: startTimeOffsetRef.current,
				runtimeSeconds: getRuntimeSeconds(item),
			});
			if (next > 0) setDuration(next);
		};
		const onPlay = () => {
			setIsPlaying(true);
			if (video.muted) setAutoplayMuted(true);
		};
		const onPause = () => setIsPlaying(false);
		const onVolumeChange = () => {
			setIsMuted(video.muted);
			if (!video.muted) setAutoplayMuted(false);
		};
		const onWaiting = () => {
			setIsBuffering(true);
			if (stablePlaybackUpgradeTimerRef.current) {
				clearTimeout(stablePlaybackUpgradeTimerRef.current);
				stablePlaybackUpgradeTimerRef.current = null;
			}
			scheduleAdaptiveDowngrade();
		};
		const onPlaying = () => {
			setIsBuffering(false);
			if (bufferingDowngradeTimerRef.current) {
				clearTimeout(bufferingDowngradeTimerRef.current);
				bufferingDowngradeTimerRef.current = null;
			}
			if (qualitySwitchInFlightRef.current) {
				qualitySwitchInFlightRef.current = false;
			}
			scheduleAdaptiveUpgrade();
		};

		video.addEventListener("timeupdate", onTimeUpdate);
		video.addEventListener("seeking", onSeeking);
		video.addEventListener("seeked", onSeeked);
		video.addEventListener("durationchange", onDurationChange);
		video.addEventListener("play", onPlay);
		video.addEventListener("pause", onPause);
		video.addEventListener("volumechange", onVolumeChange);
		video.addEventListener("waiting", onWaiting);
		video.addEventListener("playing", onPlaying);

		return () => {
			clearAdaptiveTimers();
			video.removeEventListener("timeupdate", onTimeUpdate);
			video.removeEventListener("seeking", onSeeking);
			video.removeEventListener("seeked", onSeeked);
			video.removeEventListener("durationchange", onDurationChange);
			video.removeEventListener("play", onPlay);
			video.removeEventListener("pause", onPause);
			video.removeEventListener("volumechange", onVolumeChange);
			video.removeEventListener("waiting", onWaiting);
			video.removeEventListener("playing", onPlaying);
		};
	}, [
		canAutoAdjustQuality,
		isNativeHlsPlayback,
		item,
		manualQualityIndex,
		open,
		playbackSession?.playMethod,
		streamUrl,
	]);

	// RAF-based subtitle sync: reads video.currentTime at 60fps and updates the DOM directly,
	// bypassing React renders for tight timing (timeupdate only fires ~4x/sec).
	useEffect(() => {
		const video = videoRef.current;
		const div = subtitleDivRef.current;
		if (!video || !div) return;
		let rafId: number;
		let lastCueText: string | null = null;
		const tick = () => {
			rafId = requestAnimationFrame(tick);
			const t = video.currentTime + startTimeOffsetRef.current + subtitleOffsetRef.current;
			const cue = onlineCuesRef.current.find((c) => t >= c.start && t <= c.end) ?? null;
			const text = cue?.text ?? null;
			if (text !== lastCueText) {
				lastCueText = text;
				div.textContent = "";
				if (text) {
					for (const line of text.split("\n")) {
						const span = document.createElement("span");
						span.textContent = line;
						div.appendChild(span);
					}
					div.style.display = "";
				} else {
					div.style.display = "none";
				}
			}
		};
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	}, [open, streamUrl]);

	// Fullscreen tracking
	useEffect(() => {
		const onChange = () => setIsFullscreen(!!document.fullscreenElement);
		document.addEventListener("fullscreenchange", onChange);
		return () => document.removeEventListener("fullscreenchange", onChange);
	}, []);

	// Auto-play next episode: start countdown when video ends and a next item exists
	useEffect(() => {
		const video = videoRef.current;
		if (!video || !open) return;

		function handleEnded() {
			if (nextItem) setAutoplayCountdown(10);
		}

		video.addEventListener("ended", handleEnded);
		return () => video.removeEventListener("ended", handleEnded);
	}, [open, nextItem?.id, streamUrl]);

	// Tick the autoplay countdown down; fire when it reaches 0
	useEffect(() => {
		if (autoplayCountdown === null) {
			if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
			return;
		}
		if (autoplayCountdown === 0) {
			if (nextItem) onSelectQueueItem?.(nextItem);
			setAutoplayCountdown(null);
			return;
		}
		countdownTimerRef.current = setInterval(() => {
			setAutoplayCountdown((c) => (c !== null ? c - 1 : null));
		}, 1000);
		return () => {
			if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
		};
	}, [autoplayCountdown]);

	// Auto-hide controls — pinned while a picker is open, otherwise a long
	// subtitle list fades to opacity 0 mid-scroll.
	useEffect(() => {
		if (!isPlaying || subtitlePickerOpen || qualityPickerOpen) {
			setControlsVisible(true);
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
			return;
		}
		scheduleControlsHide();
		return () => {
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		};
	}, [isPlaying, subtitlePickerOpen, qualityPickerOpen]);

	// Reopening a long list should land on the current selection, not the top.
	useEffect(() => {
		if (!subtitlePickerOpen) return;
		subtitleListRef.current
			?.querySelector(".player-subtitle-option.active")
			?.scrollIntoView({ block: "nearest" });
	}, [subtitlePickerOpen]);

	// Keyboard shortcuts and the TV remote
	useEffect(() => {
		if (!open) return;
		function handleKeydown(e: KeyboardEvent) {
			// Escape first: it has to work from inside the filter field, and it
			// must not be gated on the <video> element existing.
			if (e.key === "Escape") {
				if (subtitlePickerOpen || qualityPickerOpen) {
					e.preventDefault();
					closePickers();
					return;
				}
				onClose();
				return;
			}

			const video = videoRef.current;
			if (!video) return;

			// Remote and keyboard media keys, whatever has focus.
			const mediaKeyHandled = handleMediaKey(e.key, video);
			if (mediaKeyHandled) {
				e.preventDefault();
				revealControls();
				return;
			}

			if (isEditableTarget(e.target)) return;

			const controlsWereVisible = controlsVisibleRef.current;
			// Any key brings the controls back, so a remote user sees what
			// they are doing; the hide timer restarts with every press.
			revealControls();

			if (
				document.documentElement.classList.contains("tv-mode") &&
				handleRemoteKey(e, controlsWereVisible)
			) {
				return;
			}

			if (e.key === " " || e.key === "k") {
				e.preventDefault();
				video.paused ? void video.play() : video.pause();
			} else if (e.key === "ArrowLeft") {
				seekToMovieTime(currentTime - 15);
			} else if (e.key === "ArrowRight") {
				seekToMovieTime(currentTime + 30);
			} else if (e.key === "f") {
				void toggleFullscreen();
			} else if (e.key === "m") {
				video.muted = !video.muted;
			} else if (e.key === "z") {
				subtitleOffsetRef.current = Math.round((subtitleOffsetRef.current - 0.1) * 10) / 10;
			} else if (e.key === "x") {
				subtitleOffsetRef.current = Math.round((subtitleOffsetRef.current + 0.1) * 10) / 10;
			}
		}
		window.addEventListener("keydown", handleKeydown);
		return () => window.removeEventListener("keydown", handleKeydown);
	}, [
		currentTime,
		isPlaying,
		nextItem,
		open,
		onClose,
		onSelectQueueItem,
		subtitlePickerOpen,
		qualityPickerOpen,
	]);

	// The Android back button closes an open picker before the player itself.
	useEffect(() => {
		if (!open) return;
		function handleBack(event: Event) {
			if (!subtitlePickerOpen && !qualityPickerOpen) return;
			event.preventDefault();
			closePickers();
		}
		window.addEventListener(AURORA_BACK_EVENT, handleBack);
		return () => window.removeEventListener(AURORA_BACK_EVENT, handleBack);
	}, [open, subtitlePickerOpen, qualityPickerOpen]);

	// Media Session: the OS media controls (macOS Now Playing, media keys,
	// Bluetooth headsets, the Android TV system remote) drive the player.
	useEffect(() => {
		if (!open || !item || typeof navigator === "undefined" || !("mediaSession" in navigator)) {
			return;
		}
		const session = navigator.mediaSession;
		const artwork = item.backdropUrl ?? item.posterUrl;
		try {
			if (typeof MediaMetadata !== "undefined") {
				session.metadata = new MediaMetadata({
					title: item.title,
					artist: item.seriesTitle ?? "",
					artwork: artwork ? [{ src: new URL(artwork, window.location.href).href }] : [],
				});
			}
		} catch {
			// Metadata is cosmetic; the action handlers still work without it.
		}

		const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
			["play", () => void videoRef.current?.play()],
			["pause", () => videoRef.current?.pause()],
			["seekbackward", (details) => mediaControlsRef.current.seekBy(-(details.seekOffset ?? 15))],
			["seekforward", (details) => mediaControlsRef.current.seekBy(details.seekOffset ?? 30)],
			[
				"seekto",
				(details) => {
					if (details.seekTime != null) mediaControlsRef.current.seekTo(details.seekTime);
				},
			],
			["nexttrack", nextItem ? () => onSelectQueueItem?.(nextItem) : null],
		];
		for (const [action, handler] of handlers) {
			try {
				session.setActionHandler(action, handler);
			} catch {
				// Not every browser supports every action.
			}
		}
		return () => {
			for (const [action] of handlers) {
				try {
					session.setActionHandler(action, null);
				} catch {
					// See above.
				}
			}
			session.metadata = null;
		};
	}, [open, item, nextItem, onSelectQueueItem]);

	useEffect(() => {
		if (!open || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
		if (!(duration > 0) || !Number.isFinite(duration)) return;
		try {
			navigator.mediaSession.setPositionState({
				duration,
				position: Math.max(0, Math.min(duration, currentTime)),
				playbackRate: 1,
			});
		} catch {
			// Older implementations reject position state; it's optional.
		}
	}, [open, currentTime, duration]);

	/** Play/pause/seek keys from a remote or keyboard. Returns whether it acted. */
	function handleMediaKey(key: string, video: HTMLVideoElement) {
		switch (key) {
			case "MediaPlayPause":
				video.paused ? void video.play() : video.pause();
				return true;
			case "MediaPlay":
				void video.play();
				return true;
			case "MediaPause":
				video.pause();
				return true;
			case "MediaFastForward":
				seekToMovieTime(currentTime + 30, { resumeIfPlaying: !video.paused });
				return true;
			case "MediaRewind":
				seekToMovieTime(currentTime - 15, { resumeIfPlaying: !video.paused });
				return true;
			case "MediaTrackNext":
				if (!nextItem) return false;
				onSelectQueueItem?.(nextItem);
				return true;
			case "MediaStop":
				onClose();
				return true;
			default:
				return false;
		}
	}

	/**
	 * The D-pad in TV mode. With the controls hidden, Left/Right seek and any
	 * other press brings up the controls with Play focused. With the controls
	 * showing, the arrows move between them and OK presses the focused one
	 * (the browser does that part). The seek bar handles Left/Right itself.
	 */
	function handleRemoteKey(e: KeyboardEvent, controlsWereVisible: boolean) {
		const direction =
			e.key === "ArrowLeft"
				? "left"
				: e.key === "ArrowRight"
					? "right"
					: e.key === "ArrowUp"
						? "up"
						: e.key === "ArrowDown"
							? "down"
							: null;
		const container = containerRef.current;
		const active = document.activeElement;
		const focusInControls =
			container != null &&
			active instanceof HTMLElement &&
			active !== container &&
			container.contains(active);

		if (!controlsWereVisible || !focusInControls) {
			if (e.key === "Enter" || direction === "up" || direction === "down") {
				e.preventDefault();
				playButtonRef.current?.focus({ preventScroll: true });
				return true;
			}
			if (direction === "left" || direction === "right") {
				e.preventDefault();
				seekToMovieTime(currentTime + (direction === "left" ? -15 : 30), {
					resumeIfPlaying: !videoRef.current?.paused,
				});
				return true;
			}
			return false;
		}

		if (direction) {
			e.preventDefault();
			moveTvFocus(direction, container);
			return true;
		}
		return false;
	}

	function closePickers() {
		setSubtitlePickerOpen(false);
		setQualityPickerOpen(false);
		setSubtitleFilter("");
	}

	function scheduleControlsHide() {
		if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		hideTimerRef.current = setTimeout(() => {
			// Never fade the bar out from under a drag; the drag's end
			// schedules the hide again.
			if (!seekDraggingRef.current) setControlsVisible(false);
		}, CONTROLS_HIDE_DELAY_MS);
	}

	function revealControls() {
		setControlsVisible(true);
		if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		if (isPlaying && !subtitlePickerOpen && !qualityPickerOpen) scheduleControlsHide();
	}

	function togglePlay() {
		const video = videoRef.current;
		if (!video) return;
		video.paused ? void video.play() : video.pause();
	}

	function handleVideoClick() {
		if (Date.now() < ignoreVideoClickUntilRef.current) return;
		if (subtitlePickerOpen || qualityPickerOpen) {
			closePickers();
			return;
		}
		togglePlay();
	}

	function resumePlaybackAfterSeek() {
		const video = videoRef.current;
		if (!video) return;

		requestAnimationFrame(() => {
			void video.play().catch(() => undefined);
		});
	}

	async function reloadStreamAtMovieTime(
		targetMovieTime: number,
		options?: { qualityProfile?: TranscodeQualityProfile },
	) {
		if (!item) return;

		const requestId = ++seekReloadRequestIdRef.current;
		const client = getClientPlaybackContext();
		const qualityProfile =
			options?.qualityProfile ??
			(qualityIndexRef.current != null
				? TRANSCODE_QUALITY_LADDER[qualityIndexRef.current]
				: undefined);
		logPlayback("stream:reload-requested", {
			targetMovieTime,
			qualityProfile,
			currentStreamUrl: playbackSession?.streamUrl,
			videoState: snapshotMediaState(videoRef.current),
		});

		try {
			const freshSession = await beginPlaybackSessionRuntime({ data: { id: item.id, client } });
			if (seekReloadRequestIdRef.current !== requestId) return;

			const nextStreamUrl = prepareSeekReloadUrl(
				setTranscodeQuality(freshSession.streamUrl, qualityProfile),
				Math.floor(targetMovieTime * 10_000_000),
			);
			logPlayback("stream:reload-fresh-session", {
				nextStreamUrl,
				freshPlayMethod: freshSession.playMethod,
			});
			setPlaybackSession({ ...freshSession, streamUrl: nextStreamUrl });
		} catch (error) {
			logPlayback("stream:reload-fallback", {
				error: error instanceof Error ? error.message : String(error),
			});
			if (seekReloadRequestIdRef.current !== requestId || !playbackSession) return;

			const nextStreamUrl = prepareSeekReloadUrl(
				setTranscodeQuality(playbackSession.streamUrl, qualityProfile),
				Math.floor(targetMovieTime * 10_000_000),
			);
			logPlayback("stream:reload-existing-session", {
				nextStreamUrl,
			});
			setPlaybackSession({ ...playbackSession, streamUrl: nextStreamUrl });
		}
	}

	function setVideoCurrentTime(nextTime: number) {
		const video = videoRef.current;
		if (!video) return;
		// Without metadata the assignment only sets the start position and no
		// `seeking` event follows to consume the count.
		if (video.readyState >= HTMLMediaElement.HAVE_METADATA) internalSeekCountRef.current += 1;
		video.currentTime = nextTime;
	}

	function clearOptimisticSeek() {
		optimisticSeekTargetRef.current = null;
		if (optimisticSeekTimerRef.current) {
			clearTimeout(optimisticSeekTimerRef.current);
			optimisticSeekTimerRef.current = null;
		}
	}

	/** Moves the bar to `target` now, ahead of the video catching up. */
	function beginOptimisticSeek(target: number) {
		clearOptimisticSeek();
		optimisticSeekTargetRef.current = target;
		setCurrentTime(target);
		optimisticSeekTimerRef.current = setTimeout(() => {
			optimisticSeekTimerRef.current = null;
			// A reload that is still loading keeps the target; loadedmetadata
			// clears it.
			if (seekPendingRef.current) return;
			optimisticSeekTargetRef.current = null;
			const video = videoRef.current;
			if (video) setCurrentTime(video.currentTime + startTimeOffsetRef.current);
		}, SEEK_LANDING_TIMEOUT_MS);
	}

	function toggleMute() {
		const video = videoRef.current;
		if (video) video.muted = !video.muted;
	}

	async function toggleFullscreen() {
		if (document.fullscreenElement) {
			await document.exitFullscreen();
		} else {
			await containerRef.current?.requestFullscreen();
		}
	}

	async function selectOnlineSubtitle(fileId: number) {
		setLoadingOnlineSubtitle(true);
		setOnlineSubtitleError(false);
		setQualityPickerOpen(false);
		try {
			const { content } = await fetchOnlineSubtitleRuntime({ data: { fileId } });
			subtitleOffsetRef.current = 0;
			setOnlineCues(parseVtt(content));
			setActiveSubtitle(null);
			closePickers();
		} catch {
			setOnlineSubtitleError(true);
		} finally {
			setLoadingOnlineSubtitle(false);
		}
	}

	function selectSubtitle(index: number | null) {
		setOnlineCues([]);
		const video = videoRef.current;
		if (video) {
			for (const track of Array.from(video.textTracks)) track.mode = "disabled";
			if (index !== null && video.textTracks[index]) video.textTracks[index].mode = "showing";
		}
		setActiveSubtitle(index);
		closePickers();
	}

	function selectQuality(index: number | null) {
		setQualityPickerOpen(false);
		// Same reason as canAutoAdjustQuality: switching would end the cast.
		if (remoteActiveRef.current) return;
		if (bufferingDowngradeTimerRef.current) {
			clearTimeout(bufferingDowngradeTimerRef.current);
			bufferingDowngradeTimerRef.current = null;
		}
		if (stablePlaybackUpgradeTimerRef.current) {
			clearTimeout(stablePlaybackUpgradeTimerRef.current);
			stablePlaybackUpgradeTimerRef.current = null;
		}

		if (index == null) {
			setManualQualityIndex(null);
			return;
		}

		setManualQualityIndex(index);
		if (!playbackSession || qualitySwitchInFlightRef.current) return;
		if (qualityIndexRef.current === index) return;

		const media = videoRef.current;
		if (!media) return;

		const currentMovieTime = media.currentTime + startTimeOffsetRef.current;
		qualityIndexRef.current = index;
		qualitySwitchInFlightRef.current = true;
		pendingSeekTargetRef.current = currentMovieTime;
		beginOptimisticSeek(currentMovieTime);
		seekPendingRef.current = true;
		setIsBuffering(true);
		void reloadStreamAtMovieTime(currentMovieTime, {
			qualityProfile: TRANSCODE_QUALITY_LADDER[index],
		});
	}

	// Returns the best available duration: React state first, then the runtime
	// or video element, then null
	function getBestDuration(): number | null {
		if (duration > 0) return duration;
		const d = resolveDuration({
			isTranscode: playbackSession?.playMethod === "Transcode",
			videoDuration: videoRef.current?.duration,
			offset: startTimeOffsetRef.current,
			runtimeSeconds,
		});
		return d > 0 ? d : null;
	}

	// Seeks to an absolute movie-time position (seconds). For transcode streams,
	// if the target is not within the buffered range we rebuild the URL with
	// StartTimeTicks so Jellyfin starts the transcode from the right point,
	// preventing iOS from restarting playback at 0:00.
	function seekToMovieTime(targetMovieTime: number, options?: { resumeIfPlaying?: boolean }) {
		const video = videoRef.current;
		if (!video) return;
		logPlayback("seek:requested", {
			targetMovieTime,
			resumeIfPlaying: options?.resumeIfPlaying ?? false,
			videoState: snapshotMediaState(video),
		});
		const d = getBestDuration();
		const clamped =
			d != null ? Math.max(0, Math.min(d, targetMovieTime)) : Math.max(0, targetMovieTime);

		if (isNativeHlsPlayback) {
			// Safari reports the new position only once Jellyfin has the
			// segment ready, which can take seconds; show the target meanwhile.
			beginOptimisticSeek(clamped);
			setVideoCurrentTime(clamped);
			pendingUserSeekRef.current = null;
			if (options?.resumeIfPlaying) resumePlaybackAfterSeek();
			return;
		}

		pendingUserSeekRef.current = clamped;

		if (playbackSession?.playMethod === "Transcode") {
			const streamTime = clamped - startTimeOffsetRef.current;
			// Check whether streamTime falls within an already-downloaded range.
			// Both bounds must be checked: only checking the end can pass for gaps
			// between ranges or for positions before the first buffered range.
			const buffered = isTimeBuffered(video.buffered, streamTime);
			if ((!buffered || streamTime < 0) && remoteActiveRef.current) {
				// Reloading the stream would remount the <video> and drop the
				// receiver. Clamp into the range being played instead, so the
				// seek goes as far as it can in the direction asked for rather
				// than silently ending playback on the TV.
				const playing = findBufferedRangeAt(video, video.currentTime);
				const fallback = playing
					? Math.max(playing.start, Math.min(playing.end, streamTime))
					: video.currentTime;
				setVideoCurrentTime(fallback);
				setCurrentTime(fallback + startTimeOffsetRef.current);
				pendingUserSeekRef.current = null;
				if (options?.resumeIfPlaying) resumePlaybackAfterSeek();
				return;
			}
			if (!buffered || streamTime < 0) {
				// A reload that is already in flight is retargeted rather than
				// ignored: reloadStreamAtMovieTime only applies the latest
				// request, and the bar already shows this target.
				pendingUserSeekRef.current = null;
				pendingSeekTargetRef.current = clamped;
				beginOptimisticSeek(clamped);
				seekPendingRef.current = true;
				setIsBuffering(true);
				void reloadStreamAtMovieTime(clamped);
				return;
			}
			beginOptimisticSeek(clamped);
			setVideoCurrentTime(streamTime);
			pendingUserSeekRef.current = null;
			if (options?.resumeIfPlaying) resumePlaybackAfterSeek();
		} else {
			beginOptimisticSeek(clamped);
			setVideoCurrentTime(clamped);
			pendingUserSeekRef.current = null;
			if (options?.resumeIfPlaying) resumePlaybackAfterSeek();
		}
	}

	function updateScrub(clientX: number, rect: DOMRect) {
		const d = getBestDuration();
		if (d == null) return;
		const target = ratioFromPointer(clientX, rect) * d;
		scrubTimeRef.current = target;
		setScrubTime(target);

		// Show the frame under the pointer when that is cheap: only for
		// content that is already downloaded, never on HLS (every seek there
		// is a segment request), and at most every few hundred ms. The real
		// seek happens once, on release.
		if (isNativeHlsPlayback) return;
		const video = videoRef.current;
		const now = Date.now();
		if (!video || now - lastScrubSeekAtRef.current < SCRUB_LIVE_SEEK_INTERVAL_MS) return;
		const streamTime = target - startTimeOffsetRef.current;
		if (!isTimeBuffered(video.buffered, streamTime)) return;
		lastScrubSeekAtRef.current = now;
		setVideoCurrentTime(streamTime);
	}

	function endScrub(element: HTMLElement, pointerId: number, commit: boolean) {
		if (!seekDraggingRef.current) return;
		seekDraggingRef.current = false;
		if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
		const target = scrubTimeRef.current;
		scrubTimeRef.current = null;
		setScrubTime(null);
		// Commit the final seek position — may trigger a URL reload if not buffered.
		if (commit && target != null) {
			seekToMovieTime(target, { resumeIfPlaying: !videoRef.current?.paused });
		}
		revealControls();
	}

	function handleProgressPointerDown(e: React.PointerEvent<HTMLDivElement>) {
		if (e.pointerType === "mouse" && e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		e.currentTarget.setPointerCapture(e.pointerId);
		seekDraggingRef.current = true;
		lastScrubSeekAtRef.current = 0;
		revealControls();
		updateScrub(e.clientX, e.currentTarget.getBoundingClientRect());
	}

	function handleProgressPointerMove(e: React.PointerEvent<HTMLDivElement>) {
		if (!seekDraggingRef.current) return;
		e.preventDefault();
		e.stopPropagation();
		// The button was released somewhere we never heard about (outside the
		// window, during a system gesture): finish the drag where it was.
		if (e.pointerType === "mouse" && e.buttons === 0) {
			endScrub(e.currentTarget, e.pointerId, true);
			return;
		}
		updateScrub(e.clientX, e.currentTarget.getBoundingClientRect());
	}

	function handleProgressPointerUp(e: React.PointerEvent<HTMLDivElement>) {
		// Only a drag that started on the bar ends on it; a press elsewhere
		// released over the bar is not a seek.
		if (!seekDraggingRef.current) return;
		e.preventDefault();
		e.stopPropagation();
		endScrub(e.currentTarget, e.pointerId, true);
	}

	function handleProgressPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
		// The browser took the pointer away (scroll gesture, fullscreen change,
		// alert): drop the drag instead of seeking somewhere unintended.
		endScrub(e.currentTarget, e.pointerId, false);
	}

	function handleProgressKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
		const d = getBestDuration();
		let target: number | null = null;
		// On a TV, Up/Down leave the bar for the buttons around it.
		const verticalSeeks = !document.documentElement.classList.contains("tv-mode");
		if (e.key === "ArrowLeft" || (verticalSeeks && e.key === "ArrowDown"))
			target = currentTime - KEYBOARD_SEEK_STEP_S;
		else if (e.key === "ArrowRight" || (verticalSeeks && e.key === "ArrowUp"))
			target = currentTime + KEYBOARD_SEEK_STEP_S;
		else if (e.key === "PageDown") target = currentTime - 60;
		else if (e.key === "PageUp") target = currentTime + 60;
		else if (e.key === "Home") target = 0;
		else if (e.key === "End" && d != null) target = d;
		if (target == null) return;
		// Keep the window-level shortcuts (±15/30 s) from seeking as well.
		e.preventDefault();
		e.stopPropagation();
		revealControls();
		seekToMovieTime(target, { resumeIfPlaying: !videoRef.current?.paused });
	}

	function seekBack() {
		seekToMovieTime(currentTime - 15, { resumeIfPlaying: !videoRef.current?.paused });
	}

	function seekForward() {
		seekToMovieTime(currentTime + 30, { resumeIfPlaying: !videoRef.current?.paused });
	}

	mediaControlsRef.current = {
		seekBy: (delta) =>
			seekToMovieTime(currentTime + delta, { resumeIfPlaying: !videoRef.current?.paused }),
		seekTo: (time) => seekToMovieTime(time, { resumeIfPlaying: !videoRef.current?.paused }),
	};

	if (!open || !item) return null;

	return (
		<div
			ref={containerRef}
			className={`player-fullscreen${controlsVisible ? " controls-visible" : ""}`}
			onMouseMove={revealControls}
			onTouchStart={revealControls}
			role="dialog"
			aria-modal="true"
			aria-label={item.title}
			// The remote's arrows seek and move between the player's own
			// controls (handleRemoteKey), not the page-wide TV navigation.
			data-tv-arrows="manual"
		>
			{streamUrl ? (
				<>
					{(item.backdropUrl ?? item.posterUrl) ? (
						<div
							className={`player-poster-layer${isBuffering || remote.active ? " visible" : ""}`}
							aria-hidden={!(isBuffering || remote.active)}
						>
							<img
								src={item.backdropUrl ?? item.posterUrl}
								alt=""
								className="player-poster-image"
							/>
						</div>
					) : null}
					<video
						key={streamUrl}
						ref={videoRef}
						className="player-fullscreen-video"
						autoPlay
						playsInline
						preload="metadata"
						src={streamUrl}
						onClick={handleVideoClick}
					>
						{(playbackSession?.subtitleTracks ?? []).map((track) => (
							<track
								key={track.index}
								kind="subtitles"
								src={track.url}
								srcLang={track.language}
								label={track.label}
							/>
						))}
					</video>

					{/* The local element never leaves `waiting` once a receiver has
					    the stream, so the spinner would run forever. */}
					{isBuffering && !remote.active ? (
						<div className="player-buffering-overlay" aria-hidden="true">
							<div className="player-buffering-spinner" />
						</div>
					) : null}

					<div
						ref={subtitleDivRef}
						className={`player-subtitle-cue${controlsVisible ? " player-subtitle-cue-raised" : ""}`}
					/>

					{autoplayMuted ? (
						<button
							type="button"
							className="player-unmute-prompt"
							onClick={() => {
								const video = videoRef.current;
								if (video) video.muted = false;
							}}
						>
							<VolumeX size={20} />
							<span>{t("player.tapToUnmute")}</span>
						</button>
					) : null}

					{autoplayCountdown !== null && nextItem ? (
						<div className="player-autoplay-banner">
							<div className="player-autoplay-thumb">
								{(nextItem.backdropUrl ?? nextItem.posterUrl) ? (
									<img src={nextItem.backdropUrl ?? nextItem.posterUrl} alt={nextItem.title} />
								) : null}
							</div>
							<div className="player-autoplay-copy">
								<span className="eyebrow">{t("player.upNext")}</span>
								<strong>{nextItem.title}</strong>
								{nextItem.seriesTitle ? (
									<span>
										{nextItem.seriesTitle}
										{nextItem.episodeNumber ? ` · E${nextItem.episodeNumber}` : ""}
									</span>
								) : null}
								<p className="player-autoplay-countdown">
									{t("player.autoplayCountdown", { count: autoplayCountdown })}
								</p>
							</div>
							<button
								type="button"
								className="secondary-action player-autoplay-cancel"
								onClick={() => setAutoplayCountdown(null)}
							>
								{t("player.autoplayCancel")}
							</button>
						</div>
					) : null}

					<div className={`player-controls-overlay${controlsVisible ? " visible" : ""}`}>
						<div className="player-controls-top">
							<div className="player-controls-title">
								<p className="eyebrow">{t("player.nowPlaying")}</p>
								<h2>{item.title}</h2>
								{item.type === "episode" && item.seriesTitle ? (
									<span>
										{item.seriesTitle}
										{item.episodeNumber ? ` · E${item.episodeNumber}` : ""}
									</span>
								) : null}
							</div>
							<button
								type="button"
								className="icon-button"
								onClick={onClose}
								data-aurora-overlay-close
								aria-label={t("player.close")}
							>
								<X size={20} />
							</button>
						</div>

						<div className="player-controls-bottom">
							<div
								className={`player-progress${scrubTime != null ? " scrubbing" : ""}`}
								onPointerDown={handleProgressPointerDown}
								onPointerMove={handleProgressPointerMove}
								onPointerUp={handleProgressPointerUp}
								onPointerCancel={handleProgressPointerCancel}
								onLostPointerCapture={handleProgressPointerCancel}
								onKeyDown={handleProgressKeyDown}
								role="slider"
								tabIndex={0}
								aria-label={t("player.seek")}
								aria-valuenow={Math.floor(displayTime)}
								aria-valuemin={0}
								aria-valuemax={Math.floor(getBestDuration() ?? 0)}
								aria-valuetext={t("player.seekPosition", {
									current: formatTime(displayTime),
									total: formatTime(duration),
								})}
							>
								<div className="player-progress-track">
									<div className="player-progress-fill" style={{ width: `${progress}%` }} />
									<div className="player-progress-thumb" style={{ left: `${progress}%` }} />
								</div>
							</div>

							<div className="player-controls-row">
								<div className="player-controls-left">
									<button
										ref={playButtonRef}
										type="button"
										className="icon-button"
										onClick={togglePlay}
										aria-label={isPlaying ? "Pause" : "Play"}
										data-tv-autofocus
									>
										{isPlaying ? (
											<Pause size={22} fill="currentColor" strokeWidth={0} />
										) : (
											<Play size={22} fill="currentColor" strokeWidth={0} />
										)}
									</button>
									<button
										type="button"
										className="icon-button player-skip-btn"
										onClick={seekBack}
										aria-label={t("player.skipBack")}
									>
										<RotateCcw size={18} />
										<span className="player-skip-label">{t("player.skipBack")}</span>
									</button>
									<button
										type="button"
										className="icon-button player-skip-btn"
										onClick={seekForward}
										aria-label={t("player.skipForward")}
									>
										<RotateCw size={18} />
										<span className="player-skip-label">{t("player.skipForward")}</span>
									</button>
									<button
										type="button"
										className="icon-button"
										onClick={toggleMute}
										aria-label={isMuted ? "Unmute" : "Mute"}
									>
										{isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
									</button>
									<span className="player-time">
										{formatTime(displayTime)} / {formatTime(duration)}
									</span>
								</div>
								<div className="player-controls-right">
									{showNextButton ? (
										<button
											type="button"
											className="player-next-btn"
											onClick={() => onSelectQueueItem?.(nextItem)}
											aria-label={t("player.nextEpisode")}
										>
											<SkipForward size={16} fill="currentColor" strokeWidth={0} />
											<span>{t("player.nextEpisode")}</span>
										</button>
									) : null}
									{canSelectQuality ? (
										<div className="player-quality-wrap">
											{qualityPickerOpen ? (
												<div className="player-quality-picker">
													<button
														type="button"
														className={`player-quality-option${manualQualityIndex === null ? " active" : ""}`}
														onClick={() => selectQuality(null)}
													>
														<strong>{t("player.qualityAuto")}</strong>
														<span>
															{qualityIndexRef.current != null
																? formatQualityLabel(
																		TRANSCODE_QUALITY_LADDER[qualityIndexRef.current],
																	)
																: t("player.qualityAdaptive")}
														</span>
													</button>
													{TRANSCODE_QUALITY_LADDER.map((profile, index) => (
														<button
															key={profile.maxStreamingBitrate}
															type="button"
															className={`player-quality-option${manualQualityIndex === index ? " active" : ""}`}
															onClick={() => selectQuality(index)}
														>
															<strong>{formatQualityLabel(profile)}</strong>
															<span>{`${Math.round(profile.videoBitrate / 1_000_000)} Mbps video`}</span>
														</button>
													))}
												</div>
											) : null}
											<button
												type="button"
												className={`icon-button player-quality-trigger${manualQualityIndex !== null ? " nav-pill-active" : ""}`}
												disabled={remote.active}
												onClick={() => {
													setQualityPickerOpen((open) => !open);
													setSubtitlePickerOpen(false);
												}}
												aria-label={t("player.quality")}
											>
												<SlidersHorizontal size={18} />
												<span>{displayedQualityLabel}</span>
											</button>
										</div>
									) : null}
									{nativeSubtitleTracks.length > 0 || osApiKey ? (
										<div className="player-subtitle-wrap">
											{subtitlePickerOpen ? (
												<div className="player-subtitle-picker">
													{/* Neither mechanism reaches the TV: <track> elements
													    don't travel with an AirPlay/Cast handoff, and the
													    OpenSubtitles overlay is DOM drawn over the local
													    element. Say so rather than appear to do nothing. */}
													{remote.active ? (
														<p className="player-subtitle-searching">
															{t("player.remoteSubtitlesUnsupported")}
														</p>
													) : null}
													{showSubtitleFilter ? (
														<div className="player-subtitle-search">
															<Search size={14} />
															<input
																type="text"
																value={subtitleFilter}
																onChange={(e) => setSubtitleFilter(e.target.value)}
																placeholder={t("player.subtitlesFilter")}
																aria-label={t("player.subtitlesFilter")}
															/>
														</div>
													) : null}
													{/* Pinned outside the scroll area: turning subtitles off
													    must stay one click away at any scroll position. */}
													<button
														type="button"
														className={`player-subtitle-option${activeSubtitle === null && onlineCues.length === 0 ? " active" : ""}`}
														onClick={() => selectSubtitle(null)}
													>
														{t("player.subtitlesOff")}
													</button>
													<div className="player-subtitle-list" ref={subtitleListRef}>
														{visibleSubtitleTracks.map((track) => (
															<button
																key={track.index}
																type="button"
																className={`player-subtitle-option${activeSubtitle === track.index ? " active" : ""}`}
																onClick={() => selectSubtitle(track.index)}
															>
																{track.label}
															</button>
														))}
														{osApiKey && showOnlineSubtitleSection ? (
															<>
																<p className="player-subtitle-section">
																	{t("player.subtitlesOnline")}
																</p>
																{onlineSubtitleError ? (
																	<p className="player-subtitle-searching">
																		{t("player.subtitlesError")}
																	</p>
																) : searchingSubtitles || loadingOnlineSubtitle ? (
																	<p className="player-subtitle-searching">
																		{t("player.subtitlesSearching")}
																	</p>
																) : onlineSubtitles.length === 0 ? (
																	// Unfiltered on purpose: "OpenSubtitles returned
																	// nothing" is not "your filter matched nothing".
																	<p className="player-subtitle-searching">
																		{t("player.subtitlesNoneFound")}
																	</p>
																) : (
																	visibleOnlineSubtitles.map((sub) => (
																		<button
																			key={sub.id}
																			type="button"
																			className="player-subtitle-option"
																			onClick={() => void selectOnlineSubtitle(sub.fileId)}
																		>
																			{sub.label}
																		</button>
																	))
																)}
															</>
														) : null}
														{noSubtitleMatches ? (
															<p className="player-subtitle-searching">
																{t("player.subtitlesNoMatch")}
															</p>
														) : null}
													</div>
													{/* A standing instruction, so it stays put rather than
													    scrolling away with the track list. */}
													{onlineCues.length > 0 ? (
														<p className="player-subtitle-searching">
															{t("player.subtitlesOffsetHint")}
														</p>
													) : null}
												</div>
											) : null}
											<button
												type="button"
												className={`icon-button${activeSubtitle !== null || onlineCues.length > 0 ? " nav-pill-active" : ""}`}
												onClick={() => {
													setQualityPickerOpen(false);
													setSubtitleFilter("");
													setSubtitlePickerOpen((o) => !o);
												}}
												aria-label={t("player.subtitles")}
											>
												<Captions size={20} />
											</button>
										</div>
									) : null}
									{remote.available ? (
										<button
											type="button"
											className={`icon-button${remote.active ? " nav-pill-active" : ""}`}
											onClick={remote.prompt}
											aria-pressed={remote.active}
											aria-label={remote.active ? t("player.remoteActive") : t("player.remote")}
										>
											{isAirplayPlatform ? <Airplay size={20} /> : <Cast size={20} />}
										</button>
									) : null}
									<button
										type="button"
										className="icon-button"
										onClick={() => void toggleFullscreen()}
										aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
									>
										{isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
									</button>
								</div>
							</div>
						</div>
					</div>
				</>
			) : isPreparingStream ? (
				<>
					{(item.backdropUrl ?? item.posterUrl) ? (
						<div className="player-poster-layer visible" aria-hidden="true">
							<img
								src={item.backdropUrl ?? item.posterUrl}
								alt=""
								className="player-poster-image"
							/>
						</div>
					) : null}

					<div className="player-buffering-overlay" aria-hidden="true">
						<div className="player-buffering-spinner" />
					</div>

					<div className="player-controls-overlay visible">
						<div className="player-controls-top">
							<div className="player-controls-title">
								<p className="eyebrow">{t("player.nowPlaying")}</p>
								<h2>{item.title}</h2>
								{item.type === "episode" && item.seriesTitle ? (
									<span>
										{item.seriesTitle}
										{item.episodeNumber ? ` · E${item.episodeNumber}` : ""}
									</span>
								) : null}
							</div>
							<button
								type="button"
								className="icon-button"
								onClick={onClose}
								data-aurora-overlay-close
								aria-label={t("player.close")}
							>
								<X size={20} />
							</button>
						</div>
					</div>
				</>
			) : (
				<div className="player-empty-fullscreen">
					<Film size={32} />
					<p>{t("player.notPlayable")}</p>
					<button type="button" className="secondary-action" onClick={onClose}>
						{t("player.close")}
					</button>
				</div>
			)}
		</div>
	);
}
