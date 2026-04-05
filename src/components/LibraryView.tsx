import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
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
  const { t } = useI18n()
  const navigate = useNavigate()
  const sort = search.sort ?? 'DateCreated'
  const order = search.order ?? 'Descending'
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null)
  const [playQueue, setPlayQueue] = useState<MediaItem[]>([])
  const favoriteMutation = useFavoriteAction()
  const sentinelRef = useRef<HTMLDivElement>(null)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['library-infinite', type, sort, order, genre],
    queryFn: ({ pageParam }) =>
      fetchLibrary({ data: { type, page: pageParam as number, sortBy: sort, sortOrder: order, genre } }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const totalPages = Math.ceil(lastPage.total / 24)
      return lastPage.page + 1 < totalPages ? lastPage.page + 1 : undefined
    },
    enabled: mode === 'library',
  })

  const resolvedItems = mode === 'my-list'
    ? (customItems ?? [])
    : (data?.pages.flatMap((p) => p.items) ?? [])
  const resolvedTotal = mode === 'my-list'
    ? resolvedItems.length
    : (data?.pages[0]?.total ?? 0)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || mode !== 'library') return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage()
        }
      },
      { rootMargin: '400px' },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, mode])

  function updateSearch(next: Partial<{ sort: LibrarySort; order: LibrarySortOrder }>) {
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
            <ArrowLeft size={16} /> {t('library.backHome')}
          </Link>
          <p className="eyebrow">{subtitle}</p>
          <h1 className="library-title">{title}</h1>
          <p className="library-summary">
            {mode === 'my-list'
              ? t('library.myListSummary')
              : t('library.summary', { type: type === 'Movie' ? 'movie' : 'series' })}
          </p>
        </div>

        {mode === 'library' ? (
          <div className="library-controls">
            <label className="library-select-shell">
              <span>{t('library.sortBy')}</span>
              <select
                value={sort}
                className="library-select"
                onChange={(event) => updateSearch({ sort: event.target.value as LibrarySort })}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value === 'DateCreated'
                      ? t('library.sort.dateCreated')
                      : option.value === 'PremiereDate'
                        ? t('library.sort.premiereDate')
                        : option.value === 'CommunityRating'
                          ? t('library.sort.communityRating')
                          : t('library.sort.sortName')}
                  </option>
                ))}
              </select>
            </label>

            <label className="library-select-shell">
              <span>{t('library.direction')}</span>
              <select
                value={order}
                className="library-select"
                onChange={(event) => updateSearch({ order: event.target.value as LibrarySortOrder })}
              >
                <option value="Descending">{t('library.order.desc')}</option>
                <option value="Ascending">{t('library.order.asc')}</option>
              </select>
            </label>
          </div>
        ) : null}
      </div>

      {type === 'Movie' && mode === 'library' ? (
        <div className="page-wrap genre-rail">
          <Link
            to="/library/movies"
            search={{ sort, order }}
            className={`genre-pill${!genre ? ' genre-pill-active' : ''}`}
          >
            {t('library.allMovies')}
          </Link>
          {CURATED_MOVIE_GENRES.map((genreOption) => (
            <Link
              key={genreOption}
              to="/library/movies/genre/$genre"
              params={{ genre: genreOption }}
              search={{ sort, order }}
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

      <div ref={sentinelRef} />

      <div className="page-wrap library-footer library-footer-compact">
        {isFetchingNextPage ? (
          <span className="eyebrow" style={{ opacity: 0.5 }}>{t('search.searching')}</span>
        ) : (
          <span>{t('library.totalTitles', { count: resolvedTotal })}</span>
        )}
      </div>

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
