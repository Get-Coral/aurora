import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { MediaItem } from '../lib/media'
import { fetchLibrary } from '../server/functions'
import { MediaCard } from './MediaCard'
import { MediaPlayerDialog } from './MediaPlayerDialog'
import { MediaSpotlightDialog } from './MediaSpotlightDialog'

type LibraryType = 'Movie' | 'Series'
type LibrarySort = 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'

interface LibraryViewProps {
  type: LibraryType
  title: string
  subtitle: string
  search: {
    page?: number
    sort?: LibrarySort
  }
}

const SORT_OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: 'DateCreated', label: 'Recently added' },
  { value: 'PremiereDate', label: 'Release date' },
  { value: 'CommunityRating', label: 'Top rated' },
  { value: 'SortName', label: 'Alphabetical' },
]

export function LibraryView({
  type,
  title,
  subtitle,
  search,
}: LibraryViewProps) {
  const navigate = useNavigate()
  const page = search.page ?? 0
  const sort = search.sort ?? 'DateCreated'
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null)

  const { data } = useSuspenseQuery({
    queryKey: ['library', type, page, sort],
    queryFn: () => fetchLibrary({ data: { type, page, sortBy: sort } }),
  })

  const totalPages = Math.max(1, Math.ceil(data.total / 24))

  function updateSearch(next: Partial<{ page: number; sort: LibrarySort }>) {
    void navigate({
      to: type === 'Movie' ? '/library/movies' : '/library/series',
      search: {
        page: next.page ?? page,
        sort: next.sort ?? sort,
      },
    })
  }

  function playMedia(item: MediaItem) {
    if (!item.streamUrl || item.type === 'series') return
    setSelectedItem(null)
    setPlayingItem(item)
  }

  return (
    <main className="library-shell">
      <div className="page-wrap library-head">
        <div className="library-copy">
          <Link to="/" className="library-backlink">
            <ArrowLeft size={16} /> Back home
          </Link>
          <p className="eyebrow">{subtitle}</p>
          <h1 className="library-title">{title}</h1>
          <p className="library-summary">
            Explore your full {type === 'Movie' ? 'movie' : 'series'} library with sort controls
            and a scannable grid.
          </p>
        </div>

        <div className="library-controls">
          <label className="library-select-shell">
            <span>Sort by</span>
            <select
              value={sort}
              className="library-select"
              onChange={(event) => updateSearch({ sort: event.target.value as LibrarySort, page: 0 })}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="library-pagination">
            <button
              type="button"
              className="icon-button"
              onClick={() => updateSearch({ page: Math.max(0, page - 1) })}
              disabled={page === 0}
              aria-label="Previous page"
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => updateSearch({ page: Math.min(totalPages - 1, page + 1) })}
              disabled={page >= totalPages - 1}
              aria-label="Next page"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="page-wrap library-grid">
        {data.items.map((item, index) => (
          <MediaCard
            key={item.id}
            item={item}
            priority={index < 8}
            variant={index % 7 === 0 ? 'feature' : index % 3 === 0 ? 'poster' : 'standard'}
            onClick={() => setSelectedItem(item)}
            onPlay={playMedia}
          />
        ))}
      </div>

      <div className="page-wrap library-footer">
        <button
          type="button"
          className="secondary-action"
          onClick={() => updateSearch({ page: Math.max(0, page - 1) })}
          disabled={page === 0}
        >
          Previous page
        </button>
        <span>{data.total} total titles</span>
        <button
          type="button"
          className="secondary-action"
          onClick={() => updateSearch({ page: Math.min(totalPages - 1, page + 1) })}
          disabled={page >= totalPages - 1}
        >
          Next page
        </button>
      </div>

      <MediaPlayerDialog
        item={playingItem}
        open={playingItem != null}
        onClose={() => setPlayingItem(null)}
      />

      <MediaSpotlightDialog
        item={selectedItem}
        open={selectedItem != null}
        onClose={() => setSelectedItem(null)}
        onPlay={playMedia}
      />
    </main>
  )
}
