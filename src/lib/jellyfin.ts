const BASE_URL = process.env['JELLYFIN_URL'] ?? 'http://localhost:8096'
const API_KEY = process.env['JELLYFIN_API_KEY'] ?? ''
const USER_ID = process.env['JELLYFIN_USER_ID'] ?? ''

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

export function jellyfinStreamUrl(itemId: string): string {
  return `${BASE_URL}/Videos/${itemId}/stream?static=true&api_key=${API_KEY}`
}

export async function getContinueWatching(): Promise<JellyfinItem[]> {
  const data = await jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${USER_ID}/Items/Resume`,
    { MediaTypes: 'Video', Limit: '6', Fields: 'Overview,GenreItems,UserData' },
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
  { sortBy = 'SortName', limit = 24, startIndex = 0 } = {},
): Promise<JellyfinResponse<JellyfinItem>> {
  return jellyfinFetch<JellyfinResponse<JellyfinItem>>(
    `/Users/${USER_ID}/Items`,
    {
      IncludeItemTypes: type,
      SortBy: sortBy,
      SortOrder: 'Ascending',
      Recursive: 'true',
      Limit: String(limit),
      StartIndex: String(startIndex),
      Fields: 'Overview,GenreItems,UserData',
    },
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
