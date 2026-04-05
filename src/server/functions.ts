import { createServerFn } from '@tanstack/react-start'
import {
  getContinueWatching,
  getLatestMedia,
  getLibraryItems,
  getItem,
  getFeaturedItem,
  getSimilarItems,
  searchItems,
} from '../lib/jellyfin'
import { fromJellyfin, fromJellyfinDetailed } from '../lib/media'

export const fetchContinueWatching = createServerFn({ method: 'GET' }).handler(async () => {
  const items = await getContinueWatching()
  return items.map(fromJellyfin)
})

export const fetchFeatured = createServerFn({ method: 'GET' }).handler(async () => {
  const item = await getFeaturedItem()
  return item ? fromJellyfin(item) : null
})

export const fetchLatestMovies = createServerFn({ method: 'GET' }).handler(async () => {
  const items = await getLatestMedia('Movie')
  return items.map(fromJellyfin)
})

export const fetchLatestSeries = createServerFn({ method: 'GET' }).handler(async () => {
  const items = await getLatestMedia('Series')
  return items.map(fromJellyfin)
})

export const fetchLibrary = createServerFn({ method: 'GET' })
  .inputValidator((input: {
    type: 'Movie' | 'Series'
    page?: number
    sortBy?: 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'
  }) => input)
  .handler(async ({ data }) => {
    const page = data.page ?? 0
    const result = await getLibraryItems(data.type, {
      sortBy: data.sortBy ?? 'DateCreated',
      limit: 24,
      startIndex: page * 24,
    })
    return {
      items: result.Items.map(fromJellyfin),
      total: result.TotalRecordCount,
      page,
    }
  })

export const fetchItem = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const item = await getItem(data.id)
    return fromJellyfin(item)
  })

export const fetchItemDetails = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const [item, similar] = await Promise.all([
      getItem(data.id),
      getSimilarItems(data.id),
    ])

    return {
      item: fromJellyfinDetailed(item),
      similar: similar.map(fromJellyfin),
    }
  })

export const fetchSearch = createServerFn({ method: 'GET' })
  .inputValidator((input: { query: string }) => input)
  .handler(async ({ data }) => {
    if (!data.query.trim()) return []
    const items = await searchItems(data.query)
    return items.map(fromJellyfin)
  })
