import { useQueryClient } from '@tanstack/react-query'
import type { MediaItem } from '../lib/media'
import { fetchItemDetails, fetchSeriesDetails } from '../server/functions'

const prefetchedImages = new Set<string>()

function preloadImage(url?: string) {
  if (!url || typeof Image === 'undefined' || prefetchedImages.has(url)) return

  prefetchedImages.add(url)
  const image = new Image()
  image.src = url
}

function preloadMediaImages(item: MediaItem) {
  preloadImage(item.backdropUrl)
  preloadImage(item.posterUrl)
  preloadImage(item.thumbUrl)
  preloadImage(item.logoUrl)
}

export function usePrefetchMediaDetails() {
  const queryClient = useQueryClient()

  return async function prefetchMediaDetails(item: MediaItem) {
    preloadMediaImages(item)

    if (item.type === 'series') {
      const data = await queryClient.prefetchQuery({
        queryKey: ['series-details', item.id],
        queryFn: () => fetchSeriesDetails({ data: { id: item.id } }),
        staleTime: 5 * 60 * 1000,
      })

      void data
      const cached = queryClient.getQueryData<Awaited<ReturnType<typeof fetchSeriesDetails>>>([
        'series-details',
        item.id,
      ])

      if (!cached) return

      preloadMediaImages(cached.item)
      cached.episodes.slice(0, 8).forEach(preloadMediaImages)
      cached.nextUp.slice(0, 4).forEach(preloadMediaImages)
      cached.similar.slice(0, 6).forEach(preloadMediaImages)
      cached.item.cast.slice(0, 10).forEach((person) => preloadImage(person.imageUrl))
      return
    }

    const data = await queryClient.prefetchQuery({
      queryKey: ['item-details', item.id],
      queryFn: () => fetchItemDetails({ data: { id: item.id } }),
      staleTime: 5 * 60 * 1000,
    })

    void data
    const cached = queryClient.getQueryData<Awaited<ReturnType<typeof fetchItemDetails>>>([
      'item-details',
      item.id,
    ])

    if (!cached) return

    preloadMediaImages(cached.item)
    cached.similar.slice(0, 6).forEach(preloadMediaImages)
    cached.item.cast.slice(0, 10).forEach((person) => preloadImage(person.imageUrl))
  }
}
