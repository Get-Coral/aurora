import { Captions, Film, Maximize, Minimize, Pause, Play, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLockBodyScroll } from './useLockBodyScroll'
import { useI18n } from '../lib/i18n'
import type { MediaItem } from '../lib/media'
import { beginPlaybackSession, reportPlaybackState } from '../server/functions'

interface MediaPlayerDialogProps {
  item: MediaItem | null
  open: boolean
  onClose: () => void
  queue?: MediaItem[]
  onSelectQueueItem?: (item: MediaItem) => void
}

function formatTime(seconds: number) {
  if (!seconds || Number.isNaN(seconds)) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function MediaPlayerDialog({ item, open, onClose }: MediaPlayerDialogProps) {
  const { t } = useI18n()
  useLockBodyScroll(open)
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [playbackSession, setPlaybackSession] = useState<{
    streamUrl: string
    canSyncProgress: boolean
    playSessionId?: string
    mediaSourceId?: string
    sessionId?: string
  } | null>(null)
  const lastReportedSecondRef = useRef(0)
  const stopReportedRef = useRef(false)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [autoplayMuted, setAutoplayMuted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [subtitlePickerOpen, setSubtitlePickerOpen] = useState(false)
  const [activeSubtitle, setActiveSubtitle] = useState<number | null>(null)

  const streamUrl = playbackSession?.streamUrl ?? item?.streamUrl
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  // Reset + start playback session when item changes
  useEffect(() => {
    stopReportedRef.current = false
    lastReportedSecondRef.current = 0
    setPlaybackSession(null)
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
    setActiveSubtitle(null)
    setSubtitlePickerOpen(false)
    setAutoplayMuted(false)

    if (!open || !item?.streamUrl) return

    let cancelled = false

    void beginPlaybackSession({ data: { id: item.id } })
      .then((session) => { if (!cancelled) setPlaybackSession(session) })
      .catch(() => {
        if (!cancelled) setPlaybackSession({ streamUrl: item.streamUrl!, canSyncProgress: false, subtitleTracks: [] })
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
        positionTicks: secondsToTicks(video!.currentTime),
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
      void reportPlaybackState({ data: buildPayload(overrides) }).catch(() => undefined)
    }

    function handleLoadedMetadata() {
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
      void reportPlaybackState({ data: buildPayload({ isStopped: true, played }) }).catch(() => undefined)
    }
  }, [open, item, playbackSession, streamUrl])

  // Player UI state tracking
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onDurationChange = () => setDuration(video.duration || 0)
    const onPlay = () => {
      setIsPlaying(true)
      if (video.muted) setAutoplayMuted(true)
    }
    const onPause = () => setIsPlaying(false)
    const onVolumeChange = () => {
      setIsMuted(video.muted)
      if (!video.muted) setAutoplayMuted(false)
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('volumechange', onVolumeChange)

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('volumechange', onVolumeChange)
    }
  }, [open])

  // Fullscreen tracking
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

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
        video.currentTime = Math.max(0, video.currentTime - 10)
      } else if (e.key === 'ArrowRight') {
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 10)
      } else if (e.key === 'f') {
        void toggleFullscreen()
      } else if (e.key === 'm') {
        video.muted = !video.muted
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

  function selectSubtitle(index: number | null) {
    const video = videoRef.current
    if (video) {
      for (const track of Array.from(video.textTracks)) {
        track.mode = 'disabled'
      }
      if (index !== null && video.textTracks[index]) {
        video.textTracks[index].mode = 'showing'
      }
    }
    setActiveSubtitle(index)
    setSubtitlePickerOpen(false)
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const video = videoRef.current
    if (video) video.currentTime = ratio * (video.duration || 0)
  }

  if (!open || !item) return null

  return (
    <div
      ref={containerRef}
      className={`player-fullscreen${controlsVisible ? ' controls-visible' : ''}`}
      onMouseMove={revealControls}
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
                aria-label={t('player.close')}
              >
                <X size={20} />
              </button>
            </div>

            <div className="player-controls-bottom">
              <div
                className="player-progress"
                onClick={handleSeek}
                role="slider"
                aria-label="Seek"
                aria-valuenow={Math.floor(currentTime)}
                aria-valuemin={0}
                aria-valuemax={Math.floor(duration)}
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
                  {(playbackSession?.subtitleTracks?.length ?? 0) > 0 ? (
                    <div className="player-subtitle-wrap">
                      {subtitlePickerOpen ? (
                        <div className="player-subtitle-picker">
                          <button
                            type="button"
                            className={`player-subtitle-option${activeSubtitle === null ? ' active' : ''}`}
                            onClick={() => selectSubtitle(null)}
                          >
                            Off
                          </button>
                          {playbackSession!.subtitleTracks.map((track) => (
                            <button
                              key={track.index}
                              type="button"
                              className={`player-subtitle-option${activeSubtitle === track.index ? ' active' : ''}`}
                              onClick={() => selectSubtitle(track.index)}
                            >
                              {track.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className={`icon-button${activeSubtitle !== null ? ' nav-pill-active' : ''}`}
                        onClick={() => setSubtitlePickerOpen((o) => !o)}
                        aria-label="Subtitles"
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
