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
}

export function SectionShelf({
  id,
  title,
  subtitle,
  items,
  onSelect,
  onPlay,
}: SectionShelfProps) {
  if (!items.length) return null

  return (
    <section id={id} className="shelf-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h2 className="section-title">{title}</h2>
        </div>
        <span className="section-trailing">
          Browse more <ChevronRight size={16} />
        </span>
      </div>

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
    </section>
  )
}
