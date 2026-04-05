const BASE_URL = process.env['JELLYFIN_URL'] ?? 'http://localhost:8096'
const API_KEY = process.env['JELLYFIN_API_KEY'] ?? ''
const USER_ID = process.env['JELLYFIN_USER_ID'] ?? ''
const USERNAME = process.env['JELLYFIN_USERNAME'] ?? ''
const PASSWORD = process.env['JELLYFIN_PASSWORD'] ?? ''

const AURORA_CLIENT_NAME = 'Aurora'
const AURORA_DEVICE_NAME = 'Aurora Web'
const AURORA_DEVICE_ID = 'aurora-ui-web'
const AURORA_VERSION = '1.0.0'

export type JellyfinMediaType = 'Movie' | 'Series' | 'Episode' | 'MusicAlbum'

export interface JellyfinItem {
  Id: string
  Name: string
  Type: JellyfinMediaType
  ProductionYear?: number
  RunTimeTicks?: number
  OfficialRating?: string
  Overview?: string
  CommunityRating?: number
  ImageTags?: { Primary?: string; Backdrop?: string; Thumb?: string; Logo?: string }
  BackdropImageTags?: string[]
  GenreItems?: { Id: string; Name: string }[]
  People?: {
    Id: string
    Name: string
    Role?: string
    Type?: string
    PrimaryImageTag?: string
  }[]
  Studios?: { Id?: string; Name: string }[]
  Tags?: string[]
  SeriesName?: string
  SeasonName?: string
  IndexNumber?: number
  ParentIndexNumber?: number
  UserData?: {
    PlaybackPositionTicks?: number
    PlayedPercentage?: number
    Played?: boolean
    IsFavorite?: boolean
  }
}

interface JellyfinPlaybackInfo {
  MediaSources?: { Id?: string | null }[]
  PlaySessionId?: string | null
}

interface JellyfinAuthResponse {
  AccessToken?: string
  SessionInfo?: {
    Id?: string
  }
}

export interface JellyfinPlaybackSession {
  streamUrl: string
  canSyncProgress: boolean
  playSessionId?: string
  mediaSourceId?: string
  sessionId?: string
}

interface JellyfinPlaybackSyncInput {
  itemId: string
  positionTicks: number
  playSessionId?: string
  mediaSourceId?: string
  sessionId?: string
  isPaused?: boolean
  isStopped?: boolean
  played?: boolean
}

export interface JellyfinResponse<T> {
  Items: T[]
  TotalRecordCount: number
}

async function jellyfinFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`)
  url.searchParams.set('api_key', API_KEY)
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Jellyfin error: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

function buildAuthorizationHeader(token?: string) {
  const parts = [
    `Client="${AURORA_CLIENT_NAME}"`,
    `Device="${AURORA_DEVICE_NAME}"`,
    `DeviceId="${AURORA_DEVICE_ID}"`,
    `Version="${AURORA_VERSION}"`,
  ]

  if (token) parts.push(`Token="${token}"`)

  return `MediaBrowser ${parts.join(', ')}`
}

let cachedPlaybackAuth:
  | {
      token: string
      sessionId?: string
    }
  | null = null

async function getPlaybackAuth(forceRefresh = false) {
  if (!USERNAME || !PASSWORD) return null
  if (cachedPlaybackAuth && !forceRefresh) return cachedPlaybackAuth

  const res = await fetch(`${BASE_URL}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': buildAuthorizationHeader(),
    },
    body: JSON.stringify({
      Username: USERNAME,
      Pw: PASSWORD,
    }),
  })

  if (!res.ok) {
    throw new Error(`Jellyfin auth error: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as JellyfinAuthResponse

  if (!data.AccessToken) {
    throw new Error('Jellyfin auth error: no access token returned')
  }

  cachedPlaybackAuth = {
    token: data.AccessToken,
    sessionId: data.SessionInfo?.Id,
  }

  return cachedPlaybackAuth
}

async function jellyfinPlaybackRequest(
  path: string,
  payload: Record<string, unknown>,
  forceRefresh = false,
) {
  const auth = await getPlaybackAuth(forceRefresh)

  if (!auth) return false

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': buildAuthorizationHeader(auth.token),
      'X-Emby-Token': auth.token,
    },
    body: JSON.stringify(payload),
  })

  if (res.status === 401 && !forceRefresh) {
    cachedPlaybackAuth = null
    return jellyfinPlaybackRequest(path, payload, true)
  }

  if (!res.ok) {
    throw new Error(`Jellyfin playback error: ${res.status} ${res.statusText}`)
  }

  return true
}

export function jellyfinImageUrl(
  itemId: string,
  type: 'Primary' | 'Backdrop' | 'Thumb' | 'Logo' = 'Primary',
  width = 400,
): string {
  return `${BASE_URL}/Items/${itemId}/Images/${type}?maxWidth=${width}&api_key=${API_KEY}`
}

export function jellyfinPersonImageUrl(personId: string, width = 240): string {
  return `${BASE_URL}/Items/${personId}/Images/Primary?maxWidth=${width}&api_key=${API_KEY}`
}

export function jellyfinStreamUrl(
  itemId: string,
  options?: {
    playSessionId?: string
    mediaSourceId?: string
  },
): string {
  const url = new URL(`${BASE_URL}/Videos/${itemId}/stream`)
  url.searchParams.set('static', 'true')
  url.searchParams.set('api_key', API_KEY)

  if (options?.playSessionId) {
    url.searchParams.set('PlaySessionId', options.playSessionId)
  }

  if (options?.mediaSourceId) {
    url.searchParams.set('MediaSourceId', options.mediaSourceId)
  }

  return url.toString()
}

export async function setFavorite(itemId: string, isFavorite: boolean) {
  const url = new URL(`${BASE_URL}/Users/${USER_ID}/FavoriteItems/${itemId}`)
  url.searchParams.set('api_key', API_KEY)

  const res = await fetch(url.toString(), { method: isFavorite ? 'DELETE' : 'POST' })
  if (!res.ok) throw new Error(`Jellyfin favorite error: ${res.status} ${res.statusText}`)
  return res.json() as Promise<{ IsFavorite: boolean }>
}

export async function setPlayed(itemId: string, played: boolean) {
  const url = new URL(`${BASE_URL}/Users/${USER_ID}/PlayedItems/${itemId}`)
  url.searchParams.set('api_key', API_KEY)

  const res = await fetch(url.toString(), {
    method: played ? 'POST' : 'DELETE',
  })

  if (!res.ok) throw new Error(`Jellyfin played-state error: ${res.status} ${res.statusText}`)
  return res.json() as Promise<{ Played: boolean; PlaybackPositionTicks?: number }>
}

export async function createPlaybackSession(itemId: string): Promise<JellyfinPlaybackSession> {
  const auth = await getPlaybackAuth().catch(() => null)

  if (!auth) {
    return {
      streamUrl: jellyfinStreamUrl(itemId),
      canSyncProgress: false,
    }
  }

  const url = new URL(`${BASE_URL}/Items/${itemId}/PlaybackInfo`)
  url.searchParams.set('UserId', USER_ID)

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': buildAuthorizationHeader(auth.token),
      'X-Emby-Token': auth.token,
    },
    body: JSON.stringify({
      UserId: USER_ID,
      StartTimeTicks: 0,
      IsPlayback: true,
      AutoOpenLiveStream: true,
    }),
  })

  if (res.status === 401) {
    cachedPlaybackAuth = null
    return createPlaybackSession(itemId)
  }

  if (!res.ok) {
    throw new Error(`Jellyfin playback session error: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as JellyfinPlaybackInfo
  const playSessionId = data.PlaySessionId ?? undefined
  const mediaSourceId = data.MediaSources?.[0]?.Id ?? undefined

  return {
    streamUrl: jellyfinStreamUrl(itemId, { playSessionId, mediaSourceId }),
    canSyncProgress: Boolean(playSessionId),
    playSessionId,
    mediaSourceId,
    sessionId: auth.sessionId,
  }
}

export async function syncPlaybackState({
  itemId,
  positionTicks,
  playSessionId,
  mediaSourceId,
  sessionId,
  isPaused = false,
  isStopped = false,
  played,
}: JellyfinPlaybackSyncInput) {
  let progressSynced = false

  if (playSessionId) {
    progressSynced = await jellyfinPlaybackRequest(
      isStopped ? '/Sessions/Playing/Stopped' : '/Sessions/Playing/Progress',
      {
        ItemId: itemId,
        PositionTicks: positionTicks,
        IsPaused: isPaused,
        CanSeek: true,
        PlayMethod: 'DirectPlay',
        PlaySessionId: playSessionId,
        MediaSourceId: mediaSourceId,
        SessionId: sessionId,
      },
    ).catch(() => false)
  }

  let playedSynced = false

  if (typeof played === 'boolean') {
    await setPlayed(itemId, played)
    playedSynced = true
  }

  return {
    progressSynced,
    playedSynced,
  }
}

export async function getContinueWatching(): Promise<JellyfinItem[]> {
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${USER_ID}/Items/Resume`,
    { MediaTypes: 'Video', Limit: '6', Fields: 'Overview,GenreItems,UserData' },
  )
  return data.Items
}

export async function getFavoriteItems(type: JellyfinMediaType = 'Movie'): Promise<JellyfinItem[]> {
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${USER_ID}/Items`,
    {
      IncludeItemTypes: type,
      Recursive: 'true',
      Filters: 'IsFavorite',
      Limit: '12',
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
      Fields: 'Overview,GenreItems,UserData',
    },
  )
  return data.Items
}

export async function getLatestMedia(type: JellyfinMediaType = 'Movie'): Promise<JellyfinItem[]> {
  const data = await jellyfinFetch<JellyfinItem[]>(
    `/Users/${USER_ID}/Items/Latest`,
    { IncludeItemTypes: type, Limit: '12', Fields: 'Overview,GenreItems,UserData' },
  )
  return data
}
export async function getLibraryItems(
  type: JellyfinMediaType,
  {
    sortBy = 'SortName',
    sortOrder = 'Ascending',
    limit = 24,
    startIndex = 0,
    genre,
    filters,
  }: {
    sortBy?: string
    sortOrder?: 'Ascending' | 'Descending'
    limit?: number
    startIndex?: number
    genre?: string
    filters?: string
  } = {},
): Promise<JellyfinResponse<JellyfinItem>> {
  const params: Record<string, string> = {
    IncludeItemTypes: type,
    SortBy: sortBy,
    SortOrder: sortOrder,
    Recursive: 'true',
    Limit: String(limit),
    StartIndex: String(startIndex),
    Fields: 'Overview,GenreItems,UserData',
  }

  if (genre) params.Genres = genre
  if (filters) params.Filters = filters

  return jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${USER_ID}/Items`,
    params,
  )
}

export async function getItem(itemId: string): Promise<JellyfinItem> {
  return jellyfinFetch<JellyfinItem>(
    `/Users/${USER_ID}/Items/${itemId}`,
    { Fields: 'Overview,GenreItems,UserData,People,Studios' },
  )
}

export async function getSimilarItems(itemId: string): Promise<JellyfinItem[]> {
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Items/${itemId}/Similar`,
    {
      UserId: USER_ID,
      Limit: '8',
      Fields: 'Overview,GenreItems,UserData',
    },
  )
  return data.Items
}

export async function getEpisodesForSeries(seriesId: string): Promise<JellyfinItem[]> {
  const direct = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Shows/${seriesId}/Episodes`,
    {
      UserId: USER_ID,
      Limit: '60',
      Fields: 'Overview,GenreItems,UserData',
    },
  ).catch(() => ({ Items: [], TotalRecordCount: 0 }))

  if (direct.Items.length) return direct.Items

  const fallback = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${USER_ID}/Items`,
    {
      IncludeItemTypes: 'Episode',
      Recursive: 'true',
      SeriesId: seriesId,
      Limit: '60',
      SortBy: 'ParentIndexNumber,IndexNumber',
      Fields: 'Overview,GenreItems,UserData',
    },
  ).catch(() => ({ Items: [], TotalRecordCount: 0 }))

  return fallback.Items
}

export async function getNextUpForSeries(seriesId: string): Promise<JellyfinItem[]> {
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Shows/NextUp`,
    {
      UserId: USER_ID,
      SeriesId: seriesId,
      Limit: '6',
      Fields: 'Overview,GenreItems,UserData',
    },
  ).catch(() => ({ Items: [], TotalRecordCount: 0 }))

  return data.Items
}

export async function searchItems(query: string): Promise<JellyfinItem[]> {
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${USER_ID}/Items`,
    {
      SearchTerm: query,
      Recursive: 'true',
      Limit: '20',
      Fields: 'Overview,GenreItems,UserData',
      IncludeItemTypes: 'Movie,Series',
    },
  )
  return data.Items
}

export async function getFeaturedItem(): Promise<JellyfinItem | null> {
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${USER_ID}/Items`,
    {
      IncludeItemTypes: 'Movie',
      SortBy: 'Random',
      Recursive: 'true',
      Limit: '1',
      HasBackdrop: 'true',
      Fields: 'Overview,GenreItems,UserData',
    },
  )
  return data.Items[0] ?? null
}
