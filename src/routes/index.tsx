import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { HeroSection } from '../components/HeroSection'
import { MediaPlayerDialog } from '../components/MediaPlayerDialog'
import { MediaSpotlightDialog } from '../components/MediaSpotlightDialog'
import { SectionShelf } from '../components/SectionShelf'
import { useFavoriteAction } from '../components/useFavoriteAction'
import { useI18n } from '../lib/i18n'
import {
  fetchFeatured,
  fetchContinueWatching,
  fetchFavoriteMovies,
  fetchLatestMovies,
  fetchLatestSeries,
  fetchRecommendedFromItem,
} from '../server/functions'
import type { MediaItem } from '../lib/media'

export const Route = createFileRoute('/')({
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.ensureQueryData({ queryKey: ['featured'], queryFn: () => fetchFeatured() }),
      queryClient.ensureQueryData({ queryKey: ['continue-watching'], queryFn: () => fetchContinueWatching() }),
      queryClient.ensureQueryData({ queryKey: ['latest-movies'], queryFn: () => fetchLatestMovies() }),
      queryClient.ensureQueryData({ queryKey: ['latest-series'], queryFn: () => fetchLatestSeries() }),
    ])
  },
  component: HomePage,
})

function HomePage() {
  const { t } = useI18n()
  const { data: featured } = useSuspenseQuery({ queryKey: ['featured'], queryFn: () => fetchFeatured() })
  const { data: continueWatching } = useSuspenseQuery({ queryKey: ['continue-watching'], queryFn: () => fetchContinueWatching() })
  const { data: latestMovies } = useSuspenseQuery({ queryKey: ['latest-movies'], queryFn: () => fetchLatestMovies() })
  const { data: latestSeries } = useSuspenseQuery({ queryKey: ['latest-series'], queryFn: () => fetchLatestSeries() })
  const { data: favoriteMovies = [] } = useQuery({ queryKey: ['favorite-movies'], queryFn: () => fetchFavoriteMovies() })
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null)
  const [playQueue, setPlayQueue] = useState<MediaItem[]>([])
  const favoriteMutation = useFavoriteAction()

  useEffect(() => {
    function handleSelect(event: Event) {
      const customEvent = event as CustomEvent<MediaItem>
      setSelectedItem(customEvent.detail)
    }

    window.addEventListener('aurora:select-media', handleSelect as EventListener)
    return () => window.removeEventListener('aurora:select-media', handleSelect as EventListener)
  }, [])

  const spotlightItem = featured ?? latestMovies[0] ?? latestSeries[0] ?? null
  const { data: recommendedItems = [] } = useQuery({
    queryKey: ['recommended-from-item', spotlightItem?.id],
    queryFn: () => fetchRecommendedFromItem({ data: { id: spotlightItem!.id } }),
    enabled: Boolean(spotlightItem?.id),
  })
  const companionItems = [...continueWatching, ...latestMovies, ...latestSeries]
    .filter((item, index, array) => item.id !== spotlightItem?.id && array.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 5)

  function playMedia(item: MediaItem, queue: MediaItem[] = []) {
    if (!item.streamUrl || item.type === 'series') return
    setSelectedItem(null)
    setPlayQueue(queue.length ? queue : [item])
    setPlayingItem(item)
  }

  function handleToggleFavorite(item: MediaItem) {
    setSelectedItem((current) =>
      current?.id === item.id ? { ...current, isFavorite: !current.isFavorite } : current,
    )
    favoriteMutation.mutate({ id: item.id, isFavorite: Boolean(item.isFavorite) })
  }

  return (
    <main className="home-shell">
      {spotlightItem ? (
        <HeroSection
          item={spotlightItem}
          continueItem={continueWatching[0] ?? null}
          companionItems={companionItems}
          onPlay={() => playMedia(spotlightItem, [spotlightItem, ...recommendedItems])}
          onPlayContinue={(resumeItem) => playMedia(resumeItem, continueWatching)}
          onMoreInfo={() => setSelectedItem(spotlightItem)}
          onSelectCompanion={setSelectedItem}
        />
      ) : null}

      <div className="home-gradient-band" />

      <div className="page-wrap home-sections">
        <section className="overview-band">
          <div className="overview-card">
            <p className="eyebrow">{t('home.libraryPulse')}</p>
            <strong>{latestMovies.length + latestSeries.length}</strong>
            <span>{t('home.libraryPulseCopy')}</span>
          </div>
          <div className="overview-card">
            <p className="eyebrow">{t('home.watchRhythm')}</p>
            <strong>{continueWatching.length}</strong>
            <span>{t('home.watchRhythmCopy')}</span>
          </div>
          <div className="overview-card">
            <p className="eyebrow">{t('home.tonightsLane')}</p>
            <strong>{spotlightItem?.genres[0] ?? t('home.curatedFallback')}</strong>
            <span>{t('home.tonightsLaneCopy')}</span>
          </div>
        </section>

        <SectionShelf
          id="continue"
          title={t('home.continue.title')}
          subtitle={t('home.continue.subtitle')}
          items={continueWatching}
          onSelect={setSelectedItem}
          onPlay={(item) => playMedia(item, continueWatching)}
          onToggleFavorite={handleToggleFavorite}
          emptyTitle={t('home.continue.emptyTitle')}
          emptyCopy={t('home.continue.emptyCopy')}
        />
        <SectionShelf
          id="movies"
          title={t('home.movies.title')}
          subtitle={t('home.movies.subtitle')}
          items={latestMovies}
          onSelect={setSelectedItem}
          onPlay={(item) => playMedia(item, latestMovies)}
          onToggleFavorite={handleToggleFavorite}
          browseTo="/library/movies"
        />
        <SectionShelf
          id="favorites"
          title={t('home.favorites.title')}
          subtitle={t('home.favorites.subtitle')}
          items={favoriteMovies}
          onSelect={setSelectedItem}
          onPlay={(item) => playMedia(item, favoriteMovies)}
          onToggleFavorite={handleToggleFavorite}
          browseTo="/my-list"
          emptyTitle={t('home.favorites.emptyTitle')}
          emptyCopy={t('home.favorites.emptyCopy')}
        />
        <SectionShelf
          id="series"
          title={t('home.series.title')}
          subtitle={t('home.series.subtitle')}
          items={latestSeries}
          onSelect={setSelectedItem}
          onPlay={(item) => playMedia(item, latestSeries)}
          onToggleFavorite={handleToggleFavorite}
          browseTo="/library/series"
        />
        <SectionShelf
          id="recommended"
          title={t('home.recommended.title')}
          subtitle={t('home.recommended.subtitle')}
          items={recommendedItems}
          onSelect={setSelectedItem}
          onPlay={(item) => playMedia(item, recommendedItems)}
          onToggleFavorite={handleToggleFavorite}
          browseTo="/library/movies"
          emptyTitle={t('home.recommended.emptyTitle')}
          emptyCopy={t('home.recommended.emptyCopy')}
        />
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
        onPlay={(item) => playMedia(item, item.type === 'episode' ? [item] : [item, ...recommendedItems])}
        onSelectSimilar={setSelectedItem}
        onToggleFavorite={handleToggleFavorite}
      />
    </main>
  )
}
