import { Captions, Film, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useLockBodyScroll } from './useLockBodyScroll'
import { useI18n } from '../lib/i18n'
import type { MediaItem } from '../lib/media'
import { getClientPlaybackContext } from '../lib/platform'
import {
  beginPlaybackSessionRuntime,
  fetchOnlineSubtitleRuntime,
  fetchOpenSubtitlesKeyRuntime,
  reportPlaybackStateRuntime,
  searchOnlineSubtitlesRuntime,
} from '../lib/runtime-functions'

interface MediaPlayerDialogProps {
  item: MediaItem | null
  open: boolean
  onClose: () => void
  queue?: MediaItem[]
  onSelectQueueItem?: (item: MediaItem) => void
}

interface VttCue { start: number; end: number; text: string }

function parseVttTime(s: string): number {
  const m = s.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
}

function parseVtt(raw: string): VttCue[] {
  const cues: VttCue[] = []
  const blocks = raw.replace(/\r\n/g, '\n').split(/\n\n+/)
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    const timingIdx = lines.findIndex((l) => l.includes('-->'))
    if (timingIdx === -1) continue
    const [startStr, endStr] = lines[timingIdx].split('-->')
    const text = lines.slice(timingIdx + 1).join('\n').replace(/<[^>]+>/g, '').trim()
    if (text) cues.push({ start: parseVttTime(startStr), end: parseVttTime(endStr), text })
  }
  return cues
}

function formatTime(seconds: number) {
  if (!seconds || Number.isNaN(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function MediaPlayerDialog({ item, open, onClose, queue, onSelectQueueItem }: MediaPlayerDialogProps) {
  const { t } = useI18n()
  useLockBodyScroll(open)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seekDraggingRef = useRef(false)

  const [playbackSession, setPlaybackSession] = useState<{
    streamUrl: string
    canSyncProgress: boolean
    playMethod?: 'DirectPlay' | 'Transcode'
    playSessionId?: string
    mediaSourceId?: string
    sessionId?: string
    subtitleTracks: {
      index: number
      label: string
      language: string
      url: string
    }[]
  } | null>(null)
  const lastReportedSecondRef = useRef(0)
  const stopReportedRef = useRef(false)
  // Tracks how many seconds into the movie the current stream segment starts.
  // When seeking beyond the buffer on a transcode, we reload the stream with
  // StartTimeTicks=X; after that reload video.currentTime=0 means X seconds
  // into the movie, so all time math must add this offset.
  const startTimeOffsetRef = useRef(0)
  // Set to true while a seek-triggered reload is in progress so that
  // handleLoadedMetadata skips the normal resume-position restore.
  const seekPendingRef = useRef(false)
  // Tracks the drag ratio so handleProgressPointerUp can commit the final seek.
  const lastDragRatioRef = useRef(0)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isBuffering, setIsBuffering] = useState(true)
  const [isMuted, setIsMuted] = useState(false)
  const [autoplayMuted, setAutoplayMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [subtitlePickerOpen, setSubtitlePickerOpen] = useState(false)
  const [activeSubtitle, setActiveSubtitle] = useState<number | null>(null)
  const [onlineCues, setOnlineCues] = useState<VttCue[]>([])
  const [loadingOnlineSubtitle, setLoadingOnlineSubtitle] = useState(false)
  const [onlineSubtitleError, setOnlineSubtitleError] = useState(false)
  const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const subtitleDivRef = useRef<HTMLDivElement>(null)
  const onlineCuesRef = useRef<VttCue[]>([])
  const subtitleOffsetRef = useRef(0)
  // Keep a ref in sync so the RAF subtitle loop can read cues without capturing stale state
  onlineCuesRef.current = onlineCues

  const { data: osApiKey } = useQuery({
    queryKey: ['opensubtitles-key'],
    queryFn: () => fetchOpenSubtitlesKeyRuntime(),
    staleTime: Infinity,
  })

  const { data: onlineSubtitles = [], isFetching: searchingSubtitles } = useQuery({
    queryKey: ['online-subtitles', item?.id],
    queryFn: () => searchOnlineSubtitlesRuntime({
      data: {
        title: item!.type === 'episode' ? (item!.seriesTitle ?? item!.title) : item!.title,
        year: item!.year,
        season: item!.seasonNumber,
        episode: item!.episodeNumber,
      },
    }),
    enabled: Boolean(open && item && osApiKey),
    staleTime: 0,
  })

  const streamUrl = playbackSession?.streamUrl ?? item?.streamUrl
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const currentIndex = item && queue?.length ? queue.findIndex((q) => q.id === item.id) : -1
  const nextItem = currentIndex >= 0 ? (queue?.[currentIndex + 1] ?? null) : null
  const showNextButton = item?.type === 'episode' && nextItem !== null

  // Reset + start playback session when item changes
  useEffect(() => {
    stopReportedRef.current = false
    lastReportedSecondRef.current = 0
    startTimeOffsetRef.current = 0
    seekPendingRef.current = false
    setIsBuffering(true)
    setPlaybackSession(null)
    setCurrentTime(0)
    setDuration((item?.runtimeMinutes ?? 0) * 60)
    setIsPlaying(false)
    setActiveSubtitle(null)
    setSubtitlePickerOpen(false)
    setAutoplayMuted(false)
    setOnlineCues([])
    setAutoplayCountdown(null)
    videoRef.current?.querySelector('track[data-online]')?.remove()

    if (!open || !item?.streamUrl) return

    let cancelled = false
    const client = getClientPlaybackContext()

    void beginPlaybackSessionRuntime({ data: { id: item.id, client } })
      .then((session) => {
        if (cancelled) return
        // For transcoded streams, bake the resume position into StartTimeTicks
        // so that Jellyfin starts the transcode from the right point. This
        // avoids a seek-beyond-buffer that causes iOS to restart at 0:00.
        const resumeTicks = item!.playbackPositionTicks ?? 0
        if (resumeTicks > 0 && session.playMethod === 'Transcode') {
          const url = new URL(session.streamUrl)
          url.searchParams.set('StartTimeTicks', String(resumeTicks))
          startTimeOffsetRef.current = resumeTicks / 10_000_000
          seekPendingRef.current = true
          setPlaybackSession({ ...session, streamUrl: url.toString() })
        } else {
          setPlaybackSession(session)
        }
      })
      .catch(() => {
        if (!cancelled) setPlaybackSession({ streamUrl: item.streamUrl!, canSyncProgress: false, playMethod: 'DirectPlay', subtitleTracks: [] })
      })

    return () => { cancelled = true }
  }, [open, item])

  // Reload video when stream URL changes
  useEffect(() => {
    if (!open || !streamUrl) return
    videoRef.current?.load()
  }, [open, streamUrl])

  // Jellyfin progress sync
  useEffect(() => {
    const video = videoRef.current
    if (!video || !open || !item?.streamUrl) return

    function secondsToTicks(s: number) { return Math.max(0, Math.floor(s * 10_000_000)) }

    function buildPayload(overrides?: { isPaused?: boolean; isStopped?: boolean; played?: boolean }) {
      return {
        id: item!.id,
        positionTicks: secondsToTicks(video!.currentTime + startTimeOffsetRef.current),
        playMethod: playbackSession?.playMethod,
        playSessionId: playbackSession?.playSessionId,
        mediaSourceId: playbackSession?.mediaSourceId,
        sessionId: playbackSession?.sessionId,
        ...overrides,
      }
    }

    function syncProgress(overrides?: { isPaused?: boolean; isStopped?: boolean; played?: boolean; force?: boolean }) {
      if (!item) return
      const currentSecond = Math.floor(video!.currentTime)
      if (!overrides?.force && currentSecond - lastReportedSecondRef.current < 8) return
      lastReportedSecondRef.current = currentSecond
      void reportPlaybackStateRuntime({ data: buildPayload(overrides) }).catch(() => undefined)
    }

    function handleLoadedMetadata() {
      if (seekPendingRef.current) {
        // Stream was reloaded from a StartTimeTicks offset — video.currentTime=0
        // is already the right relative position. Just resume playback.
        seekPendingRef.current = false
        video!.play().catch(() => undefined)
        return
      }
      if (item!.playbackPositionTicks) video!.currentTime = item!.playbackPositionTicks / 10_000_000
    }
    function handleTimeUpdate() { if (playbackSession?.canSyncProgress) syncProgress() }
    function handlePause() { syncProgress({ isPaused: true, force: true }) }
    function handleEnded() {
      if (stopReportedRef.current) return
      stopReportedRef.current = true
      syncProgress({ isStopped: true, played: true, force: true })
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('pause', handlePause)
    video.addEventListener('ended', handleEnded)

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('ended', handleEnded)

      if (stopReportedRef.current || video.ended) return
      const played = video.duration && video.currentTime / video.duration >= 0.94 ? true : undefined
      stopReportedRef.current = true
      void reportPlaybackStateRuntime({ data: buildPayload({ isStopped: true, played }) }).catch(() => undefined)
    }
  }, [open, item, playbackSession, streamUrl])

  // Player UI state tracking
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => setCurrentTime(video.currentTime + startTimeOffsetRef.current)
    const onDurationChange = () => {
      const d = video.duration
      // Only trust the video's reported duration when it's finite and plausible.
      // Transcoded streams served progressively often report a fluctuating or
      // near-zero duration until the full moov atom is received — fall back to
      // the known runtime from Jellyfin metadata instead.
      // When the stream starts at an offset (StartTimeTicks seek), the reported
      // duration is only the remaining portion, so add the offset back.
      const knownRuntime = (item?.runtimeMinutes ?? 0) * 60
      const offset = startTimeOffsetRef.current
      if (Number.isFinite(d) && d > 60) {
        setDuration(d + offset)
      } else if (knownRuntime > 0) {
        setDuration(knownRuntime)
      } else if (Number.isFinite(d) && d > 0) {
        setDuration(d + offset)
      }
    }
    const onPlay = () => {
      setIsPlaying(true)
      if (video.muted) setAutoplayMuted(true)
    }
    const onPause = () => setIsPlaying(false)
    const onVolumeChange = () => {
      setIsMuted(video.muted)
      if (!video.muted) setAutoplayMuted(false)
    }
    const onWaiting = () => setIsBuffering(true)
    const onPlaying = () => setIsBuffering(false)

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('volumechange', onVolumeChange)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
    }
  }, [open])


  // RAF-based subtitle sync: reads video.currentTime at 60fps and updates the DOM directly,
  // bypassing React renders for tight timing (timeupdate only fires ~4x/sec).
  useEffect(() => {
    const video = videoRef.current
    const div = subtitleDivRef.current
    if (!video || !div) return
    let rafId: number
    let lastCueText: string | null = null
    const tick = () => {
      rafId = requestAnimationFrame(tick)
      const t = video.currentTime + startTimeOffsetRef.current + subtitleOffsetRef.current
      const cue = onlineCuesRef.current.find((c) => t >= c.start && t <= c.end) ?? null
      const text = cue?.text ?? null
      if (text !== lastCueText) {
        lastCueText = text
        div.textContent = ''
        if (text) {
          for (const line of text.split('\n')) {
            const span = document.createElement('span')
            span.textContent = line
            div.appendChild(span)
          }
          div.style.display = ''
        } else {
          div.style.display = 'none'
        }
      }
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [open])

  // Fullscreen tracking
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Auto-play next episode: start countdown when video ends and a next item exists
  useEffect(() => {
    const video = videoRef.current
    if (!video || !open) return

    function handleEnded() {
      if (nextItem) setAutoplayCountdown(10)
    }

    video.addEventListener('ended', handleEnded)
    return () => video.removeEventListener('ended', handleEnded)
  }, [open, nextItem?.id])

  // Tick the autoplay countdown down; fire when it reaches 0
  useEffect(() => {
    if (autoplayCountdown === null) {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
      return
    }
    if (autoplayCountdown === 0) {
      if (nextItem) onSelectQueueItem?.(nextItem)
      setAutoplayCountdown(null)
      return
    }
    countdownTimerRef.current = setInterval(() => {
      setAutoplayCountdown((c) => (c !== null ? c - 1 : null))
    }, 1000)
    return () => { if (countdownTimerRef.current) clearInterval(countdownTimerRef.current) }
  }, [autoplayCountdown])

  // Auto-hide controls
  useEffect(() => {
    if (!isPlaying) {
      setControlsVisible(true)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      return
    }
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000)
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }
  }, [isPlaying])

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return
    function handleKeydown(e: KeyboardEvent) {
      const video = videoRef.current
      if (!video) return
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        video.paused ? void video.play() : video.pause()
      } else if (e.key === 'ArrowLeft') {
        video.currentTime = Math.max(0, video.currentTime - 15)
      } else if (e.key === 'ArrowRight') {
        const d = duration > 0 ? duration : (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null)
        video.currentTime = d != null ? Math.min(d, video.currentTime + 30) : video.currentTime + 30
      } else if (e.key === 'f') {
        void toggleFullscreen()
      } else if (e.key === 'm') {
        video.muted = !video.muted
      } else if (e.key === 'z') {
        subtitleOffsetRef.current = Math.round((subtitleOffsetRef.current - 0.1) * 10) / 10
      } else if (e.key === 'x') {
        subtitleOffsetRef.current = Math.round((subtitleOffsetRef.current + 0.1) * 10) / 10
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [open, onClose])

  function revealControls() {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (isPlaying) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000)
    }
  }

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    video.paused ? void video.play() : video.pause()
  }

  function toggleMute() {
    const video = videoRef.current
    if (video) video.muted = !video.muted
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await containerRef.current?.requestFullscreen()
    }
  }

  async function selectOnlineSubtitle(fileId: number) {
    setLoadingOnlineSubtitle(true)
    setOnlineSubtitleError(false)
    try {
      const { content } = await fetchOnlineSubtitleRuntime({ data: { fileId } })
      subtitleOffsetRef.current = 0
      setOnlineCues(parseVtt(content))
      setActiveSubtitle(null)
      setSubtitlePickerOpen(false)
    } catch {
      setOnlineSubtitleError(true)
    } finally {
      setLoadingOnlineSubtitle(false)
    }
  }

  function selectSubtitle(index: number | null) {
    setOnlineCues([])
    const video = videoRef.current
    if (video) {
      for (const track of Array.from(video.textTracks)) track.mode = 'disabled'
      if (index !== null && video.textTracks[index]) video.textTracks[index].mode = 'showing'
    }
    setActiveSubtitle(index)
    setSubtitlePickerOpen(false)
  }

  // Returns the best available duration: React state first, then video element, then null
  function getBestDuration(): number | null {
    if (duration > 0) return duration
    const d = videoRef.current?.duration
    return d != null && Number.isFinite(d) && d > 0 ? d + startTimeOffsetRef.current : null
  }

  // Seeks to an absolute movie-time position (seconds). For transcode streams,
  // if the target is not within the buffered range we rebuild the URL with
  // StartTimeTicks so Jellyfin starts the transcode from the right point,
  // preventing iOS from restarting playback at 0:00.
  function seekToMovieTime(targetMovieTime: number) {
    const video = videoRef.current
    if (!video) return
    const d = getBestDuration()
    const clamped = d != null ? Math.max(0, Math.min(d, targetMovieTime)) : Math.max(0, targetMovieTime)

    if (playbackSession?.playMethod === 'Transcode') {
      const streamTime = clamped - startTimeOffsetRef.current
      // Check whether streamTime falls within an already-downloaded range.
      // Both bounds must be checked: only checking the end can pass for gaps
      // between ranges or for positions before the first buffered range.
      let buffered = false
      if (streamTime >= 0) {
        for (let i = 0; i < video.buffered.length; i++) {
          if (streamTime >= video.buffered.start(i) && streamTime <= video.buffered.end(i) + 1) {
            buffered = true
            break
          }
        }
      }
      if (!buffered || streamTime < 0) {
        if (seekPendingRef.current) return  // reload already in flight
        const url = new URL(playbackSession.streamUrl)
        url.searchParams.set('StartTimeTicks', String(Math.floor(clamped * 10_000_000)))
        startTimeOffsetRef.current = clamped
        // After reload, video.currentTime resets to ~0. Reset the throttle
        // baseline so syncProgress doesn't suppress reports until stream time
        // catches up to the pre-seek value (which could take minutes).
        lastReportedSecondRef.current = 0
        seekPendingRef.current = true
        setIsBuffering(true)
        setPlaybackSession({ ...playbackSession, streamUrl: url.toString() })
        return
      }
      video.currentTime = streamTime
    } else {
      video.currentTime = clamped
    }
  }

  function handleProgressPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    seekDraggingRef.current = true
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    lastDragRatioRef.current = ratio
    // During drag only seek within already-buffered content for smooth feedback.
    // The final commit happens on pointerUp.
    const d = getBestDuration()
    if (d != null) {
      const video = videoRef.current
      const targetMovieTime = ratio * d
      const streamTime = targetMovieTime - startTimeOffsetRef.current
      if (video && streamTime >= 0) {
        let buffered = false
        for (let i = 0; i < video.buffered.length; i++) {
          if (streamTime >= video.buffered.start(i) && streamTime <= video.buffered.end(i) + 1) { buffered = true; break }
        }
        if (buffered) video.currentTime = streamTime
      }
    }
    revealControls()
  }

  function handleProgressPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!seekDraggingRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    lastDragRatioRef.current = ratio
    const d = getBestDuration()
    if (d != null) {
      const video = videoRef.current
      const targetMovieTime = ratio * d
      const streamTime = targetMovieTime - startTimeOffsetRef.current
      if (video && streamTime >= 0) {
        let buffered = false
        for (let i = 0; i < video.buffered.length; i++) {
          if (streamTime >= video.buffered.start(i) && streamTime <= video.buffered.end(i) + 1) { buffered = true; break }
        }
        if (buffered) video.currentTime = streamTime
      }
    }
  }

  function handleProgressPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    seekDraggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    // Commit the final seek position — may trigger a URL reload if not buffered.
    const d = getBestDuration()
    if (d != null) seekToMovieTime(lastDragRatioRef.current * d)
  }

  function seekBack() {
    seekToMovieTime(currentTime - 15)
  }

  function seekForward() {
    seekToMovieTime(currentTime + 30)
  }

  if (!open || !item) return null

  return (
    <div
      ref={containerRef}
      className={`player-fullscreen${controlsVisible ? ' controls-visible' : ''}`}
      onMouseMove={revealControls}
      onTouchStart={revealControls}
    >
      {streamUrl ? (
        <>
          <video
            ref={videoRef}
            className="player-fullscreen-video"
            autoPlay
            playsInline
            poster={item.backdropUrl ?? item.posterUrl}
            preload="metadata"
            onClick={togglePlay}
          >
            <source src={streamUrl} />
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
            className={`player-subtitle-cue${controlsVisible ? ' player-subtitle-cue-raised' : ''}`}
          />

          {autoplayMuted ? (
            <button
              type="button"
              className="player-unmute-prompt"
              onClick={() => {
                const video = videoRef.current
                if (video) video.muted = false
              }}
            >
              <VolumeX size={20} />
              <span>{t('player.tapToUnmute')}</span>
            </button>
          ) : null}

          {autoplayCountdown !== null && nextItem ? (
            <div className="player-autoplay-banner">
              <div className="player-autoplay-thumb">
                {nextItem.backdropUrl ?? nextItem.posterUrl ? (
                  <img src={nextItem.backdropUrl ?? nextItem.posterUrl} alt={nextItem.title} />
                ) : null}
              </div>
              <div className="player-autoplay-copy">
                <span className="eyebrow">{t('player.upNext')}</span>
                <strong>{nextItem.title}</strong>
                {nextItem.seriesTitle ? (
                  <span>{nextItem.seriesTitle}{nextItem.episodeNumber ? ` · E${nextItem.episodeNumber}` : ''}</span>
                ) : null}
                <p className="player-autoplay-countdown">
                  {t('player.autoplayCountdown', { count: autoplayCountdown })}
                </p>
              </div>
              <button
                type="button"
                className="secondary-action player-autoplay-cancel"
                onClick={() => setAutoplayCountdown(null)}
              >
                {t('player.autoplayCancel')}
              </button>
            </div>
          ) : null}

          <div className={`player-controls-overlay${controlsVisible ? ' visible' : ''}`}>
            <div className="player-controls-top">
              <div className="player-controls-title">
                <p className="eyebrow">{t('player.nowPlaying')}</p>
                <h2>{item.title}</h2>
                {item.type === 'episode' && item.seriesTitle ? (
                  <span>{item.seriesTitle}{item.episodeNumber ? ` · E${item.episodeNumber}` : ''}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={onClose}
                data-aurora-overlay-close
                aria-label={t('player.close')}
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
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying
                      ? <Pause size={22} fill="currentColor" strokeWidth={0} />
                      : <Play size={22} fill="currentColor" strokeWidth={0} />}
                  </button>
                  <button
                    type="button"
                    className="icon-button player-skip-btn"
                    onClick={seekBack}
                    aria-label={t('player.skipBack')}
                  >
                    <RotateCcw size={18} />
                    <span className="player-skip-label">{t('player.skipBack')}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button player-skip-btn"
                    onClick={seekForward}
                    aria-label={t('player.skipForward')}
                  >
                    <RotateCw size={18} />
                    <span className="player-skip-label">{t('player.skipForward')}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
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
                      aria-label={t('player.nextEpisode')}
                    >
                      <SkipForward size={16} fill="currentColor" strokeWidth={0} />
                      <span>{t('player.nextEpisode')}</span>
                    </button>
                  ) : null}
                  {(playbackSession?.subtitleTracks?.length ?? 0) > 0 || osApiKey ? (
                    <div className="player-subtitle-wrap">
                      {subtitlePickerOpen ? (
                        <div className="player-subtitle-picker">
                          <button
                            type="button"
                            className={`player-subtitle-option${activeSubtitle === null && onlineCues.length === 0 ? ' active' : ''}`}
                            onClick={() => selectSubtitle(null)}
                          >
                            {t('player.subtitlesOff')}
                          </button>
                          {(playbackSession?.subtitleTracks ?? []).map((track) => (
                            <button
                              key={track.index}
                              type="button"
                              className={`player-subtitle-option${activeSubtitle === track.index ? ' active' : ''}`}
                              onClick={() => selectSubtitle(track.index)}
                            >
                              {track.label}
                            </button>
                          ))}
                          {osApiKey ? (
                            <>
                              <p className="player-subtitle-section">{t('player.subtitlesOnline')}</p>
                              {onlineSubtitleError ? (
                                <p className="player-subtitle-searching">{t('player.subtitlesError')}</p>
                              ) : searchingSubtitles || loadingOnlineSubtitle ? (
                                <p className="player-subtitle-searching">{t('player.subtitlesSearching')}</p>
                              ) : onlineSubtitles.length === 0 ? (
                                <p className="player-subtitle-searching">{t('player.subtitlesNoneFound')}</p>
                              ) : onlineSubtitles.map((sub) => (
                                <button
                                  key={sub.id}
                                  type="button"
                                  className="player-subtitle-option"
                                  onClick={() => void selectOnlineSubtitle(sub.fileId)}
                                >
                                  {sub.label}
                                </button>
                              ))}
                            </>
                          ) : null}
                          {onlineCues.length > 0 ? (
                            <p className="player-subtitle-searching">{t('player.subtitlesOffsetHint')}</p>
                          ) : null}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className={`icon-button${activeSubtitle !== null || onlineCues.length > 0 ? ' nav-pill-active' : ''}`}
                        onClick={() => setSubtitlePickerOpen((o) => !o)}
                        aria-label={t('player.subtitles')}
                      >
                        <Captions size={20} />
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void toggleFullscreen()}
                    aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  >
                    {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="player-empty-fullscreen">
          <Film size={32} />
          <p>{t('player.notPlayable')}</p>
          <button type="button" className="secondary-action" onClick={onClose}>
            {t('player.close')}
          </button>
        </div>
      )}
    </div>
  )
}
