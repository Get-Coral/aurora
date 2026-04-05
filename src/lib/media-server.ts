import type { JellyfinItem } from './jellyfin'
import { jellyfinImageUrl, jellyfinPersonImageUrl, jellyfinStreamUrl } from './jellyfin'
import type { DetailedMediaItem, MediaItem, MediaPerson, MediaType } from './media'

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
        } satisfies MediaPerson)) ?? [],
    studios: item.Studios?.map((studio) => studio.Name) ?? [],
    tags: item.Tags ?? [],
  }
}
