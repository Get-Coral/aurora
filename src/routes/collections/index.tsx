import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ArrowLeft, Layers } from 'lucide-react'
import { useState } from 'react'
import { MediaPlayerDialog } from '../../components/MediaPlayerDialog'
import { MediaSpotlightDialog } from '../../components/MediaSpotlightDialog'
import { useFavoriteAction } from '../../components/useFavoriteAction'
import { useI18n } from '../../lib/i18n'
import type { MediaItem } from '../../lib/media'
import { fetchCollections, fetchSetupStatus } from '../../server/functions'

export const Route = createFileRoute('/collections/')({
  loader: async ({ context: { queryClient } }) => {
    const setupStatus = await fetchSetupStatus()
    if (!setupStatus.configured) throw redirect({ to: '/setup' })
    await queryClient.ensureQueryData({
      queryKey: ['collections'],
      queryFn: () => fetchCollections(),
    })
  },
  component: CollectionsPage,
})

function CollectionsPage() {
  const { t } = useI18n()
  const { data: collections = [] } = useSuspenseQuery({
    queryKey: ['collections'],
    queryFn: () => fetchCollections(),
  })
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null)
  const favoriteMutation = useFavoriteAction()

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
          <p className="eyebrow">{t('route.collections.subtitle')}</p>
          <h1 className="library-title">{t('route.collections.title')}</h1>
          <p className="library-summary">{t('route.collections.summary')}</p>
        </div>
      </div>

      {collections.length === 0 ? (
        <div className="page-wrap">
          <div className="library-empty">
            <p className="eyebrow">{t('section.readyWhenYouAre')}</p>
            <h3>{t('route.collections.emptyTitle')}</h3>
            <p>{t('route.collections.emptyCopy')}</p>
          </div>
        </div>
      ) : (
        <div className="page-wrap collection-grid">
          {collections.map((collection) => (
            <Link
              key={collection.id}
              to="/collections/$id"
              params={{ id: collection.id }}
              className="collection-card"
            >
              {collection.posterUrl ? (
                <img
                  src={collection.posterUrl}
                  alt={collection.title}
                  className="collection-card-poster"
                  loading="lazy"
                />
              ) : (
                <div className="collection-card-poster collection-card-fallback">
                  <Layers size={32} />
                </div>
              )}
              <div className="collection-card-info">
                <strong className="collection-card-title">{collection.title}</strong>
                {collection.childCount != null ? (
                  <span className="collection-card-count">
                    {t('route.collections.itemCount', { count: collection.childCount })}
                  </span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}

      <MediaPlayerDialog
        item={playingItem}
        open={playingItem != null}
        onClose={() => setPlayingItem(null)}
      />

      <MediaSpotlightDialog
        item={selectedItem}
        open={selectedItem != null}
        onClose={() => setSelectedItem(null)}
        onPlay={(item) => {
          if (!item.streamUrl || item.type === 'series') return
          setSelectedItem(null)
          setPlayingItem(item)
        }}
        onSelectSimilar={setSelectedItem}
        onToggleFavorite={handleToggleFavorite}
      />
    </main>
  )
}
