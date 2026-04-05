export type MediaSource = 'jellyfin' | 'plex'
export type MediaType = 'movie' | 'series' | 'episode'

export interface MediaItem {
  id: string
  source: MediaSource
  type: MediaType
  title: string
  year?: number
  runtimeMinutes?: number
  overview?: string
  rating?: number
  ageRating?: string
  genres: string[]
  posterUrl?: string
  backdropUrl?: string
  thumbUrl?: string
  logoUrl?: string
  progress?: number
  played?: boolean
  isFavorite?: boolean
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  streamUrl?: string
}

import type { JellyfinItem } from './jellyfin'
import { jellyfinImageUrl, jellyfinStreamUrl } from './jellyfin'

export function fromJellyfin(item: JellyfinItem): MediaItem {
  const type: MediaType =
    item.Type === 'Movie' ? 'movie' : item.Type === 'Episode' ? 'episode' : 'series'

  return {
    id: item.Id,
    source: 'jellyfin',
    type,
    title: item.Name,
    year: item.ProductionYear,
    runtimeMinutes: item.RunTimeTicks
      ? Math.round(item.RunTimeTicks / 600_000_000)
      : undefined,
    overview: item.Overview,
    rating: item.CommunityRating,
    ageRating: item.OfficialRating,
    genres: item.GenreItems?.map((g) => g.Name) ?? [],
    posterUrl: item.ImageTags?.Primary
      ? jellyfinImageUrl(item.Id, 'Primary', 400)
      : undefined,
    backdropUrl: item.BackdropImageTags?.[0]
      ? jellyfinImageUrl(item.Id, 'Backdrop', 1920)
      : undefined,
    thumbUrl: item.ImageTags?.Thumb
      ? jellyfinImageUrl(item.Id, 'Thumb', 600)
      : undefined,
    logoUrl: item.ImageTags?.Logo
      ? jellyfinImageUrl(item.Id, 'Logo', 900)
      : undefined,
    progress: item.UserData?.PlayedPercentage,
    played: item.UserData?.Played,
    isFavorite: item.UserData?.IsFavorite,
    seriesTitle: item.SeriesName,
    seasonNumber: item.ParentIndexNumber,
    episodeNumber: item.IndexNumber,
    streamUrl: jellyfinStreamUrl(item.Id),
  }
}
