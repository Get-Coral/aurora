import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ArrowLeft, Check, Minus, Plus, Search, X } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { MediaCard } from '../../components/MediaCard'
import { MediaPlayerDialog } from '../../components/MediaPlayerDialog'
import { MediaSpotlightDialog } from '../../components/MediaSpotlightDialog'
import { useFavoriteAction } from '../../components/useFavoriteAction'
import { useI18n } from '../../lib/i18n'
import {
  addToCollectionRuntime,
  fetchCollectionItemsRuntime,
  fetchSearchRuntime,
  fetchSetupStatusRuntime,
  removeFromCollectionRuntime,
} from '../../lib/runtime-functions'
import { useTvMode } from '../../lib/tv-mode'
import type { MediaItem } from '../../lib/media'

export const Route = createFileRoute('/collections/$id')({
  loader: async ({ params, context: { queryClient } }) => {
    const setupStatus = await fetchSetupStatusRuntime()
    if (!setupStatus.configured) throw redirect({ to: '/setup' })
    await queryClient.ensureQueryData({
      queryKey: ['collection-items', params.id],
      queryFn: () => fetchCollectionItemsRuntime({ data: { id: params.id } }),
    })
  },
  component: CollectionDetailPage,
})

function CollectionDetailPage() {
  const { t } = useI18n()
  const { tvMode } = useTvMode()
  const { id } = Route.useParams()
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery({
    queryKey: ['collection-items', id],
    queryFn: () => fetchCollectionItemsRuntime({ data: { id } }),
  })

  const { collection, items } = data
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [playingItem, setPlayingItem] = useState<MediaItem | null>(null)
  const [playQueue, setPlayQueue] = useState<MediaItem[]>([])
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const deferredQuery = useDeferredValue(searchQuery.trim())
  const favoriteMutation = useFavoriteAction()

  const existingIds = new Set(items.map((i) => i.id))

  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ['search', deferredQuery],
    queryFn: () => fetchSearchRuntime({ data: { query: deferredQuery } }),
    enabled: deferredQuery.length > 1,
  })

  const addMutation = useMutation({
    mutationFn: () =>
      addToCollectionRuntime({ data: { collectionId: id, itemIds: Array.from(selectedIds) } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['collection-items', id] })
      setAddDialogOpen(false)
      setSelectedIds(new Set())
      setSearchQuery('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: ({ itemId }: { itemId: string }) =>
      removeFromCollectionRuntime({ data: { collectionId: id, itemId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['collection-items', id] })
    },
  })

  function playMedia(item: MediaItem, queue?: MediaItem[]) {
    if (!item.streamUrl || item.type === 'series') return
    setSelectedItem(null)
    setPlayQueue(queue?.length ? queue : items)
    setPlayingItem(item)
  }

  function handleWatchedChange(id: string, played: boolean) {
    queryClient.setQueryData<{ collection: unknown; items: MediaItem[] }>(
      ['collection-items', params.id],
      (old) => {
        if (!old) return old
        return { ...old, items: old.items.map((i) => (i.id === id ? { ...i, played } : i)) }
      },
    )
  }

  function handleToggleFavorite(item: MediaItem) {
    setSelectedItem((current) =>
      current?.id === item.id ? { ...current, isFavorite: !current.isFavorite } : current,
    )
    favoriteMutation.mutate({ id: item.id, isFavorite: Boolean(item.isFavorite) })
  }

  function toggleSelected(itemId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
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

        {!tvMode ? (
          <div className="library-controls">
            <button
              type="button"
              className="primary-action"
              onClick={() => {
                setAddDialogOpen(true)
                setSelectedIds(new Set())
                setSearchQuery('')
              }}
            >
              <Plus size={16} /> {t('route.collections.addItems')}
            </button>
          </div>
        ) : null}
      </div>

      <div className="page-wrap collection-items-grid">
        {items.map((item, index) => (
          <div key={item.id} className="collection-item-wrap">
            <MediaCard
              item={item}
              priority={index < 8}
              variant="standard"
              onClick={() => setSelectedItem(item)}
              onPlay={playMedia}
              onToggleFavorite={handleToggleFavorite}
            />
            {!tvMode ? (
              <button
                type="button"
                className="collection-remove-btn"
                disabled={removeMutation.isPending}
                onClick={() => removeMutation.mutate({ itemId: item.id })}
                aria-label={t('route.collections.removeItem')}
                title={t('route.collections.removeItem')}
              >
                <Minus size={12} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="page-wrap library-footer library-footer-compact" style={{ marginTop: '3rem' }}>
        <span>{t('library.totalTitles', { count: items.length })}</span>
      </div>

      {/* ── Add items dialog ── */}
      {addDialogOpen ? (
        <div className="coll-dialog-backdrop" onClick={() => setAddDialogOpen(false)} role="presentation">
          <div
            className="coll-dialog coll-dialog-wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="coll-dialog-head">
              <h2>{t('route.collections.addItemsTitle')}</h2>
              <button type="button" className="icon-button" onClick={() => setAddDialogOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="coll-search-bar">
              <Search size={16} />
              <input
                className="coll-search-input"
                placeholder={t('route.collections.addItemsSearch')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>

            <div className="coll-search-results">
              {searching ? (
                <p className="coll-search-hint">{t('search.searching')}</p>
              ) : deferredQuery.length < 2 ? (
                <p className="coll-search-hint">Type at least 2 characters to search</p>
              ) : searchResults.length === 0 ? (
                <p className="coll-search-hint">{t('search.empty')}</p>
              ) : searchResults.map((result) => {
                const alreadyIn = existingIds.has(result.id)
                const selected = selectedIds.has(result.id)
                return (
                  <button
                    key={result.id}
                    type="button"
                    className={`coll-result-row${selected ? ' coll-result-selected' : ''}${alreadyIn ? ' coll-result-existing' : ''}`}
                    onClick={() => !alreadyIn && toggleSelected(result.id)}
                    disabled={alreadyIn}
                  >
                    {result.posterUrl ? (
                      <img src={result.posterUrl} alt="" className="coll-result-thumb" />
                    ) : (
                      <div className="coll-result-thumb coll-result-thumb-fallback" />
                    )}
                    <div className="coll-result-copy">
                      <strong>{result.title}</strong>
                      <span>{[result.year, result.type === 'series' ? t('search.series') : t('search.movie')].filter(Boolean).join(' · ')}</span>
                    </div>
                    <span className="coll-result-check">
                      {alreadyIn ? <Check size={14} /> : selected ? <Check size={14} /> : <Plus size={14} />}
                    </span>
                  </button>
                )
              })}
            </div>

            {addMutation.error ? (
              <p className="detail-empty">{String(addMutation.error)}</p>
            ) : null}

            <div className="coll-dialog-footer">
              <button type="button" className="secondary-action" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={selectedIds.size === 0 || addMutation.isPending}
                onClick={() => addMutation.mutate()}
              >
                <Plus size={14} />
                {addMutation.isPending
                  ? t('route.collections.adding')
                  : `${t('route.collections.addItemsSubmit')} (${selectedIds.size})`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
        onWatchedChange={handleWatchedChange}
      />
    </main>
  )
}
