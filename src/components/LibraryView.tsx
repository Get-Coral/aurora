import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { MediaItem } from '../lib/media'
import { CURATED_MOVIE_GENRES } from '../lib/genres'
import { fetchLibrary } from '../server/functions'
import { MediaCard } from './MediaCard'
import { MediaPlayerDialog } from './MediaPlayerDialog'
import { MediaSpotlightDialog } from './MediaSpotlightDialog'
import { useFavoriteAction } from './useFavoriteAction'

type LibraryType = 'Movie' | 'Series'
type LibrarySort = 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'
type LibrarySortOrder = 'Ascending' | 'Descending'

interface LibraryViewProps {
  type: LibraryType
  title: string
  subtitle: string
  search: {
    page?: number
    sort?: LibrarySort
    order?: LibrarySortOrder
  }
  genre?: string
  mode?: 'library' | 'my-list'
  customItems?: MediaItem[]
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
  genre,
  mode = 'library',
  customItems,
}: LibraryViewProps) {
  const navigate = useNavigate()
  const page = search.page ?? 0
  const sort = search.sort ?? 'DateCreated'
  const order = search.order ?? 'Descending'
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null)
  const [playQueue, setPlayQueue] = useState<MediaItem[]>([])
  const favoriteMutation = useFavoriteAction()

  const { data } = useQuery({
    queryKey: ['library', type, page, sort, order, genre],
    queryFn: () => fetchLibrary({ data: { type, page, sortBy: sort, sortOrder: order, genre } }),
    enabled: mode === 'library',
  })

  const resolvedItems = mode === 'my-list' ? (customItems ?? []) : (data?.items ?? [])
  const resolvedTotal = mode === 'my-list' ? resolvedItems.length : (data?.total ?? 0)

  const totalPages = Math.max(1, Math.ceil(resolvedTotal / 24))

  function updateSearch(next: Partial<{ page: number; sort: LibrarySort; order: LibrarySortOrder }>) {
    if (mode === 'my-list') return

    void navigate({
      to:
        type === 'Movie'
          ? genre
            ? '/library/movies/genre/$genre'
            : '/library/movies'
          : '/library/series',
      params: genre ? { genre } : undefined,
      search: {
        page: next.page ?? page,
        sort: next.sort ?? sort,
        order: next.order ?? order,
      },
    })
  }

  function playMedia(item: MediaItem) {
    if (!item.streamUrl || item.type === 'series') return
    setSelectedItem(null)
    setPlayQueue(resolvedItems)
    setPlayingItem(item)
  }

  function handleToggleFavorite(item: MediaItem) {
    setSelectedItem((current) =>
      current?.id === item.id ? { ...current, isFavorite: !current.isFavorite } : current,
    )
    favoriteMutation.mutate({ id: item.id, isFavorite: Boolean(item.isFavorite) })
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
            {mode === 'my-list'
              ? 'Everything you marked as a favorite in Jellyfin, collected into one streaming-style list.'
              : `Explore your full ${type === 'Movie' ? 'movie' : 'series'} library with sort controls and a scannable grid.`}
          </p>
        </div>

        {mode === 'library' ? (
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

            <label className="library-select-shell">
              <span>Direction</span>
              <select
                value={order}
                className="library-select"
                onChange={(event) => updateSearch({ order: event.target.value as LibrarySortOrder, page: 0 })}
              >
                <option value="Descending">Descending</option>
                <option value="Ascending">Ascending</option>
              </select>
            </label>

            {totalPages > 1 ? (
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
            ) : null}
          </div>
        ) : null}
      </div>

      {type === 'Movie' && mode === 'library' ? (
        <div className="page-wrap genre-rail">
          <Link
            to="/library/movies"
            search={{ page: 0, sort, order }}
            className={`genre-pill${!genre ? ' genre-pill-active' : ''}`}
          >
            All movies
          </Link>
          {CURATED_MOVIE_GENRES.map((genreOption) => (
            <Link
              key={genreOption}
              to="/library/movies/genre/$genre"
              params={{ genre: genreOption }}
              search={{ page: 0, sort, order }}
              className={`genre-pill${genreOption === genre ? ' genre-pill-active' : ''}`}
            >
              {genreOption}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="page-wrap library-grid">
        {resolvedItems.map((item, index) => (
          <MediaCard
            key={item.id}
            item={item}
            priority={index < 8}
            variant={index % 7 === 0 ? 'feature' : index % 3 === 0 ? 'poster' : 'standard'}
            onClick={() => setSelectedItem(item)}
            onPlay={playMedia}
            onToggleFavorite={handleToggleFavorite}
          />
        ))}
      </div>

      {totalPages > 1 ? (
        <div className="page-wrap library-footer">
          <button
            type="button"
            className="secondary-action"
            onClick={() => updateSearch({ page: Math.max(0, page - 1) })}
            disabled={page === 0 || mode === 'my-list'}
          >
            Previous page
          </button>
          <span>{resolvedTotal} total titles</span>
          <button
            type="button"
            className="secondary-action"
            onClick={() => updateSearch({ page: Math.min(totalPages - 1, page + 1) })}
            disabled={page >= totalPages - 1 || mode === 'my-list'}
          >
            Next page
          </button>
        </div>
      ) : (
        <div className="page-wrap library-footer library-footer-compact">
          <span>{resolvedTotal} total titles</span>
        </div>
      )}

      <MediaPlayerDialog
        item={playingItem}
        open={playingItem != null}
        onClose={() => setPlayingItem(null)}
        queue={playQueue}
        onSelectQueueItem={setPlayingItem}
      />

      <MediaSpotlightDialog
        item={selectedItem}
        open={selectedItem != null}
        onClose={() => setSelectedItem(null)}
        onPlay={playMedia}
        onSelectSimilar={setSelectedItem}
        onToggleFavorite={handleToggleFavorite}
      />
    </main>
  )
}
