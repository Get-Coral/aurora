import {
  beginPlaybackSession,
  fetchOnlineSubtitle,
  fetchContinueWatching,
  fetchFavoriteMovies,
  fetchFeatured,
  fetchItemDetails,
  fetchLibrary,
  fetchLatestMovies,
  fetchLatestSeries,
  fetchMostPlayed,
  fetchMyList,
  fetchRecommendedFromItem,
  fetchSearch,
  fetchOpenSubtitlesKey,
  fetchSeriesDetails,
  fetchSetupStatus,
  fetchWatchHistory,
  reportPlaybackState,
  searchOnlineSubtitles,
  fetchUsername,
  markPlayed,
  saveOpenSubtitlesKey,
  saveSettings,
  saveSetupConfiguration,
  toggleFavorite,
} from '../server/functions'
import {
  beginClientPlaybackSession,
  fetchClientLibrary,
  fetchClientOnlineSubtitle,
  fetchClientContinueWatching,
  fetchClientFavoriteItems,
  fetchClientFeatured,
  fetchClientItemDetails,
  fetchClientLatestMedia,
  fetchClientMostPlayed,
  fetchClientMyList,
  fetchClientRecommendedFromItem,
  fetchClientSearch,
  fetchClientSeriesDetails,
  fetchClientWatchHistory,
  reportClientPlaybackState,
  searchClientOnlineSubtitles,
  markClientPlayed,
  toggleClientFavorite,
} from './client-media'
import {
  getClientConfigurationSummary,
  getClientOpenSubtitlesApiKey,
  getStoredClientJellyfinSettings,
  saveClientJellyfinSettings,
  saveClientOpenSubtitlesApiKey,
  validateClientJellyfinSettings,
  type ClientJellyfinSettings,
} from './client-config-store'
import { shouldUseClientRuntime } from './runtime-mode'

interface SetupPayload extends ClientJellyfinSettings {}

function mergeClientSettings(input: Partial<ClientJellyfinSettings>) {
  const current = getStoredClientJellyfinSettings()
  return {
    url: input.url?.trim() || current.url || '',
    apiKey: input.apiKey?.trim() || current.apiKey || '',
    userId: input.userId?.trim() || current.userId || '',
    username: input.username?.trim() || current.username || '',
    password: input.password?.trim() || current.password || '',
  }
}

export async function fetchSetupStatusRuntime() {
  if (shouldUseClientRuntime()) {
    return getClientConfigurationSummary()
  }

  return fetchSetupStatus()
}

export async function saveSetupConfigurationRuntime(data: SetupPayload) {
  if (shouldUseClientRuntime()) {
    const validated = await validateClientJellyfinSettings(data)
    saveClientJellyfinSettings(validated)
    return { configured: true }
  }

  return saveSetupConfiguration({ data })
}

export async function saveSettingsRuntime(data: Partial<ClientJellyfinSettings>) {
  if (shouldUseClientRuntime()) {
    const validated = await validateClientJellyfinSettings(mergeClientSettings(data))
    saveClientJellyfinSettings(validated)
    return { configured: true }
  }

  return saveSettings({
    data: {
      url: data.url ?? '',
      apiKey: data.apiKey ?? '',
      userId: data.userId ?? '',
      username: data.username ?? '',
      password: data.password ?? '',
    },
  })
}

export async function fetchOpenSubtitlesKeyRuntime() {
  if (shouldUseClientRuntime()) {
    return getClientOpenSubtitlesApiKey()
  }

  return fetchOpenSubtitlesKey()
}

export async function saveOpenSubtitlesKeyRuntime(apiKey: string) {
  if (shouldUseClientRuntime()) {
    saveClientOpenSubtitlesApiKey(apiKey)
    return { apiKey: apiKey.trim() }
  }

  return saveOpenSubtitlesKey({ data: { apiKey } })
}

export async function fetchUsernameRuntime() {
  if (shouldUseClientRuntime()) {
    return getStoredClientJellyfinSettings().username ?? ''
  }

  return fetchUsername()
}

export async function fetchLibraryRuntime(input: {
  data: {
    type: 'Movie' | 'Series'
    page?: number
    sortBy?: 'SortName' | 'DateCreated' | 'PremiereDate' | 'CommunityRating'
    sortOrder?: 'Ascending' | 'Descending'
    genre?: string
    favoritesOnly?: boolean
    ratings?: string
    decade?: string
    minScore?: number
    watchStatus?: 'watched' | 'unwatched' | 'inprogress'
  }
}) {
  if (shouldUseClientRuntime()) {
    return fetchClientLibrary(input.data)
  }

  return fetchLibrary(input)
}

export async function fetchFeaturedRuntime() {
  if (shouldUseClientRuntime()) {
    return fetchClientFeatured()
  }

  return fetchFeatured()
}

export async function fetchContinueWatchingRuntime() {
  if (shouldUseClientRuntime()) {
    return fetchClientContinueWatching()
  }

  return fetchContinueWatching()
}

export async function fetchLatestMoviesRuntime() {
  if (shouldUseClientRuntime()) {
    return fetchClientLatestMedia('Movie')
  }

  return fetchLatestMovies()
}

export async function fetchLatestSeriesRuntime() {
  if (shouldUseClientRuntime()) {
    return fetchClientLatestMedia('Series')
  }

  return fetchLatestSeries()
}

export async function fetchFavoriteMoviesRuntime() {
  if (shouldUseClientRuntime()) {
    return fetchClientFavoriteItems('Movie')
  }

  return fetchFavoriteMovies()
}

export async function fetchMostPlayedRuntime() {
  if (shouldUseClientRuntime()) {
    return fetchClientMostPlayed('Movie', 12)
  }

  return fetchMostPlayed()
}

export async function fetchMyListRuntime() {
  if (shouldUseClientRuntime()) {
    return fetchClientMyList()
  }

  return fetchMyList()
}

export async function beginPlaybackSessionRuntime(input: {
  data: {
    id: string
    client?: {
      platform: 'ios' | 'android' | 'android-tv' | 'other'
      prefersSafeVideo: boolean
      prefersTvMode: boolean
    }
  }
}) {
  if (shouldUseClientRuntime()) {
    return beginClientPlaybackSession(input.data.id, input.data.client)
  }

  return beginPlaybackSession(input)
}

export async function reportPlaybackStateRuntime(input: {
  data: {
    id: string
    positionTicks: number
    playMethod?: 'DirectPlay' | 'Transcode'
    playSessionId?: string
    mediaSourceId?: string
    sessionId?: string
    isPaused?: boolean
    isStopped?: boolean
    played?: boolean
  }
}) {
  if (shouldUseClientRuntime()) {
    return reportClientPlaybackState({ id: input.data.id, played: input.data.played })
  }

  return reportPlaybackState(input)
}

export async function searchOnlineSubtitlesRuntime(input: {
  data: {
    title: string
    year?: number
    season?: number
    episode?: number
  }
}) {
  if (shouldUseClientRuntime()) {
    return searchClientOnlineSubtitles(input.data)
  }

  return searchOnlineSubtitles(input)
}

export async function fetchOnlineSubtitleRuntime(input: { data: { fileId: number } }) {
  if (shouldUseClientRuntime()) {
    return fetchClientOnlineSubtitle(input.data.fileId)
  }

  return fetchOnlineSubtitle(input)
}

export async function fetchSearchRuntime(input: { data: { query: string } }) {
  if (shouldUseClientRuntime()) {
    return fetchClientSearch(input.data.query)
  }

  return fetchSearch(input)
}

export async function fetchWatchHistoryRuntime(input: { data: { page?: number } }) {
  if (shouldUseClientRuntime()) {
    return fetchClientWatchHistory(input.data.page ?? 0)
  }

  return fetchWatchHistory(input)
}

export async function fetchRecommendedFromItemRuntime(input: { data: { id: string } }) {
  if (shouldUseClientRuntime()) {
    return fetchClientRecommendedFromItem(input.data.id)
  }

  return fetchRecommendedFromItem(input)
}

export async function fetchItemDetailsRuntime(input: { data: { id: string } }) {
  if (shouldUseClientRuntime()) {
    return fetchClientItemDetails(input.data.id)
  }

  return fetchItemDetails(input)
}

export async function fetchSeriesDetailsRuntime(input: { data: { id: string } }) {
  if (shouldUseClientRuntime()) {
    return fetchClientSeriesDetails(input.data.id)
  }

  return fetchSeriesDetails(input)
}

export async function toggleFavoriteRuntime(input: { data: { id: string; isFavorite: boolean } }) {
  if (shouldUseClientRuntime()) {
    return toggleClientFavorite(input.data)
  }

  return toggleFavorite(input)
}

export async function markPlayedRuntime(input: { data: { id: string; played: boolean } }) {
  if (shouldUseClientRuntime()) {
    return markClientPlayed(input.data)
  }

  return markPlayed(input)
}