import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { HeroSection } from '../components/HeroSection'
import { MediaPlayerDialog } from '../components/MediaPlayerDialog'
import { MediaSpotlightDialog } from '../components/MediaSpotlightDialog'
import { SectionShelf } from '../components/SectionShelf'
import {
  fetchFeatured,
  fetchContinueWatching,
  fetchLatestMovies,
  fetchLatestSeries,
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
  const { data: featured } = useSuspenseQuery({ queryKey: ['featured'], queryFn: () => fetchFeatured() })
  const { data: continueWatching } = useSuspenseQuery({ queryKey: ['continue-watching'], queryFn: () => fetchContinueWatching() })
  const { data: latestMovies } = useSuspenseQuery({ queryKey: ['latest-movies'], queryFn: () => fetchLatestMovies() })
  const { data: latestSeries } = useSuspenseQuery({ queryKey: ['latest-series'], queryFn: () => fetchLatestSeries() })
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null)

  useEffect(() => {
    function handleSelect(event: Event) {
      const customEvent = event as CustomEvent<MediaItem>
      setSelectedItem(customEvent.detail)
    }

    window.addEventListener('aurora:select-media', handleSelect as EventListener)
    return () => window.removeEventListener('aurora:select-media', handleSelect as EventListener)
  }, [])

  const spotlightItem = featured ?? latestMovies[0] ?? latestSeries[0] ?? null
  const companionItems = [...continueWatching, ...latestMovies, ...latestSeries]
    .filter((item, index, array) => item.id !== spotlightItem?.id && array.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 5)

  function playMedia(item: MediaItem) {
    if (!item.streamUrl || item.type === 'series') return
    setSelectedItem(null)
    setPlayingItem(item)
  }

  return (
    <main className="home-shell">
      {spotlightItem ? (
        <HeroSection
          item={spotlightItem}
          continueItem={continueWatching[0] ?? null}
          companionItems={companionItems}
          onPlay={() => playMedia(spotlightItem)}
          onMoreInfo={() => setSelectedItem(spotlightItem)}
          onSelectCompanion={setSelectedItem}
        />
      ) : null}

      <div className="home-gradient-band" />

      <div className="page-wrap home-sections">
        <section className="overview-band">
          <div className="overview-card">
            <p className="eyebrow">Library pulse</p>
            <strong>{latestMovies.length + latestSeries.length}</strong>
            <span>fresh arrivals across films and shows</span>
          </div>
          <div className="overview-card">
            <p className="eyebrow">Watch rhythm</p>
            <strong>{continueWatching.length}</strong>
            <span>titles waiting where you left them</span>
          </div>
          <div className="overview-card">
            <p className="eyebrow">Tonight's lane</p>
            <strong>{spotlightItem?.genres[0] ?? 'Curated'}</strong>
            <span>picked from your Jellyfin collection</span>
          </div>
        </section>

        <SectionShelf
          id="continue"
          title="Resume your queue"
          subtitle="Keep momentum"
          items={continueWatching}
          onSelect={setSelectedItem}
          onPlay={playMedia}
          emptyTitle="Your continue queue is still empty"
          emptyCopy="Open a movie or episode from your library and Aurora will surface it here with progress and quick resume."
        />
        <SectionShelf
          id="movies"
          title="Recent movie arrivals"
          subtitle="Freshly added"
          items={latestMovies}
          onSelect={setSelectedItem}
          onPlay={playMedia}
          browseTo="/library/movies"
        />
        <SectionShelf
          id="series"
          title="Series worth diving into"
          subtitle="Just landed"
          items={latestSeries}
          onSelect={setSelectedItem}
          onPlay={playMedia}
          browseTo="/library/series"
        />
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
        onPlay={(item) => playMedia(item)}
        onSelectSimilar={setSelectedItem}
      />
    </main>
  )
}
