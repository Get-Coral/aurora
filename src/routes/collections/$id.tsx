import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { MediaCard } from '../../components/MediaCard'
import { MediaPlayerDialog } from '../../components/MediaPlayerDialog'
import { MediaSpotlightDialog } from '../../components/MediaSpotlightDialog'
import { useFavoriteAction } from '../../components/useFavoriteAction'
import { useI18n } from '../../lib/i18n'
import type { MediaItem } from '../../lib/media'
import { fetchCollectionItems, fetchSetupStatus } from '../../server/functions'

export const Route = createFileRoute('/collections/$id')({
  loader: async ({ params, context: { queryClient } }) => {
    const setupStatus = await fetchSetupStatus()
    if (!setupStatus.configured) throw redirect({ to: '/setup' })
    await queryClient.ensureQueryData({
      queryKey: ['collection-items', params.id],
      queryFn: () => fetchCollectionItems({ data: { id: params.id } }),
    })
  },
  component: CollectionDetailPage,
})

function CollectionDetailPage() {
  const { t } = useI18n()
  const { id } = Route.useParams()
  const { data } = useSuspenseQuery({
    queryKey: ['collection-items', id],
    queryFn: () => fetchCollectionItems({ data: { id } }),
  })

  const { collection, items } = data
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null)
  const [playQueue, setPlayQueue] = useState<MediaItem[]>([])
  const favoriteMutation = useFavoriteAction()

  function playMedia(item: MediaItem, queue?: MediaItem[]) {
    if (!item.streamUrl || item.type === 'series') return
    setSelectedItem(null)
    setPlayQueue(queue?.length ? queue : items)
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
      {collection.backdropUrl ? (
        <div className="collection-hero">
          <img src={collection.backdropUrl} alt="" className="collection-hero-backdrop" aria-hidden="true" />
          <div className="collection-hero-overlay" />
        </div>
      ) : null}

      <div className="page-wrap library-head" style={{ position: 'relative', zIndex: 1 }}>
        <div className="library-copy">
          <Link to="/collections" className="library-backlink">
            <ArrowLeft size={16} /> {t('route.collections.title')}
          </Link>
          <p className="eyebrow">{t('route.collections.subtitle')}</p>
          <h1 className="library-title">{collection.title}</h1>
          {collection.overview ? (
            <p className="library-summary">{collection.overview}</p>
          ) : null}
          <p className="library-summary" style={{ marginTop: '0.5rem', opacity: 0.6 }}>
            {t('route.collections.itemCount', { count: items.length })}
          </p>
        </div>
      </div>

      <div className="page-wrap library-grid">
        {items.map((item, index) => (
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

      <div className="page-wrap library-footer library-footer-compact" style={{ marginTop: '3rem' }}>
        <span>{t('library.totalTitles', { count: items.length })}</span>
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
