import {
  getEffectiveJellyfinSettings,
  type JellyfinSettings,
} from './config-store'

const AURORA_CLIENT_NAME = 'Aurora'
const AURORA_DEVICE_NAME = 'Aurora Web'
const AURORA_DEVICE_ID = 'aurora-ui-web'
const AURORA_VERSION = '1.0.0'

export type JellyfinMediaType = 'Movie' | 'Series' | 'Episode' | 'MusicAlbum' | 'BoxSet'

export interface JellyfinItem {
  Id: string
  Name: string
  Type: JellyfinMediaType
  ProductionYear?: number
  RunTimeTicks?: number
  OfficialRating?: string
  Overview?: string
  CommunityRating?: number
  ChildCount?: number
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
    LastPlayedDate?: string
  }
}

interface JellyfinMediaStream {
  Type: string
  Index: number
  Language?: string
  DisplayTitle?: string
  IsTextSubtitleStream?: boolean
}

interface JellyfinMediaSource {
  Id?: string | null
  MediaStreams?: JellyfinMediaStream[]
  SupportsDirectPlay?: boolean
  SupportsDirectStream?: boolean
  TranscodingUrl?: string | null
}

interface JellyfinPlaybackInfo {
  MediaSources?: JellyfinMediaSource[]
  PlaySessionId?: string | null
}

export interface SubtitleTrack {
  index: number
  label: string
  language: string
  url: string
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
  subtitleTracks: SubtitleTrack[]
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

function getRequiredSettings() {
  const settings = getEffectiveJellyfinSettings()

  if (!settings) {
    throw new Error('Aurora is not configured yet. Visit /setup to connect Jellyfin.')
  }

  return {
    ...settings,
    url: settings.url.replace(/\/+$/, ''),
  }
}

async function jellyfinFetch<T>(
  path: string,
  params?: Record<string, string>,
  settings: JellyfinSettings = getRequiredSettings(),
): Promise<T> {
  const url = new URL(`${settings.url}${path}`)
  url.searchParams.set('api_key', settings.apiKey)
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
      cacheKey: string
      token: string
      sessionId?: string
    }
  | null = null

function getPlaybackCacheKey(settings: JellyfinSettings) {
  return `${settings.url}::${settings.userId}::${settings.username}`
}

async function getPlaybackAuth(
  settings: JellyfinSettings = getRequiredSettings(),
  forceRefresh = false,
) {
  if (!settings.username || !settings.password) return null

  const cacheKey = getPlaybackCacheKey(settings)

  if (cachedPlaybackAuth?.cacheKey === cacheKey && !forceRefresh) {
    return cachedPlaybackAuth
  }

  const res = await fetch(`${settings.url}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': buildAuthorizationHeader(),
    },
    body: JSON.stringify({
      Username: settings.username,
      Pw: settings.password,
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
    cacheKey,
    token: data.AccessToken,
    sessionId: data.SessionInfo?.Id,
  }

  return cachedPlaybackAuth
}

async function jellyfinPlaybackRequest(
  path: string,
  payload: Record<string, unknown>,
  settings: JellyfinSettings = getRequiredSettings(),
  forceRefresh = false,
) {
  const auth = await getPlaybackAuth(settings, forceRefresh)

  if (!auth) return false

  const res = await fetch(`${settings.url}${path}`, {
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
    return jellyfinPlaybackRequest(path, payload, settings, true)
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
  const settings = getRequiredSettings()
  return `${settings.url}/Items/${itemId}/Images/${type}?maxWidth=${width}&api_key=${settings.apiKey}`
}

export function jellyfinPersonImageUrl(personId: string, width = 240): string {
  const settings = getRequiredSettings()
  return `${settings.url}/Items/${personId}/Images/Primary?maxWidth=${width}&api_key=${settings.apiKey}`
}

export function jellyfinStreamUrl(
  itemId: string,
  options?: {
    playSessionId?: string
    mediaSourceId?: string
  },
): string {
  const settings = getRequiredSettings()
  const url = new URL(`${settings.url}/Videos/${itemId}/stream`)
  url.searchParams.set('static', 'true')
  url.searchParams.set('api_key', settings.apiKey)

  if (options?.playSessionId) url.searchParams.set('PlaySessionId', options.playSessionId)
  if (options?.mediaSourceId) url.searchParams.set('MediaSourceId', options.mediaSourceId)

  return url.toString()
}

export function jellyfinTranscodeUrl(
  itemId: string,
  options?: {
    playSessionId?: string
    mediaSourceId?: string
  },
): string {
  const settings = getRequiredSettings()
  const url = new URL(`${settings.url}/Videos/${itemId}/stream.mp4`)
  url.searchParams.set('api_key', settings.apiKey)
  url.searchParams.set('VideoCodec', 'h264')
  url.searchParams.set('AudioCodec', 'aac')
  url.searchParams.set('DeviceId', AURORA_DEVICE_ID)

  if (options?.playSessionId) url.searchParams.set('PlaySessionId', options.playSessionId)
  if (options?.mediaSourceId) url.searchParams.set('MediaSourceId', options.mediaSourceId)

  return url.toString()
}

export async function setFavorite(itemId: string, isFavorite: boolean) {
  const settings = getRequiredSettings()
  const url = new URL(`${settings.url}/Users/${settings.userId}/FavoriteItems/${itemId}`)
  url.searchParams.set('api_key', settings.apiKey)

  const res = await fetch(url.toString(), { method: isFavorite ? 'DELETE' : 'POST' })
  if (!res.ok) throw new Error(`Jellyfin favorite error: ${res.status} ${res.statusText}`)
  return res.json() as Promise<{ IsFavorite: boolean }>
}

export async function setPlayed(itemId: string, played: boolean) {
  const settings = getRequiredSettings()
  const url = new URL(`${settings.url}/Users/${settings.userId}/PlayedItems/${itemId}`)
  url.searchParams.set('api_key', settings.apiKey)

  const res = await fetch(url.toString(), {
    method: played ? 'POST' : 'DELETE',
  })

  if (!res.ok) throw new Error(`Jellyfin played-state error: ${res.status} ${res.statusText}`)
  return res.json() as Promise<{ Played: boolean; PlaybackPositionTicks?: number }>
}

export async function createPlaybackSession(itemId: string): Promise<JellyfinPlaybackSession> {
  const settings = getRequiredSettings()
  const auth = await getPlaybackAuth(settings).catch(() => null)

  if (!auth) {
    return {
      streamUrl: jellyfinStreamUrl(itemId),
      canSyncProgress: false,
      subtitleTracks: [],
    }
  }

  const url = new URL(`${settings.url}/Items/${itemId}/PlaybackInfo`)
  url.searchParams.set('UserId', settings.userId)

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': buildAuthorizationHeader(auth.token),
      'X-Emby-Token': auth.token,
    },
    body: JSON.stringify({
      UserId: settings.userId,
      StartTimeTicks: 0,
      IsPlayback: true,
      AutoOpenLiveStream: true,
      DeviceProfile: {
        DirectPlayProfiles: [
          { Type: 'Video', Container: 'mp4,mkv,webm', VideoCodec: 'h264,vp8,vp9,av1', AudioCodec: 'aac,mp3,opus,flac,vorbis' },
          { Type: 'Audio', Container: 'mp3,aac,flac,ogg,opus' },
        ],
        TranscodingProfiles: [],
        CodecProfiles: [],
        SubtitleProfiles: [
          { Format: 'vtt', Method: 'External' },
          { Format: 'srt', Method: 'External' },
        ],
      },
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
  const mediaSource = data.MediaSources?.[0]
  const mediaSourceId = mediaSource?.Id ?? undefined

  // When direct play isn't supported (e.g. AC3/DTS audio), use a progressive
  // MP4 transcode. Jellyfin's TranscodingUrl points to HLS which requires
  // hls.js in Chrome/Firefox — the stream.mp4 endpoint works natively in all browsers.
  const supportsDirectPlay = mediaSource?.SupportsDirectPlay !== false
  const streamUrl = supportsDirectPlay
    ? jellyfinStreamUrl(itemId, { playSessionId, mediaSourceId })
    : jellyfinTranscodeUrl(itemId, { playSessionId, mediaSourceId })

  const subtitleTracks: SubtitleTrack[] = (mediaSource?.MediaStreams ?? [])
    .filter((s) => s.Type === 'Subtitle' && s.IsTextSubtitleStream)
    .map((s, position) => ({
      index: position,
      label: s.DisplayTitle ?? s.Language ?? `Track ${s.Index}`,
      language: s.Language ?? 'und',
      url: `${settings.url}/Videos/${itemId}/${mediaSourceId}/Subtitles/${s.Index}/Stream.vtt?api_key=${settings.apiKey}`,
    }))

  return {
    streamUrl,
    canSyncProgress: Boolean(playSessionId),
    playSessionId,
    mediaSourceId,
    sessionId: auth.sessionId,
    subtitleTracks,
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
  const settings = getRequiredSettings()
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items/Resume`,
    { MediaTypes: 'Video', Limit: '6', Fields: 'Overview,GenreItems,UserData' },
    settings,
  )
  return data.Items
}

export async function getFavoriteItems(type: JellyfinMediaType = 'Movie'): Promise<JellyfinItem[]> {
  const settings = getRequiredSettings()
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items`,
    {
      IncludeItemTypes: type,
      Recursive: 'true',
      Filters: 'IsFavorite',
      Limit: '12',
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
      Fields: 'Overview,GenreItems,UserData',
    },
    settings,
  )
  return data.Items
}

export async function getLatestMedia(type: JellyfinMediaType = 'Movie'): Promise<JellyfinItem[]> {
  const settings = getRequiredSettings()
  const data = await jellyfinFetch<JellyfinItem[]>(
    `/Users/${settings.userId}/Items/Latest`,
    { IncludeItemTypes: type, Limit: '12', Fields: 'Overview,GenreItems,UserData' },
    settings,
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
    officialRatings,
    minCommunityRating,
    minPremiereDate,
    maxPremiereDate,
  }: {
    sortBy?: string
    sortOrder?: 'Ascending' | 'Descending'
    limit?: number
    startIndex?: number
    genre?: string
    filters?: string
    officialRatings?: string
    minCommunityRating?: number
    minPremiereDate?: string
    maxPremiereDate?: string
  } = {},
): Promise<JellyfinResponse<JellyfinItem>> {
  const settings = getRequiredSettings()
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
  if (officialRatings) params.OfficialRatings = officialRatings
  if (minCommunityRating != null) params.MinCommunityRating = String(minCommunityRating)
  if (minPremiereDate) params.MinPremiereDate = minPremiereDate
  if (maxPremiereDate) params.MaxPremiereDate = maxPremiereDate

  return jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items`,
    params,
    settings,
  )
}

export async function getWatchHistory({
  limit = 24,
  startIndex = 0,
}: { limit?: number; startIndex?: number } = {}): Promise<JellyfinResponse<JellyfinItem>> {
  const settings = getRequiredSettings()
  return jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items`,
    {
      Filters: 'IsPlayed',
      SortBy: 'DatePlayed',
      SortOrder: 'Descending',
      Recursive: 'true',
      IncludeItemTypes: 'Movie,Series',
      Limit: String(limit),
      StartIndex: String(startIndex),
      Fields: 'Overview,GenreItems,UserData',
    },
    settings,
  )
}

export async function getCollections(): Promise<JellyfinItem[]> {
  const settings = getRequiredSettings()
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items`,
    {
      IncludeItemTypes: 'BoxSet',
      Recursive: 'true',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      Fields: 'Overview,GenreItems,UserData,ChildCount',
    },
    settings,
  )
  return data.Items
}

export async function getCollectionItems(collectionId: string): Promise<JellyfinItem[]> {
  const settings = getRequiredSettings()
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items`,
    {
      ParentId: collectionId,
      SortBy: 'PremiereDate,SortName',
      SortOrder: 'Ascending',
      Fields: 'Overview,GenreItems,UserData',
    },
    settings,
  )
  return data.Items
}

export async function getMostPlayed(type: JellyfinMediaType = 'Movie', limit = 12): Promise<JellyfinItem[]> {
  const settings = getRequiredSettings()
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items`,
    {
      IncludeItemTypes: type,
      SortBy: 'PlayCount',
      SortOrder: 'Descending',
      Recursive: 'true',
      Limit: String(limit),
      Filters: 'IsPlayed',
      Fields: 'Overview,GenreItems,UserData',
    },
    settings,
  )
  return data.Items
}

export async function getItem(itemId: string): Promise<JellyfinItem> {
  const settings = getRequiredSettings()
  return jellyfinFetch<JellyfinItem>(
    `/Users/${settings.userId}/Items/${itemId}`,
    { Fields: 'Overview,GenreItems,UserData,People,Studios' },
    settings,
  )
}

export async function getSimilarItems(itemId: string): Promise<JellyfinItem[]> {
  const settings = getRequiredSettings()
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Items/${itemId}/Similar`,
    {
      UserId: settings.userId,
      Limit: '8',
      Fields: 'Overview,GenreItems,UserData',
    },
    settings,
  )
  return data.Items
}

export async function getEpisodesForSeries(seriesId: string): Promise<JellyfinItem[]> {
  const settings = getRequiredSettings()
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Shows/${seriesId}/Episodes`,
    {
      UserId: settings.userId,
      Limit: '200',
      SortBy: 'ParentIndexNumber,IndexNumber',
      Fields: 'Overview,GenreItems,UserData',
    },
    settings,
  ).catch(() => ({ Items: [], TotalRecordCount: 0 }))

  return data.Items
}

export async function getNextUpForSeries(seriesId: string): Promise<JellyfinItem[]> {
  const settings = getRequiredSettings()
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Shows/NextUp`,
    {
      UserId: settings.userId,
      SeriesId: seriesId,
      Limit: '6',
      Fields: 'Overview,GenreItems,UserData',
    },
    settings,
  ).catch(() => ({ Items: [], TotalRecordCount: 0 }))

  return data.Items
}

export async function searchItems(query: string): Promise<JellyfinItem[]> {
  const settings = getRequiredSettings()
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items`,
    {
      SearchTerm: query,
      Recursive: 'true',
      Limit: '20',
      Fields: 'Overview,GenreItems,UserData',
      IncludeItemTypes: 'Movie,Series',
    },
    settings,
  )
  return data.Items
}

export async function createCollection(name: string, itemIds: string[] = []): Promise<{ Id: string }> {
  const settings = getRequiredSettings()
  const url = new URL(`${settings.url}/Collections`)
  url.searchParams.set('api_key', settings.apiKey)
  url.searchParams.set('Name', name)
  if (itemIds.length) url.searchParams.set('Ids', itemIds.join(','))
  const res = await fetch(url.toString(), { method: 'POST' })
  if (!res.ok) throw new Error(`Jellyfin collection create error: ${res.status}`)
  return res.json() as Promise<{ Id: string }>
}

export async function deleteItem(id: string): Promise<void> {
  const settings = getRequiredSettings()
  const url = new URL(`${settings.url}/Items/${id}`)
  url.searchParams.set('api_key', settings.apiKey)
  const res = await fetch(url.toString(), { method: 'DELETE' })
  if (!res.ok) throw new Error(`Jellyfin delete error: ${res.status}`)
}

export async function updateItemName(id: string, name: string): Promise<void> {
  const settings = getRequiredSettings()
  const item = await getItem(id)
  const url = new URL(`${settings.url}/Items/${id}`)
  url.searchParams.set('api_key', settings.apiKey)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...item, Name: name }),
  })
  if (!res.ok) throw new Error(`Jellyfin update error: ${res.status}`)
}

export async function addItemsToCollection(collectionId: string, itemIds: string[]): Promise<void> {
  const settings = getRequiredSettings()
  const url = new URL(`${settings.url}/Collections/${collectionId}/Items`)
  url.searchParams.set('api_key', settings.apiKey)
  url.searchParams.set('Ids', itemIds.join(','))
  const res = await fetch(url.toString(), { method: 'POST' })
  if (!res.ok) throw new Error(`Jellyfin add to collection error: ${res.status}`)
}

export async function removeItemsFromCollection(collectionId: string, itemIds: string[]): Promise<void> {
  const settings = getRequiredSettings()
  const url = new URL(`${settings.url}/Collections/${collectionId}/Items`)
  url.searchParams.set('api_key', settings.apiKey)
  url.searchParams.set('Ids', itemIds.join(','))
  const res = await fetch(url.toString(), { method: 'DELETE' })
  if (!res.ok) throw new Error(`Jellyfin remove from collection error: ${res.status}`)
}

export async function getFeaturedItem(): Promise<JellyfinItem | null> {
  const settings = getRequiredSettings()
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items`,
    {
      IncludeItemTypes: 'Movie',
      SortBy: 'Random',
      Recursive: 'true',
      Limit: '1',
      HasBackdrop: 'true',
      Fields: 'Overview,GenreItems,UserData',
    },
    settings,
  )
  return data.Items[0] ?? null
}
