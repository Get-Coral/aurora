import {
  addItemsToCollection,
  createClient,
  createCollection,
  createPlaybackSession,
  createUser,
  deleteItem,
  deleteUser,
  getActiveSessions,
  getCollectionItems,
  getCollections,
  getContinueWatching,
  getEpisodesForSeries,
  getFavoriteItems,
  getFeaturedItem,
  getItem,
  getItemCounts,
  getLatestMedia,
  getLibraryItems,
  getMostPlayed,
  getNextUpForSeries,
  getSimilarItems,
  getSystemInfo,
  getUserById,
  getUsers,
  getVirtualFolders,
  getWatchHistory,
  imageUrl,
  personImageUrl,
  removeItemsFromCollection,
  scanAllLibraries,
  scanLibrary,
  searchItems,
  setFavorite,
  setPlayed,
  streamUrl,
  updateItemName,
  updateUserPolicy,
  type JellyfinActiveSession,
  type JellyfinItem,
  type JellyfinItemCounts,
  type JellyfinMediaType,
  type JellyfinResponse,
  type JellyfinSystemInfo,
  type JellyfinUser,
  type JellyfinUserPolicy,
  type JellyfinVirtualFolder,
} from '@get-coral/jellyfin'
import {
  getClientOpenSubtitlesApiKey,
  getEffectiveClientJellyfinSettings,
} from './client-config-store'
import { setTranscodeQuality } from './jellyfin-stream-proxy'
import type { DetailedMediaItem, MediaItem, SeriesDetailPayload } from './media'
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

function withImageTag(url: string, tag?: string): string {
  if (!tag) return url
  const value = tag.trim()
  if (!value) return url

  const next = new URL(url)
  if (!next.searchParams.has('tag')) {
    next.searchParams.set('tag', value)
  }
  return next.toString()
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

function getClientJellyfin() {
  const settings = getRequiredClientSettings()

  return createClient({
    url: settings.url,
    apiKey: settings.apiKey,
    userId: settings.userId,
    username: settings.username,
    password: settings.password,
    clientName: 'Aurora',
    deviceName: 'Aurora Local',
    deviceId: 'aurora-ui-local',
    version: '1.0.0',
  })
}

function fromClientJellyfin(item: JellyfinItem): MediaItem {
  const client = getClientJellyfin()
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
      ? withImageTag(imageUrl(client, item.Id, 'Primary', 400), item.ImageTags.Primary)
      : undefined,
    backdropUrl: item.BackdropImageTags?.[0]
      ? withImageTag(imageUrl(client, item.Id, 'Backdrop', 1920), item.BackdropImageTags[0])
      : undefined,
    thumbUrl: item.ImageTags?.Thumb
      ? withImageTag(imageUrl(client, item.Id, 'Thumb', 600), item.ImageTags.Thumb)
      : undefined,
    logoUrl: item.ImageTags?.Logo
      ? withImageTag(imageUrl(client, item.Id, 'Logo', 900), item.ImageTags.Logo)
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
    streamUrl: type === 'collection' ? undefined : streamUrl(client, item.Id),
  }
}

function fromClientJellyfinDetailed(item: JellyfinItem): DetailedMediaItem {
  const client = getClientJellyfin()
  const base = fromClientJellyfin(item)

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
            ? withImageTag(personImageUrl(client, person.Id, 240), person.PrimaryImageTag)
            : undefined,
        })) ?? [],
    studios: item.Studios?.map((studio) => studio.Name) ?? [],
    tags: item.Tags ?? [],
  }
}

export async function fetchClientContinueWatching() {
  const items = await getContinueWatching(getClientJellyfin())
  return items.map(fromClientJellyfin)
}

export async function fetchClientFeatured() {
  const item = await getFeaturedItem(getClientJellyfin())
  return item ? fromClientJellyfin(item) : null
}

export async function fetchClientLatestMedia(type: JellyfinMediaType = 'Movie') {
  const items = await getLatestMedia(getClientJellyfin(), type)
  return items.map(fromClientJellyfin)
}

export async function fetchClientFavoriteItems(type: JellyfinMediaType = 'Movie') {
  const items = await getFavoriteItems(getClientJellyfin(), type)
  return items.map(fromClientJellyfin)
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
  const page = input.page ?? 0
  const decadeRange = input.decade ? DECADE_RANGES[input.decade] : undefined
  const result = await getLibraryItems(getClientJellyfin(), input.type, {
    sortBy: input.sortBy ?? 'DateCreated',
    sortOrder: input.sortOrder ?? 'Descending',
    limit: 24,
    startIndex: page * 24,
    genre: input.genre,
    filters: input.favoritesOnly ? 'IsFavorite' : undefined,
    watchStatus: input.watchStatus,
    officialRatings: input.ratings,
    minCommunityRating: input.minScore,
    minPremiereDate: decadeRange?.min,
    maxPremiereDate: decadeRange?.max,
  })

  return {
    items: result.Items.map(fromClientJellyfin),
    total: result.TotalRecordCount,
    page,
  }
}

export async function fetchClientMostPlayed(type: JellyfinMediaType = 'Movie', limit = 12) {
  const items = await getMostPlayed(getClientJellyfin(), type, limit)
  return items.map(fromClientJellyfin)
}

export async function fetchClientCollections() {
  const items = await getCollections(getClientJellyfin())
  return items.map(fromClientJellyfin)
}

export async function fetchClientCollectionItems(collectionId: string) {
  const client = getClientJellyfin()
  const [items, collection] = await Promise.all([
    getCollectionItems(client, collectionId),
    getItem(client, collectionId),
  ])

  return {
    collection: fromClientJellyfin(collection),
    items: items.map(fromClientJellyfin),
  }
}

export async function createClientCollection(name: string) {
  return createCollection(getClientJellyfin(), name)
}

export async function deleteClientCollection(id: string) {
  await deleteItem(getClientJellyfin(), id)
}

export async function renameClientCollection(id: string, name: string) {
  await updateItemName(getClientJellyfin(), id, name)
}

export async function addClientItemsToCollection(collectionId: string, itemIds: string[]) {
  await addItemsToCollection(getClientJellyfin(), collectionId, itemIds)
}

export async function removeClientItemFromCollection(collectionId: string, itemId: string) {
  await removeItemsFromCollection(getClientJellyfin(), collectionId, [itemId])
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

export async function fetchClientAdminOverview(): Promise<ClientAdminOverview> {
  const client = getClientJellyfin()
  const settings = getRequiredClientSettings()
  const [systemInfo, counts] = await Promise.all([
    getSystemInfo(client),
    getItemCounts(client),
  ])

  return {
    systemInfo: systemInfo as JellyfinSystemInfo,
    counts: counts as JellyfinItemCounts,
    serverUrl: settings.url,
    apiKey: settings.apiKey,
  }
}

export async function fetchClientAdminSessions(): Promise<ClientAdminSession[]> {
  const client = getClientJellyfin()
  const sessions = await getActiveSessions(client)

  return sessions.map((session: JellyfinActiveSession) => ({
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
            ? withImageTag(
                imageUrl(client, session.NowPlayingItem.Id, 'Primary', 300),
                session.NowPlayingItem.PrimaryImageTag,
              )
            : null,
        }
      : null,
    isPaused: session.PlayState?.IsPaused ?? false,
    positionTicks: session.PlayState?.PositionTicks ?? 0,
    playMethod: session.PlayState?.PlayMethod ?? null,
  }))
}

export async function fetchClientAdminUsers(): Promise<ClientAdminUser[]> {
  const users = await getUsers(getClientJellyfin())
  return users.map((user: JellyfinUser) => ({
    id: user.Id,
    name: user.Name,
    isAdmin: user.Policy?.IsAdministrator ?? false,
    isDisabled: user.Policy?.IsDisabled ?? false,
    lastLoginDate: user.LastLoginDate ?? null,
    hasPolicy: user.Policy != null,
  }))
}

export async function toggleClientAdminUser(input: { userId: string; disabled: boolean }) {
  const client = getClientJellyfin()
  const user = await getUserById(client, input.userId)
  const policy: JellyfinUserPolicy = { ...(user.Policy ?? {}), IsDisabled: input.disabled }
  await updateUserPolicy(client, input.userId, policy)
  return { ok: true }
}

export async function deleteClientAdminUser(userId: string) {
  await deleteUser(getClientJellyfin(), userId)
  return { ok: true }
}

export async function createClientAdminUser(input: { name: string; password: string }): Promise<ClientAdminUser> {
  const user = await createUser(getClientJellyfin(), input.name, input.password)
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
  const folders = await getVirtualFolders(getClientJellyfin())
  return folders.map((folder: JellyfinVirtualFolder) => ({
    itemId: folder.ItemId,
    name: folder.Name,
    collectionType: folder.CollectionType ?? 'unknown',
    locations: folder.Locations ?? [],
  }))
}

export async function scanAllClientAdminLibraries() {
  await scanAllLibraries(getClientJellyfin())
  return { ok: true }
}

export async function scanClientAdminLibrary(itemId: string) {
  await scanLibrary(getClientJellyfin(), itemId)
  return { ok: true }
}

export async function fetchClientRecommendedFromItem(itemId: string) {
  const items = await getSimilarItems(getClientJellyfin(), itemId)
  return items.map(fromClientJellyfin)
}

export async function fetchClientWatchHistory(page = 0) {
  const data = await getWatchHistory(getClientJellyfin(), { limit: 24, startIndex: page * 24 })

  return {
    items: data.Items.map(fromClientJellyfin),
    total: data.TotalRecordCount,
    page,
  }
}

export async function fetchClientSearch(query: string) {
  if (!query.trim()) return []

  const items = await searchItems(getClientJellyfin(), query)
  return items.map(fromClientJellyfin)
}

export async function fetchClientItemDetails(itemId: string) {
  const client = getClientJellyfin()
  const [item, similar] = await Promise.all([
    getItem(client, itemId),
    getSimilarItems(client, itemId),
  ])

  return {
    item: fromClientJellyfinDetailed(item),
    similar: similar.map(fromClientJellyfin),
  }
}

export async function fetchClientSeriesDetails(seriesId: string): Promise<SeriesDetailPayload> {
  const client = getClientJellyfin()
  const [item, episodes, nextUp, similar] = await Promise.all([
    getItem(client, seriesId),
    getEpisodesForSeries(client, seriesId),
    getNextUpForSeries(client, seriesId),
    getSimilarItems(client, seriesId),
  ])

  return {
    item: fromClientJellyfinDetailed(item),
    episodes: episodes.map(fromClientJellyfin),
    nextUp: nextUp.map(fromClientJellyfin),
    similar: similar.map(fromClientJellyfin),
  }
}

export async function beginClientPlaybackSession(itemId: string, client?: ClientPlaybackContext) {
  const session = await createPlaybackSession(getClientJellyfin(), itemId, {
    prefersSafeVideo: client?.prefersSafeVideo,
  })
  return {
    ...session,
    streamUrl: session.playMethod === 'Transcode' ? setTranscodeQuality(session.streamUrl) : session.streamUrl,
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
  const result = await setFavorite(getClientJellyfin(), input.id, input.isFavorite)
  return { id: input.id, isFavorite: result.IsFavorite }
}

export async function markClientPlayed(input: { id: string; played: boolean }) {
  const result = await setPlayed(getClientJellyfin(), input.id, input.played)
  return { id: input.id, played: result.Played }
}
