import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { HeroSection } from '../components/HeroSection'
import { MediaPlayerDialog } from '../components/MediaPlayerDialog'
import { MediaSpotlightDialog } from '../components/MediaSpotlightDialog'
import { SectionShelf } from '../components/SectionShelf'
import { useFavoriteAction } from '../components/useFavoriteAction'
import { useI18n } from '../lib/i18n'
import {
  fetchContinueWatchingRuntime,
  fetchFavoriteMoviesRuntime,
  fetchFeaturedRuntime,
  fetchLatestMoviesRuntime,
  fetchLatestSeriesRuntime,
  fetchMostPlayedRuntime,
  fetchRecommendedFromItemRuntime,
  fetchSetupStatusRuntime,
} from '../lib/runtime-functions'
import { useTvMode } from '../lib/tv-mode'
import type { MediaItem } from '../lib/media'

function hasGenre(item: MediaItem, genre: string) {
  return item.genres.some((candidate) => candidate.toLowerCase() === genre.toLowerCase())
}

function getSpotlightInsights(
  t: (key: string, params?: Record<string, string | number | undefined>) => string,
  spotlightItem: MediaItem | null,
  continueWatching: MediaItem[],
  favoriteMovies: MediaItem[],
  latestMovies: MediaItem[],
  latestSeries: MediaItem[],
) {
  const genre = spotlightItem?.genres[0]

  if (!spotlightItem || !genre) {
    return [{
      label: t('home.pickReason'),
      value: t('home.pickReasonFallbackValue'),
      copy: t('home.pickReasonFallbackCopy'),
    }]
  }

  const insights: Array<{ label: string; value: string; copy: string }> = []

  const queueMatches = continueWatching.filter((item) => item.id !== spotlightItem.id && hasGenre(item, genre))
  if (queueMatches.length > 0) {
    insights.push({
      label: t('home.pickReason'),
      value: genre,
      copy: t('home.pickReasonQueueCopy', { count: queueMatches.length, genre }),
    })
  }

  const favoriteMatches = favoriteMovies.filter((item) => item.id !== spotlightItem.id && hasGenre(item, genre))
  if (favoriteMatches.length > 0) {
    insights.push({
      label: t('home.pickReason'),
      value: genre,
      copy: t('home.pickReasonFavoritesCopy', { count: favoriteMatches.length, genre }),
    })
  }

  const recentMatches = [...latestMovies, ...latestSeries]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .filter((item) => item.id !== spotlightItem.id && hasGenre(item, genre))

  if (recentMatches.length > 0) {
    insights.push({
      label: t('home.pickReason'),
      value: genre,
      copy: t('home.pickReasonRecentCopy', { count: recentMatches.length, genre }),
    })
  }

  if (insights.length === 0) {
    insights.push({
      label: t('home.pickReason'),
      value: genre,
      copy: t('home.pickReasonFallbackCopy'),
    })
  }

  return insights
}

export const Route = createFileRoute('/')({
  loader: async ({ context: { queryClient } }) => {
    const setupStatus = await fetchSetupStatusRuntime()

    if (!setupStatus.configured) {
      throw redirect({ to: '/setup' })
    }

    await Promise.all([
      queryClient.ensureQueryData({ queryKey: ['featured'], queryFn: () => fetchFeaturedRuntime() }),
      queryClient.ensureQueryData({ queryKey: ['continue-watching'], queryFn: () => fetchContinueWatchingRuntime() }),
      queryClient.ensureQueryData({ queryKey: ['latest-movies'], queryFn: () => fetchLatestMoviesRuntime() }),
      queryClient.ensureQueryData({ queryKey: ['latest-series'], queryFn: () => fetchLatestSeriesRuntime() }),
    ])
  },
  component: HomePage,
})

function HomePage() {
  const { t } = useI18n()
  const { data: featured } = useSuspenseQuery({ queryKey: ['featured'], queryFn: () => fetchFeaturedRuntime() })
  const { data: continueWatching } = useSuspenseQuery({ queryKey: ['continue-watching'], queryFn: () => fetchContinueWatchingRuntime() })
  const { data: latestMovies } = useSuspenseQuery({ queryKey: ['latest-movies'], queryFn: () => fetchLatestMoviesRuntime() })
  const { data: latestSeries } = useSuspenseQuery({ queryKey: ['latest-series'], queryFn: () => fetchLatestSeriesRuntime() })
  const { data: favoriteMovies = [] } = useQuery({ queryKey: ['favorite-movies'], queryFn: () => fetchFavoriteMoviesRuntime() })
  const { data: mostPlayed = [] } = useQuery({ queryKey: ['most-played'], queryFn: () => fetchMostPlayedRuntime() })
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null)
  const [playQueue, setPlayQueue] = useState<MediaItem[]>([])
  const [heroIndex, setHeroIndex] = useState(0)
  const [insightIndex, setInsightIndex] = useState(0)
  const [screensaverActive, setScreensaverActive] = useState(false)
  const [screensaverTime, setScreensaverTime] = useState('')
  const { tvMode } = useTvMode()
  const favoriteMutation = useFavoriteAction()
  const queryClient = useQueryClient()
  const heroTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const insightTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastInteractionRef = useRef(Date.now())
  const screensaverCheckRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const screensaverClockRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    function handleSelect(event: Event) {
      const customEvent = event as CustomEvent<MediaItem>
      setSelectedItem(customEvent.detail)
    }

    window.addEventListener('aurora:select-media', handleSelect as EventListener)
    return () => window.removeEventListener('aurora:select-media', handleSelect as EventListener)
  }, [])

  const heroPool = [
    ...(featured ? [featured] : []),
    ...latestMovies,
    ...latestSeries,
  ].filter((item, index, arr) => arr.findIndex((c) => c.id === item.id) === index)

  useEffect(() => {
    if (heroTimerRef.current) clearInterval(heroTimerRef.current)
    if (tvMode && heroPool.length > 1) {
      heroTimerRef.current = setInterval(() => {
        setHeroIndex((i) => (i + 1) % heroPool.length)
      }, 15000)
    }
    return () => {
      if (heroTimerRef.current) clearInterval(heroTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvMode, heroPool.length])

  // Screensaver: activate after 3 min of no interaction; only when not playing
  useEffect(() => {
    const TIMEOUT_MS = 3 * 60 * 1000

    function resetInteraction() {
      lastInteractionRef.current = Date.now()
      if (screensaverActive) setScreensaverActive(false)
    }

    screensaverCheckRef.current = setInterval(() => {
      if (playingItem) return
      if (Date.now() - lastInteractionRef.current >= TIMEOUT_MS) setScreensaverActive(true)
    }, 10_000)

    window.addEventListener('mousemove', resetInteraction)
    window.addEventListener('keydown', resetInteraction)
    window.addEventListener('touchstart', resetInteraction)
    window.addEventListener('click', resetInteraction)

    return () => {
      if (screensaverCheckRef.current) clearInterval(screensaverCheckRef.current)
      window.removeEventListener('mousemove', resetInteraction)
      window.removeEventListener('keydown', resetInteraction)
      window.removeEventListener('touchstart', resetInteraction)
      window.removeEventListener('click', resetInteraction)
    }
  }, [screensaverActive, playingItem])

  // Screensaver clock
  useEffect(() => {
    if (!screensaverActive) {
      if (screensaverClockRef.current) clearInterval(screensaverClockRef.current)
      return
    }
    function updateClock() {
      setScreensaverTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    }
    updateClock()
    screensaverClockRef.current = setInterval(updateClock, 1000)
    return () => { if (screensaverClockRef.current) clearInterval(screensaverClockRef.current) }
  }, [screensaverActive])

  const spotlightItem = heroPool[heroIndex % Math.max(heroPool.length, 1)] ?? null
  const { data: recommendedItems = [] } = useQuery({
    queryKey: ['recommended-from-item', spotlightItem?.id],
    queryFn: () => fetchRecommendedFromItemRuntime({ data: { id: spotlightItem!.id } }),
    enabled: Boolean(spotlightItem?.id),
  })
  const companionItems = [...continueWatching, ...latestMovies, ...latestSeries]
    .filter((item, index, array) => item.id !== spotlightItem?.id && array.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 5)
  const spotlightInsights = getSpotlightInsights(
    t,
    spotlightItem,
    continueWatching,
    favoriteMovies,
    latestMovies,
    latestSeries,
  )
  const spotlightInsight = spotlightInsights[insightIndex % Math.max(spotlightInsights.length, 1)]

  useEffect(() => {
    setInsightIndex(0)
  }, [spotlightItem?.id])

  useEffect(() => {
    if (insightTimerRef.current) clearInterval(insightTimerRef.current)
    if (tvMode || spotlightInsights.length <= 1) {
      return () => {
        if (insightTimerRef.current) clearInterval(insightTimerRef.current)
      }
    }

    insightTimerRef.current = setInterval(() => {
      setInsightIndex((current) => (current + 1) % spotlightInsights.length)
    }, 5000)

    return () => {
      if (insightTimerRef.current) clearInterval(insightTimerRef.current)
    }
  }, [tvMode, spotlightInsights.length, spotlightItem?.id])

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

  function handleWatchedChange(id: string, played: boolean) {
    // Patch every home-page query cache that might contain this item
    const patchList = (items: MediaItem[]) =>
      items.map((i) => (i.id === id ? { ...i, played } : i))

    queryClient.setQueriesData<MediaItem[]>({ queryKey: ['continue-watching'] }, (old) =>
      old ? patchList(old) : old,
    )
    queryClient.setQueriesData<MediaItem[]>({ queryKey: ['latest-movies'] }, (old) =>
      old ? patchList(old) : old,
    )
    queryClient.setQueriesData<MediaItem[]>({ queryKey: ['latest-series'] }, (old) =>
      old ? patchList(old) : old,
    )
    queryClient.setQueriesData<MediaItem[]>({ queryKey: ['favorite-movies'] }, (old) =>
      old ? patchList(old) : old,
    )
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
        {!tvMode ? (
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
              <p className="eyebrow">{spotlightInsight.label}</p>
              <strong>{spotlightInsight.value}</strong>
              <span>{spotlightInsight.copy}</span>
            </div>
          </section>
        ) : null}

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
        {mostPlayed.length > 0 ? (
          <SectionShelf
            id="most-played"
            title={t('home.mostPlayed.title')}
            subtitle={t('home.mostPlayed.subtitle')}
            items={mostPlayed}
            onSelect={setSelectedItem}
            onPlay={(item) => playMedia(item, mostPlayed)}
            onToggleFavorite={handleToggleFavorite}
            browseTo="/history"
          />
        ) : null}
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
        onPlay={(item, queue) => playMedia(item, queue ?? (item.type === 'episode' ? [item] : [item, ...recommendedItems]))}
        onSelectSimilar={setSelectedItem}
        onToggleFavorite={handleToggleFavorite}
        onWatchedChange={handleWatchedChange}
      />

      {screensaverActive && spotlightItem ? (
        <div className="screensaver-shell" onClick={() => setScreensaverActive(false)}>
          {spotlightItem.backdropUrl ? (
            <img src={spotlightItem.backdropUrl} alt="" className="screensaver-backdrop" />
          ) : null}
          <div className="screensaver-overlay" />
          <div className="screensaver-clock">{screensaverTime}</div>
          <div className="screensaver-title">
            <p className="eyebrow">{spotlightItem.genres[0] ?? ''}</p>
            <strong>{spotlightItem.title}</strong>
          </div>
        </div>
      ) : null}
    </main>
  )
}
