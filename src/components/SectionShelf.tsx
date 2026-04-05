import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import type { MediaItem } from '../lib/media'
import { MediaCard } from './MediaCard'

interface SectionShelfProps {
  id: string
  title: string
  subtitle: string
  items: MediaItem[]
  onSelect: (item: MediaItem) => void
  onPlay: (item: MediaItem) => void
  browseTo?: '/library/movies' | '/library/series'
  emptyTitle?: string
  emptyCopy?: string
}

export function SectionShelf({
  id,
  title,
  subtitle,
  items,
  onSelect,
  onPlay,
  browseTo,
  emptyTitle,
  emptyCopy,
}: SectionShelfProps) {
  return (
    <section id={id} className="shelf-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h2 className="section-title">{title}</h2>
        </div>
        {browseTo ? (
          <Link
            to={browseTo}
            search={{ page: 0, sort: 'DateCreated' }}
            className="section-trailing section-trailing-button"
          >
            Browse more <ChevronRight size={16} />
          </Link>
        ) : null}
      </div>

      {items.length ? (
        <div className="shelf-grid">
          {items.map((item, index) => (
            <MediaCard
              key={item.id}
              item={item}
              priority={index < 4}
              variant={index === 0 ? 'feature' : index < 3 ? 'poster' : 'standard'}
              onClick={() => onSelect(item)}
              onPlay={onPlay}
            />
          ))}
        </div>
      ) : (
        <div className="empty-shelf">
          <div className="empty-shelf-copy">
            <p className="eyebrow">Ready when you are</p>
            <h3>{emptyTitle ?? 'Nothing here yet'}</h3>
            <p>
              {emptyCopy ??
                'Start a title and your in-progress picks will show up here for quick access.'}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
