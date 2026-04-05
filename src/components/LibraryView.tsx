import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, SlidersHorizontal, X } from 'lucide-react'
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

type WatchStatus = 'watched' | 'unwatched' | 'inprogress'

interface LibraryViewProps {
  type: LibraryType
  title: string
  subtitle: string
  search: {
    sort?: LibrarySort
    order?: LibrarySortOrder
    ratings?: string
    decade?: string
    minScore?: number
    watchStatus?: WatchStatus
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

const MOVIE_RATINGS = ['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR']
const SERIES_RATINGS = ['TV-G', 'TV-PG', 'TV-14', 'TV-MA', 'NR']
const DECADES = ['2020s', '2010s', '2000s', '1990s', '1980s', 'Older']
const SCORE_OPTIONS = [5, 6, 7, 8, 9]

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
  const ratings = search.ratings ?? ''
  const decade = search.decade ?? ''
  const minScore = search.minScore ?? 0
  const watchStatus = search.watchStatus
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null)
  const [playQueue, setPlayQueue] = useState<MediaItem[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const favoriteMutation = useFavoriteAction()
  const sentinelRef = useRef<HTMLDivElement>(null)

  const activeRatings = ratings ? ratings.split(',').filter(Boolean) : []
  const activeFilterCount =
    (activeRatings.length > 0 ? 1 : 0) + (decade ? 1 : 0) + (minScore > 0 ? 1 : 0) + (watchStatus ? 1 : 0)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['library-infinite', type, sort, order, genre, ratings, decade, minScore, watchStatus],
    queryFn: ({ pageParam }) =>
      fetchLibrary({
        data: {
          type,
          page: pageParam as number,
          sortBy: sort,
          sortOrder: order,
          genre,
          ratings: ratings || undefined,
          decade: decade || undefined,
          minScore: minScore > 0 ? minScore : undefined,
          watchStatus,
        },
      }),
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

  function updateSearch(next: Partial<{
    sort: LibrarySort
    order: LibrarySortOrder
    ratings: string
    decade: string
    minScore: number
    watchStatus: WatchStatus | undefined
  }>) {
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
        ratings: next.ratings !== undefined ? next.ratings : ratings,
        decade: next.decade !== undefined ? next.decade : decade,
        minScore: next.minScore !== undefined ? next.minScore : minScore,
        watchStatus: 'watchStatus' in next ? next.watchStatus : watchStatus,
      },
    })
  }

  function toggleRating(r: string) {
    const current = ratings ? ratings.split(',').filter(Boolean) : []
    const next = current.includes(r) ? current.filter((x) => x !== r) : [...current, r]
    updateSearch({ ratings: next.join(',') })
  }

  function clearFilters() {
    updateSearch({ ratings: '', decade: '', minScore: 0, watchStatus: undefined })
  }

  function playMedia(item: MediaItem, queue?: MediaItem[]) {
    if (!item.streamUrl || item.type === 'series') return
    setSelectedItem(null)
    setPlayQueue(queue?.length ? queue : resolvedItems)
    setPlayingItem(item)
  }

  function handleToggleFavorite(item: MediaItem) {
    setSelectedItem((current) =>
      current?.id === item.id ? { ...current, isFavorite: !current.isFavorite } : current,
    )
    favoriteMutation.mutate({ id: item.id, isFavorite: Boolean(item.isFavorite) })
  }

  const ratingOptions = type === 'Movie' ? MOVIE_RATINGS : SERIES_RATINGS

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

            <div className="library-select-shell">
              <span>{t('library.filter')}</span>
              <button
                type="button"
                className={`filter-toggle${filterOpen ? ' filter-toggle-open' : ''}${activeFilterCount > 0 ? ' filter-toggle-active' : ''}`}
                onClick={() => setFilterOpen((v) => !v)}
                aria-expanded={filterOpen}
              >
                <SlidersHorizontal size={15} />
                {t('library.filters')}
                {activeFilterCount > 0 ? (
                  <span className="filter-badge">{activeFilterCount}</span>
                ) : null}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {mode === 'library' && filterOpen ? (
        <div className="page-wrap filter-panel">
          <div className="filter-section">
            <p className="filter-section-label">{t('library.ageRating')}</p>
            <div className="filter-chip-row">
              {ratingOptions.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`filter-chip${activeRatings.includes(r) ? ' filter-chip-active' : ''}`}
                  onClick={() => toggleRating(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <p className="filter-section-label">{t('library.decade')}</p>
            <div className="filter-chip-row">
              {DECADES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`filter-chip${decade === d ? ' filter-chip-active' : ''}`}
                  onClick={() => updateSearch({ decade: decade === d ? '' : d })}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <p className="filter-section-label">{t('library.minScore')}</p>
            <div className="filter-chip-row">
              <button
                type="button"
                className={`filter-chip${minScore === 0 ? ' filter-chip-active' : ''}`}
                onClick={() => updateSearch({ minScore: 0 })}
              >
                {t('library.anyScore')}
              </button>
              {SCORE_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`filter-chip${minScore === s ? ' filter-chip-active' : ''}`}
                  onClick={() => updateSearch({ minScore: minScore === s ? 0 : s })}
                >
                  {s}+
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <p className="filter-section-label">{t('library.watchStatus')}</p>
            <div className="filter-chip-row">
              {(['unwatched', 'inprogress', 'watched'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`filter-chip${watchStatus === s ? ' filter-chip-active' : ''}`}
                  onClick={() => updateSearch({ watchStatus: watchStatus === s ? undefined : s })}
                >
                  {t(`library.watchStatus.${s}`)}
                </button>
              ))}
            </div>
          </div>

          {activeFilterCount > 0 ? (
            <div className="filter-panel-footer">
              <button type="button" className="filter-clear" onClick={clearFilters}>
                <X size={13} /> {t('library.clearFilters')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeFilterCount > 0 && mode === 'library' ? (
        <div className="page-wrap active-filters-row">
          {activeRatings.map((r) => (
            <button key={r} type="button" className="active-filter-chip" onClick={() => toggleRating(r)}>
              {r} <X size={11} />
            </button>
          ))}
          {decade ? (
            <button type="button" className="active-filter-chip" onClick={() => updateSearch({ decade: '' })}>
              {decade} <X size={11} />
            </button>
          ) : null}
          {minScore > 0 ? (
            <button type="button" className="active-filter-chip" onClick={() => updateSearch({ minScore: 0 })}>
              {minScore}+ ★ <X size={11} />
            </button>
          ) : null}
          {watchStatus ? (
            <button type="button" className="active-filter-chip" onClick={() => updateSearch({ watchStatus: undefined })}>
              {t(`library.watchStatus.${watchStatus}`)} <X size={11} />
            </button>
          ) : null}
        </div>
      ) : null}

      {type === 'Movie' && mode === 'library' ? (
        <div className="page-wrap genre-rail">
          <Link
            to="/library/movies"
            search={{ sort, order, ratings, decade, minScore }}
            className={`genre-pill${!genre ? ' genre-pill-active' : ''}`}
          >
            {t('library.allMovies')}
          </Link>
          {CURATED_MOVIE_GENRES.map((genreOption) => (
            <Link
              key={genreOption}
              to="/library/movies/genre/$genre"
              params={{ genre: genreOption }}
              search={{ sort, order, ratings, decade, minScore }}
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
        {mode === 'library' && resolvedItems.length === 0 && !isFetchingNextPage ? (
          <div className="library-empty">
            <p className="eyebrow">{t('section.readyWhenYouAre')}</p>
            <h3>{t('library.noResults')}</h3>
            {activeFilterCount > 0 ? (
              <button type="button" className="filter-clear" onClick={clearFilters}>
                <X size={13} /> {t('library.clearFilters')}
              </button>
            ) : null}
          </div>
        ) : null}
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
