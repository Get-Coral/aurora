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
  playbackPositionTicks?: number
  played?: boolean
  isFavorite?: boolean
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  streamUrl?: string
}

export interface MediaPerson {
  id: string
  name: string
  role?: string
  type?: string
  imageUrl?: string
}

export interface DetailedMediaItem extends MediaItem {
  cast: MediaPerson[]
  studios: string[]
  tags: string[]
}

export interface SeriesDetailPayload {
  item: DetailedMediaItem
  episodes: MediaItem[]
  nextUp: MediaItem[]
  similar: MediaItem[]
}

export function isResumable(item: Pick<MediaItem, 'progress' | 'playbackPositionTicks' | 'played'>) {
  return Boolean(
    !item.played &&
      ((item.progress != null && item.progress > 0) ||
        (item.playbackPositionTicks != null && item.playbackPositionTicks > 0)),
  )
}

import type { JellyfinItem } from './jellyfin'
import {
  jellyfinImageUrl,
  jellyfinPersonImageUrl,
  jellyfinStreamUrl,
} from './jellyfin'

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
    playbackPositionTicks: item.UserData?.PlaybackPositionTicks,
    played: item.UserData?.Played,
    isFavorite: item.UserData?.IsFavorite,
    seriesTitle: item.SeriesName,
    seasonNumber: item.ParentIndexNumber,
    episodeNumber: item.IndexNumber,
    streamUrl: jellyfinStreamUrl(item.Id),
  }
}

export function fromJellyfinDetailed(item: JellyfinItem): DetailedMediaItem {
  const base = fromJellyfin(item)

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
            ? jellyfinPersonImageUrl(person.Id, 240)
            : undefined,
        })) ?? [],
    studios: item.Studios?.map((studio) => studio.Name) ?? [],
    tags: item.Tags ?? [],
  }
}
