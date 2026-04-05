import { createServerFn } from '@tanstack/react-start'
import {
  createPlaybackSession,
  getContinueWatching,
  getEpisodesForSeries,
  getFavoriteItems,
  getLatestMedia,
  getLibraryItems,
  getItem,
  getFeaturedItem,
  getNextUpForSeries,
  getSimilarItems,
  searchItems,
  setFavorite,
  syncPlaybackState,
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

export const fetchFavoriteMovies = createServerFn({ method: 'GET' }).handler(async () => {
  const items = await getFavoriteItems('Movie')
  return items.map(fromJellyfin)
})

export const fetchMyList = createServerFn({ method: 'GET' }).handler(async () => {
  const [movies, series] = await Promise.all([
    getFavoriteItems('Movie'),
    getFavoriteItems('Series'),
  ])

  return [...movies, ...series].map(fromJellyfin)
})

export const fetchRecommendedFromItem = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const items = await getSimilarItems(data.id)
    return items.map(fromJellyfin)
  })

export const fetchLibrary = createServerFn({ method: 'GET' })
  .inputValidator((input: {
    type: 'Movie' | 'Series'
    page?: number
    sortBy?: 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'
    genre?: string
    favoritesOnly?: boolean
  }) => input)
  .handler(async ({ data }) => {
    const page = data.page ?? 0
    const result = await getLibraryItems(data.type, {
      sortBy: data.sortBy ?? 'DateCreated',
      limit: 24,
      startIndex: page * 24,
      genre: data.genre,
      filters: data.favoritesOnly ? 'IsFavorite' : undefined,
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

export const fetchSeriesDetails = createServerFn({ method: 'GET' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const [item, episodes, nextUp, similar] = await Promise.all([
      getItem(data.id),
      getEpisodesForSeries(data.id),
      getNextUpForSeries(data.id),
      getSimilarItems(data.id),
    ])

    return {
      item: fromJellyfinDetailed(item),
      episodes: episodes.map(fromJellyfin),
      nextUp: nextUp.map(fromJellyfin),
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

export const toggleFavorite = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; isFavorite: boolean }) => input)
  .handler(async ({ data }) => {
    const result = await setFavorite(data.id, data.isFavorite)
    return { id: data.id, isFavorite: result.IsFavorite }
  })

export const beginPlaybackSession = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return createPlaybackSession(data.id)
  })

export const reportPlaybackState = createServerFn({ method: 'POST' })
  .inputValidator((input: {
    id: string
    positionTicks: number
    playSessionId?: string
    mediaSourceId?: string
    sessionId?: string
    isPaused?: boolean
    isStopped?: boolean
    played?: boolean
  }) => input)
  .handler(async ({ data }) => {
    return syncPlaybackState({
      itemId: data.id,
      positionTicks: data.positionTicks,
      playSessionId: data.playSessionId,
      mediaSourceId: data.mediaSourceId,
      sessionId: data.sessionId,
      isPaused: data.isPaused,
      isStopped: data.isStopped,
      played: data.played,
    })
  })
