import {
  getClientOpenSubtitlesApiKey,
  getEffectiveClientJellyfinSettings,
} from './client-config-store'
import type { DetailedMediaItem, MediaItem, SeriesDetailPayload } from './media'
import type { JellyfinItem, JellyfinMediaType, JellyfinResponse } from './jellyfin'
import type { ClientPlaybackContext } from './platform'

type ClientSettings = NonNullable<ReturnType<typeof getEffectiveClientJellyfinSettings>>

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', nl: 'Nederlands', de: 'Deutsch', fr: 'Français', es: 'Español',
  it: 'Italiano', pt: 'Português', 'pt-pt': 'Português (PT)', 'pt-br': 'Português (BR)',
  ru: 'Русский', pl: 'Polski', cs: 'Čeština', sk: 'Slovenčina', hu: 'Magyar',
  ro: 'Română', bg: 'Български', hr: 'Hrvatski', sr: 'Srpski', sl: 'Slovenščina',
  sv: 'Svenska', no: 'Norsk', da: 'Dansk', fi: 'Suomi', el: 'Ελληνικά',
  tr: 'Türkçe', ar: 'العربية', he: 'עברית', zh: '中文', 'zh-cn': '中文(简)', 'zh-tw': '中文(繁)',
  ja: '日本語', ko: '한국어', th: 'ภาษาไทย', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu',
  vi: 'Tiếng Việt', uk: 'Українська', et: 'Eesti', lv: 'Latviešu', lt: 'Lietuvių',
}

const DECADE_RANGES: Record<string, { min: string; max: string }> = {
  '2020s': { min: '2020-01-01', max: '2029-12-31' },
  '2010s': { min: '2010-01-01', max: '2019-12-31' },
  '2000s': { min: '2000-01-01', max: '2009-12-31' },
  '1990s': { min: '1990-01-01', max: '1999-12-31' },
  '1980s': { min: '1980-01-01', max: '1989-12-31' },
  Older: { min: '1900-01-01', max: '1979-12-31' },
}

export interface ClientOnlineSubtitleResult {
  id: string
  language: string
  label: string
  fileId: number
}

function getRequiredClientSettings(): ClientSettings {
  const settings = getEffectiveClientJellyfinSettings()

  if (!settings) {
    throw new Error('Aurora is not configured yet. Visit /setup to connect Jellyfin.')
  }

  return {
    ...settings,
    url: settings.url.replace(/\/+$/, ''),
  }
}

async function clientJellyfinFetch<T>(
  path: string,
  params?: Record<string, string>,
  settings: ClientSettings = getRequiredClientSettings(),
): Promise<T> {
  const url = new URL(`${settings.url}${path}`)
  url.searchParams.set('api_key', settings.apiKey)

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(url.toString(), { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`Jellyfin error: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

async function clientJellyfinWrite(
  path: string,
  init: RequestInit,
  params?: Record<string, string>,
  settings: ClientSettings = getRequiredClientSettings(),
): Promise<Response> {
  const url = new URL(`${settings.url}${path}`)
  url.searchParams.set('api_key', settings.apiKey)

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(url.toString(), {
    cache: 'no-store',
    ...init,
  })

  if (!response.ok) {
    throw new Error(`Jellyfin error: ${response.status} ${response.statusText}`)
  }

  return response
}

function clientJellyfinImageUrl(
  itemId: string,
  type: 'Primary' | 'Backdrop' | 'Thumb' | 'Logo' = 'Primary',
  width = 400,
  settings: ClientSettings = getRequiredClientSettings(),
): string {
  return `${settings.url}/Items/${itemId}/Images/${type}?maxWidth=${width}&api_key=${settings.apiKey}`
}

function clientJellyfinPersonImageUrl(
  personId: string,
  width = 240,
  settings: ClientSettings = getRequiredClientSettings(),
): string {
  return `${settings.url}/Items/${personId}/Images/Primary?maxWidth=${width}&api_key=${settings.apiKey}`
}

function clientJellyfinStreamUrl(
  itemId: string,
  settings: ClientSettings = getRequiredClientSettings(),
): string {
  const url = new URL(`${settings.url}/Videos/${itemId}/stream`)
  url.searchParams.set('static', 'true')
  url.searchParams.set('api_key', settings.apiKey)
  return url.toString()
}

function clientJellyfinTranscodeUrl(
  itemId: string,
  settings: ClientSettings = getRequiredClientSettings(),
): string {
  const url = new URL(`${settings.url}/Videos/${itemId}/stream.mp4`)
  url.searchParams.set('api_key', settings.apiKey)
  url.searchParams.set('VideoCodec', 'h264')
  url.searchParams.set('AudioCodec', 'aac')
  url.searchParams.set('DeviceId', 'aurora-ui-local')
  return url.toString()
}

function fromClientJellyfin(
  item: JellyfinItem,
  settings: ClientSettings = getRequiredClientSettings(),
): MediaItem {
  const type =
    item.Type === 'Movie' ? 'movie'
    : item.Type === 'Episode' ? 'episode'
    : item.Type === 'BoxSet' ? 'collection'
    : 'series'

  return {
    id: item.Id,
    source: 'jellyfin',
    type,
    title: item.Name,
    year: item.ProductionYear,
    runtimeMinutes: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600_000_000) : undefined,
    overview: item.Overview,
    rating: item.CommunityRating,
    ageRating: item.OfficialRating,
    genres: item.GenreItems?.map((genre) => genre.Name) ?? [],
    posterUrl: item.ImageTags?.Primary
      ? clientJellyfinImageUrl(item.Id, 'Primary', 400, settings)
      : undefined,
    backdropUrl: item.BackdropImageTags?.[0]
      ? clientJellyfinImageUrl(item.Id, 'Backdrop', 1920, settings)
      : undefined,
    thumbUrl: item.ImageTags?.Thumb
      ? clientJellyfinImageUrl(item.Id, 'Thumb', 600, settings)
      : undefined,
    logoUrl: item.ImageTags?.Logo
      ? clientJellyfinImageUrl(item.Id, 'Logo', 900, settings)
      : undefined,
    progress: item.UserData?.PlayedPercentage,
    playbackPositionTicks: item.UserData?.PlaybackPositionTicks,
    played: item.UserData?.Played,
    isFavorite: item.UserData?.IsFavorite,
    seriesTitle: item.SeriesName,
    seasonNumber: item.ParentIndexNumber,
    episodeNumber: item.IndexNumber,
    childCount: item.ChildCount,
    watchedAt: item.UserData?.LastPlayedDate,
    streamUrl: type === 'collection' ? undefined : clientJellyfinStreamUrl(item.Id, settings),
  }
}

function fromClientJellyfinDetailed(
  item: JellyfinItem,
  settings: ClientSettings = getRequiredClientSettings(),
): DetailedMediaItem {
  const base = fromClientJellyfin(item, settings)

  return {
    ...base,
    cast:
      item.People?.filter((person) => person.Type === 'Actor' || person.Role)
        .slice(0, 10)
        .map((person) => ({
          id: person.Id,
          name: person.Name,
          role: person.Role,
          type: person.Type,
          imageUrl: person.PrimaryImageTag
            ? clientJellyfinPersonImageUrl(person.Id, 240, settings)
            : undefined,
        })) ?? [],
    studios: item.Studios?.map((studio) => studio.Name) ?? [],
    tags: item.Tags ?? [],
  }
}

export async function fetchClientContinueWatching() {
  const settings = getRequiredClientSettings()
  const data = await clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items/Resume`,
    { MediaTypes: 'Video', Limit: '6', Fields: 'Overview,GenreItems,UserData' },
    settings,
  )

  return data.Items.map((item) => fromClientJellyfin(item, settings))
}

export async function fetchClientFeatured() {
  const settings = getRequiredClientSettings()
  const data = await clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
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

  const item = data.Items[0]
  return item ? fromClientJellyfin(item, settings) : null
}

export async function fetchClientLatestMedia(type: JellyfinMediaType = 'Movie') {
  const settings = getRequiredClientSettings()
  const data = await clientJellyfinFetch<JellyfinItem[]>(
    `/Users/${settings.userId}/Items/Latest`,
    { IncludeItemTypes: type, Limit: '12', Fields: 'Overview,GenreItems,UserData' },
    settings,
  )

  return data.map((item) => fromClientJellyfin(item, settings))
}

export async function fetchClientFavoriteItems(type: JellyfinMediaType = 'Movie') {
  const settings = getRequiredClientSettings()
  const data = await clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
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

  return data.Items.map((item) => fromClientJellyfin(item, settings))
}

export async function fetchClientMyList() {
  const [movies, series] = await Promise.all([
    fetchClientFavoriteItems('Movie'),
    fetchClientFavoriteItems('Series'),
  ])

  return [...movies, ...series]
}

export async function fetchClientLibrary(input: {
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
}) {
  const settings = getRequiredClientSettings()
  const page = input.page ?? 0
  const decadeRange = input.decade ? DECADE_RANGES[input.decade] : undefined
  const params: Record<string, string> = {
    IncludeItemTypes: input.type,
    SortBy: input.sortBy ?? 'DateCreated',
    SortOrder: input.sortOrder ?? 'Descending',
    Recursive: 'true',
    Limit: '24',
    StartIndex: String(page * 24),
    Fields: 'Overview,GenreItems,UserData',
  }

  const filterParts: string[] = []
  if (input.favoritesOnly) filterParts.push('IsFavorite')
  if (input.watchStatus === 'watched') filterParts.push('IsPlayed')
  else if (input.watchStatus === 'unwatched') filterParts.push('IsUnplayed')
  else if (input.watchStatus === 'inprogress') filterParts.push('IsResumable')
  if (filterParts.length) params.Filters = filterParts.join(',')

  if (input.genre) params.Genres = input.genre
  if (input.ratings) params.OfficialRatings = input.ratings
  if (input.minScore != null) params.MinCommunityRating = String(input.minScore)
  if (decadeRange?.min) params.MinPremiereDate = decadeRange.min
  if (decadeRange?.max) params.MaxPremiereDate = decadeRange.max

  const result = await clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items`,
    params,
    settings,
  )

  return {
    items: result.Items.map((item) => fromClientJellyfin(item, settings)),
    total: result.TotalRecordCount,
    page,
  }
}

export async function fetchClientMostPlayed(type: JellyfinMediaType = 'Movie', limit = 12) {
  const settings = getRequiredClientSettings()
  const data = await clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
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

  return data.Items.map((item) => fromClientJellyfin(item, settings))
}

type ClientAdminOverview = {
  systemInfo: {
    ServerName: string
    Version: string
    OperatingSystem?: string
    HasUpdateAvailable?: boolean
    LocalAddress?: string
    WanAddress?: string
  }
  counts: {
    MovieCount?: number
    SeriesCount?: number
    EpisodeCount?: number
    MusicAlbumCount?: number
    SongCount?: number
    BookCount?: number
    MusicVideoCount?: number
  }
  serverUrl: string
  apiKey: string
}

type ClientAdminSession = {
  id: string
  userName: string | null
  client: string | null
  deviceName: string | null
  lastActivityDate: string | null
  nowPlaying: {
    id: string
    name: string
    type: string
    seriesName: string | null
    runTimeTicks: number | null
    imageUrl: string | null
  } | null
  isPaused: boolean
  positionTicks: number
  playMethod: string | null
}

type ClientAdminUser = {
  id: string
  name: string
  isAdmin: boolean
  isDisabled: boolean
  lastLoginDate: string | null
  hasPolicy: boolean
}

type ClientAdminLibrary = {
  itemId: string
  name: string
  collectionType: string
  locations: string[]
}

type ClientJellyfinSystemInfo = ClientAdminOverview['systemInfo']
type ClientJellyfinItemCounts = ClientAdminOverview['counts']

type ClientJellyfinActiveSession = {
  Id: string
  UserName?: string
  Client?: string
  DeviceName?: string
  LastActivityDate?: string
  NowPlayingItem?: {
    Id: string
    Name: string
    Type: string
    RunTimeTicks?: number
    PrimaryImageTag?: string
    SeriesName?: string
  }
  PlayState?: {
    PositionTicks?: number
    IsPaused?: boolean
    PlayMethod?: string
  }
}

type ClientJellyfinUser = {
  Id: string
  Name: string
  LastLoginDate?: string
  Policy?: {
    IsAdministrator?: boolean
    IsDisabled?: boolean
    [key: string]: unknown
  }
}

type ClientJellyfinVirtualFolder = {
  Name: string
  CollectionType?: string
  ItemId: string
  Locations?: string[]
}

export async function fetchClientAdminOverview(): Promise<ClientAdminOverview> {
  const settings = getRequiredClientSettings()
  const [systemInfo, counts] = await Promise.all([
    clientJellyfinFetch<ClientJellyfinSystemInfo>('/System/Info', undefined, settings),
    clientJellyfinFetch<ClientJellyfinItemCounts>('/Items/Counts', { UserId: settings.userId }, settings),
  ])

  return {
    systemInfo,
    counts,
    serverUrl: settings.url,
    apiKey: settings.apiKey,
  }
}

export async function fetchClientAdminSessions(): Promise<ClientAdminSession[]> {
  const settings = getRequiredClientSettings()
  const sessions = await clientJellyfinFetch<ClientJellyfinActiveSession[]>('/Sessions', undefined, settings)

  return sessions.map((session) => ({
    id: session.Id,
    userName: session.UserName ?? null,
    client: session.Client ?? null,
    deviceName: session.DeviceName ?? null,
    lastActivityDate: session.LastActivityDate ?? null,
    nowPlaying: session.NowPlayingItem
      ? {
          id: session.NowPlayingItem.Id,
          name: session.NowPlayingItem.Name,
          type: session.NowPlayingItem.Type,
          seriesName: session.NowPlayingItem.SeriesName ?? null,
          runTimeTicks: session.NowPlayingItem.RunTimeTicks ?? null,
          imageUrl: session.NowPlayingItem.PrimaryImageTag
            ? clientJellyfinImageUrl(session.NowPlayingItem.Id, 'Primary', 300, settings)
            : null,
        }
      : null,
    isPaused: session.PlayState?.IsPaused ?? false,
    positionTicks: session.PlayState?.PositionTicks ?? 0,
    playMethod: session.PlayState?.PlayMethod ?? null,
  }))
}

export async function fetchClientAdminUsers(): Promise<ClientAdminUser[]> {
  const users = await clientJellyfinFetch<ClientJellyfinUser[]>('/Users')
  return users.map((user) => ({
    id: user.Id,
    name: user.Name,
    isAdmin: user.Policy?.IsAdministrator ?? false,
    isDisabled: user.Policy?.IsDisabled ?? false,
    lastLoginDate: user.LastLoginDate ?? null,
    hasPolicy: user.Policy != null,
  }))
}

export async function toggleClientAdminUser(input: { userId: string; disabled: boolean }) {
  const user = await clientJellyfinFetch<ClientJellyfinUser>(`/Users/${input.userId}`)
  const policy = { ...(user.Policy ?? {}), IsDisabled: input.disabled }
  await clientJellyfinWrite(`/Users/${input.userId}/Policy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(policy),
  })
  return { ok: true }
}

export async function deleteClientAdminUser(userId: string) {
  await clientJellyfinWrite(`/Users/${userId}`, { method: 'DELETE' })
  return { ok: true }
}

export async function createClientAdminUser(input: { name: string; password: string }): Promise<ClientAdminUser> {
  const response = await clientJellyfinWrite('/Users/New', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Name: input.name, Password: input.password }),
  })
  const user = (await response.json()) as ClientJellyfinUser
  return {
    id: user.Id,
    name: user.Name,
    isAdmin: user.Policy?.IsAdministrator ?? false,
    isDisabled: user.Policy?.IsDisabled ?? false,
    lastLoginDate: user.LastLoginDate ?? null,
    hasPolicy: user.Policy != null,
  }
}

export async function fetchClientAdminLibraries(): Promise<ClientAdminLibrary[]> {
  const folders = await clientJellyfinFetch<ClientJellyfinVirtualFolder[]>('/Library/VirtualFolders')
  return folders.map((folder) => ({
    itemId: folder.ItemId,
    name: folder.Name,
    collectionType: folder.CollectionType ?? 'unknown',
    locations: folder.Locations ?? [],
  }))
}

export async function scanAllClientAdminLibraries() {
  await clientJellyfinWrite('/Library/Refresh', { method: 'POST' })
  return { ok: true }
}

export async function scanClientAdminLibrary(itemId: string) {
  await clientJellyfinWrite(`/Items/${itemId}/Refresh`, { method: 'POST' })
  return { ok: true }
}

export async function fetchClientRecommendedFromItem(itemId: string) {
  const settings = getRequiredClientSettings()
  const data = await clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Items/${itemId}/Similar`,
    {
      UserId: settings.userId,
      Limit: '8',
      Fields: 'Overview,GenreItems,UserData',
    },
    settings,
  )

  return data.Items.map((item) => fromClientJellyfin(item, settings))
}

export async function fetchClientWatchHistory(page = 0) {
  const settings = getRequiredClientSettings()
  const data = await clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${settings.userId}/Items`,
    {
      Filters: 'IsPlayed',
      SortBy: 'DatePlayed',
      SortOrder: 'Descending',
      Recursive: 'true',
      IncludeItemTypes: 'Movie,Series',
      Limit: '24',
      StartIndex: String(page * 24),
      Fields: 'Overview,GenreItems,UserData',
    },
    settings,
  )

  return {
    items: data.Items.map((item) => fromClientJellyfin(item, settings)),
    total: data.TotalRecordCount,
    page,
  }
}

export async function fetchClientSearch(query: string) {
  if (!query.trim()) return []

  const settings = getRequiredClientSettings()
  const data = await clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
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

  return data.Items.map((item) => fromClientJellyfin(item, settings))
}

export async function fetchClientItemDetails(itemId: string) {
  const settings = getRequiredClientSettings()
  const [item, similar] = await Promise.all([
    clientJellyfinFetch<JellyfinItem>(
      `/Users/${settings.userId}/Items/${itemId}`,
      { Fields: 'Overview,GenreItems,UserData,People,Studios' },
      settings,
    ),
    clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
      `/Items/${itemId}/Similar`,
      {
        UserId: settings.userId,
        Limit: '8',
        Fields: 'Overview,GenreItems,UserData',
      },
      settings,
    ),
  ])

  return {
    item: fromClientJellyfinDetailed(item, settings),
    similar: similar.Items.map((entry) => fromClientJellyfin(entry, settings)),
  }
}

export async function fetchClientSeriesDetails(seriesId: string): Promise<SeriesDetailPayload> {
  const settings = getRequiredClientSettings()
  const [item, episodes, nextUp, similar] = await Promise.all([
    clientJellyfinFetch<JellyfinItem>(
      `/Users/${settings.userId}/Items/${seriesId}`,
      { Fields: 'Overview,GenreItems,UserData,People,Studios' },
      settings,
    ),
    clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
      `/Shows/${seriesId}/Episodes`,
      {
        UserId: settings.userId,
        Limit: '200',
        SortBy: 'ParentIndexNumber,IndexNumber',
        Fields: 'Overview,GenreItems,UserData',
      },
      settings,
    ).catch(() => ({ Items: [], TotalRecordCount: 0 })),
    clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
      '/Shows/NextUp',
      {
        UserId: settings.userId,
        SeriesId: seriesId,
        Limit: '6',
        Fields: 'Overview,GenreItems,UserData',
      },
      settings,
    ).catch(() => ({ Items: [], TotalRecordCount: 0 })),
    clientJellyfinFetch<JellyfinResponse<JellyfinItem>>(
      `/Items/${seriesId}/Similar`,
      {
        UserId: settings.userId,
        Limit: '8',
        Fields: 'Overview,GenreItems,UserData',
      },
      settings,
    ),
  ])

  return {
    item: fromClientJellyfinDetailed(item, settings),
    episodes: episodes.Items.map((entry) => fromClientJellyfin(entry, settings)),
    nextUp: nextUp.Items.map((entry) => fromClientJellyfin(entry, settings)),
    similar: similar.Items.map((entry) => fromClientJellyfin(entry, settings)),
  }
}

export async function beginClientPlaybackSession(itemId: string, client?: ClientPlaybackContext) {
  const settings = getRequiredClientSettings()
  const playMethod: 'Transcode' | 'DirectPlay' = client?.prefersSafeVideo ? 'Transcode' : 'DirectPlay'

  return {
    streamUrl: playMethod === 'Transcode'
      ? clientJellyfinTranscodeUrl(itemId, settings)
      : clientJellyfinStreamUrl(itemId, settings),
    canSyncProgress: false,
    playMethod,
    subtitleTracks: [],
  }
}

export async function reportClientPlaybackState(input: {
  id: string
  played?: boolean
}) {
  if (input.played) {
    return markClientPlayed({ id: input.id, played: true })
  }

  return {
    id: input.id,
    progressSynced: false,
    playedSynced: false,
  }
}

export async function searchClientOnlineSubtitles(input: {
  title: string
  year?: number
  season?: number
  episode?: number
}): Promise<ClientOnlineSubtitleResult[]> {
  const apiKey = getClientOpenSubtitlesApiKey()?.trim()
  if (!apiKey) return []

  const params = new URLSearchParams({
    query: input.title,
    order_by: 'download_count',
    order_direction: 'desc',
  })
  if (input.year) params.set('year', String(input.year))
  if (input.season) params.set('season_number', String(input.season))
  if (input.episode) params.set('episode_number', String(input.episode))

  const response = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?${params.toString()}`, {
    headers: {
      'Api-Key': apiKey,
      'Content-Type': 'application/json',
      'User-Agent': 'Aurora v1.0.0',
    },
  }).catch(() => null)

  if (!response?.ok) return []

  const json = await response.json() as {
    data: Array<{
      id: string
      attributes: {
        language: string
        files: Array<{ file_id: number }>
      }
    }>
  }

  const seenLanguages = new Set<string>()
  return json.data
    .filter((subtitle) => subtitle.attributes.files[0]?.file_id)
    .filter((subtitle) => {
      if (seenLanguages.has(subtitle.attributes.language)) return false
      seenLanguages.add(subtitle.attributes.language)
      return true
    })
    .slice(0, 12)
    .map((subtitle) => ({
      id: subtitle.id,
      language: subtitle.attributes.language,
      label: LANGUAGE_NAMES[subtitle.attributes.language] ?? subtitle.attributes.language.toUpperCase(),
      fileId: subtitle.attributes.files[0].file_id,
    }))
}

function srtToVtt(srt: string): string {
  return `WEBVTT\n\n${srt.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
}

export async function fetchClientOnlineSubtitle(fileId: number) {
  const apiKey = getClientOpenSubtitlesApiKey()?.trim()
  if (!apiKey) throw new Error('No OpenSubtitles API key configured')

  const linkResponse = await fetch('https://api.opensubtitles.com/api/v1/download', {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      'Content-Type': 'application/json',
      'User-Agent': 'Aurora v1.0.0',
    },
    body: JSON.stringify({ file_id: fileId }),
  })

  if (!linkResponse.ok) throw new Error('Failed to get subtitle download link')
  const { link } = await linkResponse.json() as { link: string }

  const subtitleResponse = await fetch(link)
  if (!subtitleResponse.ok) throw new Error('Failed to download subtitle')

  const raw = await subtitleResponse.text()
  return {
    content: raw.trimStart().startsWith('WEBVTT') ? raw : srtToVtt(raw),
  }
}

export async function toggleClientFavorite(input: { id: string; isFavorite: boolean }) {
  const settings = getRequiredClientSettings()
  const url = new URL(`${settings.url}/Users/${settings.userId}/FavoriteItems/${input.id}`)
  url.searchParams.set('api_key', settings.apiKey)

  const response = await fetch(url.toString(), {
    method: input.isFavorite ? 'DELETE' : 'POST',
  })

  if (!response.ok) {
    throw new Error(`Jellyfin favorite error: ${response.status} ${response.statusText}`)
  }

  const result = await response.json() as { IsFavorite: boolean }
  return { id: input.id, isFavorite: result.IsFavorite }
}

export async function markClientPlayed(input: { id: string; played: boolean }) {
  const settings = getRequiredClientSettings()
  const url = new URL(`${settings.url}/Users/${settings.userId}/PlayedItems/${input.id}`)
  url.searchParams.set('api_key', settings.apiKey)

  const response = await fetch(url.toString(), {
    method: input.played ? 'POST' : 'DELETE',
  })

  if (!response.ok) {
    throw new Error(`Jellyfin played-state error: ${response.status} ${response.statusText}`)
  }

  const result = await response.json() as { Played: boolean }
  return { id: input.id, played: result.Played }
}