import { Play, Star } from 'lucide-react'
import type { MediaItem } from '../lib/media'

interface MediaCardProps {
  item: MediaItem
  onClick?: () => void
  priority?: boolean
}

export function MediaCard({ item, onClick, priority = false }: MediaCardProps) {
  return (
    <div
      className="media-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      {item.backdropUrl ?? item.posterUrl ? (
        <img
          src={item.backdropUrl ?? item.posterUrl}
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
          {item.type === 'series' ? 'Series' : 'Feature'}
        </span>
        {item.rating != null ? (
          <span className="card-rating">
            <Star size={12} fill="currentColor" /> {item.rating.toFixed(1)}
          </span>
        ) : null}
      </div>

      <div className="card-body">
        <div>
          <p className="card-title">{item.title}</p>
          <p className="card-subtitle">
            {[item.year, item.runtimeMinutes ? `${item.runtimeMinutes}m` : null]
              .filter(Boolean)
              .join(' • ') || 'Instantly available'}
          </p>
        </div>

        <span className="card-action">
          <Play size={14} fill="currentColor" />
        </span>
      </div>
    </div>
  )
}
