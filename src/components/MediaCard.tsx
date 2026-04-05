import { Check, Heart, Info, Play, Plus, Star } from 'lucide-react'
import type { MediaItem } from '../lib/media'

interface MediaCardProps {
  item: MediaItem
  onClick?: () => void
  priority?: boolean
  variant?: 'feature' | 'poster' | 'standard'
  onPlay?: (item: MediaItem) => void
  onToggleFavorite?: (item: MediaItem) => void
}

export function MediaCard({
  item,
  onClick,
  priority = false,
  variant = 'standard',
  onPlay,
  onToggleFavorite,
}: MediaCardProps) {
  return (
    <div
      className={`media-card media-card-${variant}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      {item.backdropUrl ?? item.posterUrl ? (
        <img
          src={variant === 'poster' ? item.posterUrl ?? item.backdropUrl : item.backdropUrl ?? item.posterUrl}
          alt={item.title}
          loading={priority ? 'eager' : 'lazy'}
        />
      ) : (
        <div className="media-card-fallback">
          <span>{item.title.slice(0, 1)}</span>
        </div>
      )}

      <div className="card-overlay" />

      {item.progress != null && item.progress > 0 && (
        <div className="absolute bottom-0 left-0 right-0">
          <div className="progress-bar" style={{ borderRadius: 0 }}>
            <div className="progress-bar-fill" style={{ width: `${item.progress}%` }} />
          </div>
        </div>
      )}

      <div className="card-topline">
        <span className="card-format">
          {item.type === 'series' ? 'Series' : variant === 'feature' ? 'Tonight' : 'Feature'}
        </span>
        <div className="card-badges">
          {item.isFavorite ? (
            <span className="card-favorite">
              <Heart size={12} fill="currentColor" /> Favorite
            </span>
          ) : null}
          {item.rating != null ? (
            <span className="card-rating">
              <Star size={12} fill="currentColor" /> {item.rating.toFixed(1)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="card-hover-actions">
        <button
          type="button"
          className="card-action-button card-action-primary"
          onClick={(event) => {
            event.stopPropagation()
            onPlay?.(item)
          }}
        >
          <Play size={14} fill="currentColor" /> Play
        </button>
        <button
          type="button"
          className="card-action-button"
          onClick={(event) => {
            event.stopPropagation()
            onClick?.()
          }}
        >
          <Info size={14} /> Details
        </button>
        <button
          type="button"
          className="card-action-button"
          onClick={(event) => {
            event.stopPropagation()
            onToggleFavorite?.(item)
          }}
        >
          {item.isFavorite ? (
            <>
              <Check size={14} /> In My List
            </>
          ) : (
            <>
              <Plus size={14} /> My List
            </>
          )}
        </button>
      </div>

      <div className="card-body">
        <div>
          <p className="card-title">{item.title}</p>
          <p className="card-subtitle">
            {[item.year, item.ageRating, item.runtimeMinutes ? `${item.runtimeMinutes}m` : null]
              .filter(Boolean)
              .join(' • ') || 'Instantly available'}
          </p>
        </div>

        <span className="card-action" aria-hidden="true">
          <Play size={14} fill="currentColor" />
        </span>
      </div>
    </div>
  )
}
