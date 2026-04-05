import { Film, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import type { MediaItem } from '../lib/media'
import {
  beginPlaybackSession,
  reportPlaybackState,
} from '../server/functions'

interface MediaPlayerDialogProps {
  item: MediaItem | null
  open: boolean
  onClose: () => void
  queue?: MediaItem[]
  onSelectQueueItem?: (item: MediaItem) => void
}

function buildSubtitle(
  item: MediaItem,
  labels: { series: string; episode: string; movie: string },
) {
  return [
    item.type === 'series'
      ? labels.series
      : item.type === 'episode'
        ? labels.episode
        : labels.movie,
    item.year,
    item.runtimeMinutes ? `${item.runtimeMinutes}m` : null,
  ]
    .filter(Boolean)
    .join(' • ')
}

export function MediaPlayerDialog({
  item,
  open,
  onClose,
  queue = [],
  onSelectQueueItem,
}: MediaPlayerDialogProps) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playbackSession, setPlaybackSession] = useState<{
    streamUrl: string
    canSyncProgress: boolean
    playSessionId?: string
    mediaSourceId?: string
    sessionId?: string
  } | null>(null)
  const lastReportedSecondRef = useRef(0)
  const stopReportedRef = useRef(false)

  const streamUrl = playbackSession?.streamUrl ?? item?.streamUrl

  useEffect(() => {
    if (!open) return

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [open, onClose])

  useEffect(() => {
    stopReportedRef.current = false
    lastReportedSecondRef.current = 0
    setPlaybackSession(null)

    if (!open || !item?.streamUrl) return

    let cancelled = false

    void beginPlaybackSession({ data: { id: item.id } })
      .then((session) => {
        if (!cancelled) setPlaybackSession(session)
      })
      .catch(() => {
        if (!cancelled) {
          setPlaybackSession({
            streamUrl: item.streamUrl!,
            canSyncProgress: false,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, item])

  useEffect(() => {
    if (!open || !streamUrl) return
    videoRef.current?.load()
  }, [open, streamUrl])

  useEffect(() => {
    const video = videoRef.current

    if (!video || !open || !item?.streamUrl) return

    function secondsToTicks(seconds: number) {
      return Math.max(0, Math.floor(seconds * 10_000_000))
    }

    function buildPayload(overrides?: {
      isPaused?: boolean
      isStopped?: boolean
      played?: boolean
    }) {
      return {
        id: item.id,
        positionTicks: secondsToTicks(video.currentTime),
        playSessionId: playbackSession?.playSessionId,
        mediaSourceId: playbackSession?.mediaSourceId,
        sessionId: playbackSession?.sessionId,
        isPaused: overrides?.isPaused,
        isStopped: overrides?.isStopped,
        played: overrides?.played,
      }
    }

    function syncProgress(overrides?: {
      isPaused?: boolean
      isStopped?: boolean
      played?: boolean
      force?: boolean
    }) {
      if (!item) return

      const currentSecond = Math.floor(video.currentTime)

      if (!overrides?.force && currentSecond - lastReportedSecondRef.current < 8) return

      lastReportedSecondRef.current = currentSecond
      void reportPlaybackState({ data: buildPayload(overrides) }).catch(() => undefined)
    }

    function handleLoadedMetadata() {
      if (item.playbackPositionTicks) {
        video.currentTime = item.playbackPositionTicks / 10_000_000
      }
    }

    function handleTimeUpdate() {
      if (!playbackSession?.canSyncProgress) return
      syncProgress()
    }

    function handlePause() {
      syncProgress({ isPaused: true, force: true })
    }

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

      const played =
        video.duration && video.currentTime / video.duration >= 0.94 ? true : undefined
      stopReportedRef.current = true
      void reportPlaybackState({
        data: buildPayload({
          isStopped: true,
          played,
        }),
      }).catch(() => undefined)
    }
  }, [open, item, playbackSession, streamUrl])

  if (!open || !item) return null

  return (
    <div className="dialog-backdrop player-backdrop" onClick={onClose} role="presentation">
      <div
        className="player-shell"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="aurora-player-title"
      >
        <div className="player-topbar">
          <div className="player-copy">
            <p className="eyebrow">{t('player.nowPlaying')}</p>
            <h2 id="aurora-player-title">{item.title}</h2>
            <span>
              {buildSubtitle(item, {
                series: t('player.series'),
                episode: t('player.episode'),
                movie: t('player.movie'),
              })}
            </span>
          </div>

          <button
            type="button"
            className="icon-button player-close"
            onClick={onClose}
            aria-label={t('player.close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="player-stage">
          {streamUrl ? (
            <div className="player-layout">
              <video
                ref={videoRef}
                className="player-video"
                controls
                autoPlay
                playsInline
                poster={item.backdropUrl ?? item.posterUrl}
                preload="metadata"
              >
                <source src={streamUrl} />
              </video>

              {queue.length > 1 ? (
                <aside className="player-queue">
                  <div className="player-queue-head">
                    <p className="eyebrow">{t('player.upNext')}</p>
                    <span>{t('player.inQueue', { count: queue.length - 1 })}</span>
                  </div>
                  <div className="player-queue-list">
                    {queue
                      .filter((entry) => entry.id !== item.id)
                      .slice(0, 6)
                      .map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          className="player-queue-item"
                          onClick={() => onSelectQueueItem?.(entry)}
                        >
                          <strong>{entry.title}</strong>
                          <span>
                            {[
                              entry.seriesTitle ??
                                (entry.type === 'series'
                                  ? t('player.series')
                                  : entry.type === 'episode'
                                    ? t('player.episode')
                                    : t('player.movie')),
                              entry.episodeNumber ? `E${entry.episodeNumber}` : null,
                            ]
                              .filter(Boolean)
                              .join(' • ')}
                          </span>
                        </button>
                      ))}
                  </div>
                </aside>
              ) : null}
            </div>
          ) : (
            <div className="player-empty">
              <Film size={28} />
              <p>{t('player.notPlayable')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
