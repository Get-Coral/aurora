import { useQuery } from "@tanstack/react-query";
import {
	Captions,
	Film,
	Maximize,
	Minimize,
	Pause,
	Play,
	RotateCcw,
	RotateCw,
	SkipForward,
	SlidersHorizontal,
	Volume2,
	VolumeX,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import {
	prepareSeekReloadUrl,
	setStreamStartTicks,
	setTranscodeQuality,
} from "../lib/jellyfin-stream-proxy";
import type { MediaItem } from "../lib/media";
import { getClientPlaybackContext } from "../lib/platform";
import {
	beginPlaybackSessionRuntime,
	fetchOnlineSubtitleRuntime,
	fetchOpenSubtitlesKeyRuntime,
	reportPlaybackStateRuntime,
	searchOnlineSubtitlesRuntime,
} from "../lib/runtime-functions";
import { useLockBodyScroll } from "./useLockBodyScroll";

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

function isNativeHlsStreamUrl(streamUrl: string) {
	const url = readTranscodeUrl(streamUrl);
	if (!url) return false;
	return url.pathname.endsWith(".m3u8") || url.searchParams.get("SegmentContainer") === "ts";
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
	const optimisticSeekTargetRef = useRef<number | null>(null);
	// Native/fullscreen media controls can change video.currentTime directly.
	// Track programmatic seeks so we only intercept user-driven native seeking.
	const internalSeekCountRef = useRef(0);
	const seekReloadRequestIdRef = useRef(0);
	// Tracks the drag ratio so handleProgressPointerUp can commit the final seek.
	const lastDragRatioRef = useRef(0);
	const pendingUserSeekRef = useRef<number | null>(null);

	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const [isBuffering, setIsBuffering] = useState(true);
	const [isMuted, setIsMuted] = useState(false);
	const [autoplayMuted, setAutoplayMuted] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [controlsVisible, setControlsVisible] = useState(true);
	const [qualityPickerOpen, setQualityPickerOpen] = useState(false);
	const [subtitlePickerOpen, setSubtitlePickerOpen] = useState(false);
	const [activeSubtitle, setActiveSubtitle] = useState<number | null>(null);
	const [manualQualityIndex, setManualQualityIndex] = useState<number | null>(null);
	const [onlineCues, setOnlineCues] = useState<VttCue[]>([]);
	const [loadingOnlineSubtitle, setLoadingOnlineSubtitle] = useState(false);
	const [onlineSubtitleError, setOnlineSubtitleError] = useState(false);
	const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null);
	const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const subtitleDivRef = useRef<HTMLDivElement>(null);
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

	const streamUrl =
		playbackSession?.streamUrl ?? (playbackClient.prefersSafeVideo ? null : item?.streamUrl);
	const isNativeHlsPlayback =
		playbackSession?.playMethod === "Transcode" && streamUrl?.includes(".m3u8");
	const canSelectQuality = playbackSession?.playMethod === "Transcode";
	const canAutoAdjustQuality = canSelectQuality && !isNativeHlsPlayback;
	const isPreparingStream =
		Boolean(item?.streamUrl) && playbackClient.prefersSafeVideo && playbackSession == null;
	const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
	const currentIndex = item && queue?.length ? queue.findIndex((q) => q.id === item.id) : -1;
	const nextItem = currentIndex >= 0 ? (queue?.[currentIndex + 1] ?? null) : null;
	const showNextButton = item?.type === "episode" && nextItem !== null;
	const displayedQualityLabel =
		manualQualityIndex == null
			? t("player.qualityAuto")
			: formatQualityLabel(TRANSCODE_QUALITY_LADDER[manualQualityIndex]);

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
		setIsBuffering(true);
		setPlaybackSession(null);
		setCurrentTime(0);
		setDuration((item?.runtimeMinutes ?? 0) * 60);
		setIsPlaying(false);
		setQualityPickerOpen(false);
		setActiveSubtitle(null);
		setSubtitlePickerOpen(false);
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

		void beginPlaybackSessionRuntime({ data: { id: item.id, client } })
			.then((session) => {
				if (cancelled) return;
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
			const currentSecond = Math.floor(video!.currentTime);
			if (!overrides?.force && currentSecond - lastReportedSecondRef.current < 8) return;
			lastReportedSecondRef.current = currentSecond;
			void reportPlaybackStateRuntime({ data: buildPayload(overrides) }).catch(() => undefined);
		}

		function handleLoadedMetadata() {
			logPlayback("media:loadedmetadata", {
				videoState: snapshotMediaState(video),
			});
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
				optimisticSeekTargetRef.current = null;
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
				setVideoCurrentTime(item!.playbackPositionTicks / 10_000_000);
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

			if (stopReportedRef.current || video.ended) return;
			const played =
				video.duration && video.currentTime / video.duration >= 0.94 ? true : undefined;
			stopReportedRef.current = true;
			void reportPlaybackStateRuntime({ data: buildPayload({ isStopped: true, played }) }).catch(
				() => undefined,
			);
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
			optimisticSeekTargetRef.current = currentMovieTime;
			lastReportedSecondRef.current = 0;
			seekPendingRef.current = true;
			setCurrentTime(currentMovieTime);
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
			if (optimisticTarget != null && nextTime < optimisticTarget - 1) return;
			setCurrentTime(nextTime);
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
			const d = video.duration;
			// Only trust the video's reported duration when it's finite and plausible.
			// Transcoded streams served progressively often report a fluctuating or
			// near-zero duration until the full moov atom is received — fall back to
			// the known runtime from Jellyfin metadata instead.
			// When the stream starts at an offset (StartTimeTicks seek), the reported
			// duration is only the remaining portion, so add the offset back.
			const knownRuntime = (item?.runtimeMinutes ?? 0) * 60;
			const offset = startTimeOffsetRef.current;
			if (Number.isFinite(d) && d > 60) {
				setDuration(d + offset);
			} else if (knownRuntime > 0) {
				setDuration(knownRuntime);
			} else if (Number.isFinite(d) && d > 0) {
				setDuration(d + offset);
			}
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

	// Auto-hide controls
	useEffect(() => {
		if (!isPlaying) {
			setControlsVisible(true);
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
			return;
		}
		hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
		return () => {
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		};
	}, [isPlaying]);

	// Keyboard shortcuts
	useEffect(() => {
		if (!open) return;
		function handleKeydown(e: KeyboardEvent) {
			const video = videoRef.current;
			if (!video) return;
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
			} else if (e.key === "Escape") {
				onClose();
			}
		}
		window.addEventListener("keydown", handleKeydown);
		return () => window.removeEventListener("keydown", handleKeydown);
	}, [currentTime, open, onClose]);

	function revealControls() {
		setControlsVisible(true);
		if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		if (isPlaying) {
			hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
		}
	}

	function togglePlay() {
		const video = videoRef.current;
		if (!video) return;
		video.paused ? void video.play() : video.pause();
	}

	function handleVideoClick() {
		if (Date.now() < ignoreVideoClickUntilRef.current) return;
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
		internalSeekCountRef.current += 1;
		video.currentTime = nextTime;
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
			setSubtitlePickerOpen(false);
		} catch {
			setOnlineSubtitleError(true);
		} finally {
			setLoadingOnlineSubtitle(false);
		}
	}

	function selectSubtitle(index: number | null) {
		setOnlineCues([]);
		setQualityPickerOpen(false);
		const video = videoRef.current;
		if (video) {
			for (const track of Array.from(video.textTracks)) track.mode = "disabled";
			if (index !== null && video.textTracks[index]) video.textTracks[index].mode = "showing";
		}
		setActiveSubtitle(index);
		setSubtitlePickerOpen(false);
	}

	function selectQuality(index: number | null) {
		setQualityPickerOpen(false);
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
		optimisticSeekTargetRef.current = currentMovieTime;
		lastReportedSecondRef.current = 0;
		seekPendingRef.current = true;
		setCurrentTime(currentMovieTime);
		setIsBuffering(true);
		void reloadStreamAtMovieTime(currentMovieTime, {
			qualityProfile: TRANSCODE_QUALITY_LADDER[index],
		});
	}

	// Returns the best available duration: React state first, then video element, then null
	function getBestDuration(): number | null {
		if (duration > 0) return duration;
		const d = videoRef.current?.duration;
		return d != null && Number.isFinite(d) && d > 0 ? d + startTimeOffsetRef.current : null;
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
			let buffered = false;
			if (streamTime >= 0) {
				for (let i = 0; i < video.buffered.length; i++) {
					if (streamTime >= video.buffered.start(i) && streamTime <= video.buffered.end(i) + 1) {
						buffered = true;
						break;
					}
				}
			}
			if (!buffered || streamTime < 0) {
				if (seekPendingRef.current) return; // reload already in flight
				pendingSeekTargetRef.current = clamped;
				optimisticSeekTargetRef.current = clamped;
				setCurrentTime(clamped);
				// After reload, video.currentTime resets to ~0. Reset the throttle
				// baseline so syncProgress doesn't suppress reports until stream time
				// catches up to the pre-seek value (which could take minutes).
				lastReportedSecondRef.current = 0;
				seekPendingRef.current = true;
				setIsBuffering(true);
				void reloadStreamAtMovieTime(clamped);
				return;
			}
			setVideoCurrentTime(streamTime);
			pendingUserSeekRef.current = null;
			if (options?.resumeIfPlaying) resumePlaybackAfterSeek();
		} else {
			setVideoCurrentTime(clamped);
			pendingUserSeekRef.current = null;
			if (options?.resumeIfPlaying) resumePlaybackAfterSeek();
		}
	}

	function handleProgressPointerDown(e: React.PointerEvent<HTMLDivElement>) {
		e.preventDefault();
		e.stopPropagation();
		e.currentTarget.setPointerCapture(e.pointerId);
		seekDraggingRef.current = true;
		const rect = e.currentTarget.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		lastDragRatioRef.current = ratio;
		// During drag only seek within already-buffered content for smooth feedback.
		// The final commit happens on pointerUp.
		const d = getBestDuration();
		if (d != null) {
			const video = videoRef.current;
			const targetMovieTime = ratio * d;
			const streamTime = targetMovieTime - startTimeOffsetRef.current;
			if (video && streamTime >= 0) {
				let buffered = false;
				for (let i = 0; i < video.buffered.length; i++) {
					if (streamTime >= video.buffered.start(i) && streamTime <= video.buffered.end(i) + 1) {
						buffered = true;
						break;
					}
				}
				if (buffered) setVideoCurrentTime(streamTime);
			}
		}
		revealControls();
	}

	function handleProgressPointerMove(e: React.PointerEvent<HTMLDivElement>) {
		if (!seekDraggingRef.current) return;
		e.preventDefault();
		e.stopPropagation();
		const rect = e.currentTarget.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		lastDragRatioRef.current = ratio;
		const d = getBestDuration();
		if (d != null) {
			const video = videoRef.current;
			const targetMovieTime = ratio * d;
			const streamTime = targetMovieTime - startTimeOffsetRef.current;
			if (video && streamTime >= 0) {
				let buffered = false;
				for (let i = 0; i < video.buffered.length; i++) {
					if (streamTime >= video.buffered.start(i) && streamTime <= video.buffered.end(i) + 1) {
						buffered = true;
						break;
					}
				}
				if (buffered) setVideoCurrentTime(streamTime);
			}
		}
	}

	function handleProgressPointerUp(e: React.PointerEvent<HTMLDivElement>) {
		e.preventDefault();
		e.stopPropagation();
		seekDraggingRef.current = false;
		e.currentTarget.releasePointerCapture(e.pointerId);
		// Commit the final seek position — may trigger a URL reload if not buffered.
		const d = getBestDuration();
		if (d != null) seekToMovieTime(lastDragRatioRef.current * d, { resumeIfPlaying: true });
	}

	function seekBack() {
		seekToMovieTime(currentTime - 15, { resumeIfPlaying: !videoRef.current?.paused });
	}

	function seekForward() {
		seekToMovieTime(currentTime + 30, { resumeIfPlaying: !videoRef.current?.paused });
	}

	if (!open || !item) return null;

	return (
		<div
			ref={containerRef}
			className={`player-fullscreen${controlsVisible ? " controls-visible" : ""}`}
			onMouseMove={revealControls}
			onTouchStart={revealControls}
		>
			{streamUrl ? (
				<>
					{(item.backdropUrl ?? item.posterUrl) ? (
						<div
							className={`player-poster-layer${isBuffering ? " visible" : ""}`}
							aria-hidden={!isBuffering}
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

					{isBuffering ? (
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
								className="player-progress"
								onPointerDown={handleProgressPointerDown}
								onPointerMove={handleProgressPointerMove}
								onPointerUp={handleProgressPointerUp}
								role="slider"
								aria-label="Seek"
								aria-valuenow={Math.floor(currentTime)}
								aria-valuemin={0}
								aria-valuemax={Math.floor(getBestDuration() ?? 0)}
							>
								<div className="player-progress-track">
									<div className="player-progress-fill" style={{ width: `${progress}%` }} />
									<div className="player-progress-thumb" style={{ left: `${progress}%` }} />
								</div>
							</div>

							<div className="player-controls-row">
								<div className="player-controls-left">
									<button
										type="button"
										className="icon-button"
										onClick={togglePlay}
										aria-label={isPlaying ? "Pause" : "Play"}
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
										{formatTime(currentTime)} / {formatTime(duration)}
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
									{(playbackSession?.subtitleTracks?.length ?? 0) > 0 || osApiKey ? (
										<div className="player-subtitle-wrap">
											{subtitlePickerOpen ? (
												<div className="player-subtitle-picker">
													<button
														type="button"
														className={`player-subtitle-option${activeSubtitle === null && onlineCues.length === 0 ? " active" : ""}`}
														onClick={() => selectSubtitle(null)}
													>
														{t("player.subtitlesOff")}
													</button>
													{(playbackSession?.subtitleTracks ?? []).map((track) => (
														<button
															key={track.index}
															type="button"
															className={`player-subtitle-option${activeSubtitle === track.index ? " active" : ""}`}
															onClick={() => selectSubtitle(track.index)}
														>
															{track.label}
														</button>
													))}
													{osApiKey ? (
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
																<p className="player-subtitle-searching">
																	{t("player.subtitlesNoneFound")}
																</p>
															) : (
																onlineSubtitles.map((sub) => (
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
													setSubtitlePickerOpen((o) => !o);
													setQualityPickerOpen(false);
												}}
												aria-label={t("player.subtitles")}
											>
												<Captions size={20} />
											</button>
										</div>
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
