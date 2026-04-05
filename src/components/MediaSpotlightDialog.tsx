import { Play, Star, X } from 'lucide-react'
import type { MediaItem } from '../lib/media'

interface MediaSpotlightDialogProps {
  item: MediaItem | null
  open: boolean
  onClose: () => void
  onPlay?: (item: MediaItem) => void
}

function formatRuntime(minutes?: number) {
  if (!minutes) return null
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`
}

export function MediaSpotlightDialog({
  item,
  open,
  onClose,
  onPlay,
}: MediaSpotlightDialogProps) {
  if (!open || !item) return null

  const metadata = [
    item.year,
    formatRuntime(item.runtimeMinutes),
    item.ageRating,
  ].filter(Boolean)

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="dialog-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="aurora-dialog-title"
      >
        <button
          type="button"
          className="icon-button dialog-close"
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={18} />
        </button>

        <div className="dialog-hero">
          {item.backdropUrl ? (
            <img src={item.backdropUrl} alt="" className="dialog-hero-image" />
          ) : (
            <div className="dialog-hero-fallback" />
          )}
          <div className="dialog-hero-overlay" />
        </div>

        <div className="dialog-body">
          <div className="dialog-copy">
            <p className="eyebrow">
              {item.type === 'series' ? 'Series spotlight' : 'Movie spotlight'}
            </p>
            <h2 id="aurora-dialog-title" className="dialog-title">
              {item.title}
            </h2>

            <div className="dialog-meta">
              {metadata.map((entry) => (
                <span key={entry}>{entry}</span>
              ))}
              {item.rating != null ? (
                <span className="dialog-rating">
                  <Star size={14} fill="currentColor" /> {item.rating.toFixed(1)}
                </span>
              ) : null}
            </div>

            {item.overview ? (
              <p className="dialog-overview">{item.overview}</p>
            ) : (
              <p className="dialog-overview">
                No synopsis is available for this title yet.
              </p>
            )}

            {item.genres.length ? (
              <div className="chip-row">
                {item.genres.slice(0, 5).map((genre) => (
                  <span key={genre} className="genre-chip">
                    {genre}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="dialog-sidebar">
            {item.posterUrl ? (
              <img src={item.posterUrl} alt={item.title} className="dialog-poster" />
            ) : (
              <div className="dialog-poster dialog-poster-fallback">
                <span>{item.title.slice(0, 1)}</span>
              </div>
            )}

            <button
              type="button"
              className="primary-action"
              onClick={() => onPlay?.(item)}
              disabled={!onPlay}
            >
              <Play size={18} fill="currentColor" /> Play now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
