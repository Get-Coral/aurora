import { Film, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { MediaItem } from '../lib/media'

interface MediaPlayerDialogProps {
  item: MediaItem | null
  open: boolean
  onClose: () => void
}

function buildSubtitle(item: MediaItem) {
  return [
    item.type === 'series' ? 'Series' : item.type === 'episode' ? 'Episode' : 'Movie',
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
}: MediaPlayerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!open) return

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !item?.streamUrl) return
    videoRef.current?.load()
  }, [open, item])

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
            <p className="eyebrow">Now playing</p>
            <h2 id="aurora-player-title">{item.title}</h2>
            <span>{buildSubtitle(item)}</span>
          </div>

          <button
            type="button"
            className="icon-button player-close"
            onClick={onClose}
            aria-label="Close player"
          >
            <X size={18} />
          </button>
        </div>

        <div className="player-stage">
          {item.streamUrl ? (
            <video
              ref={videoRef}
              className="player-video"
              controls
              autoPlay
              playsInline
              poster={item.backdropUrl ?? item.posterUrl}
              preload="metadata"
            >
              <source src={item.streamUrl} />
            </video>
          ) : (
            <div className="player-empty">
              <Film size={28} />
              <p>This title is not directly playable yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
