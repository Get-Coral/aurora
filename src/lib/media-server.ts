import type { JellyfinItem } from "./jellyfin";
import { jellyfinStreamUrl } from "./jellyfin";
import { jellyfinImageProxyUrl } from "./jellyfin-image-proxy";
import { jellyfinStreamProxyUrl } from "./jellyfin-stream-proxy";
import type { DetailedMediaItem, MediaItem, MediaPerson, MediaType } from "./media";

export function fromJellyfin(item: JellyfinItem): MediaItem {
	const type: MediaType =
		item.Type === "Movie"
			? "movie"
			: item.Type === "Episode"
				? "episode"
				: item.Type === "BoxSet"
					? "collection"
					: "series";

	return {
		id: item.Id,
		source: "jellyfin",
		type,
		title: item.Name,
		year: item.ProductionYear,
		runtimeMinutes: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600_000_000) : undefined,
		overview: item.Overview,
		rating: item.CommunityRating,
		ageRating: item.OfficialRating,
		genres: item.GenreItems?.map((g) => g.Name) ?? [],
		posterUrl: item.ImageTags?.Primary
			? jellyfinImageProxyUrl(item.Id, "Primary", 400, { tag: item.ImageTags.Primary })
			: undefined,
		backdropUrl: item.BackdropImageTags?.[0]
			? jellyfinImageProxyUrl(item.Id, "Backdrop", 1920, { tag: item.BackdropImageTags[0] })
			: undefined,
		thumbUrl: item.ImageTags?.Thumb
			? jellyfinImageProxyUrl(item.Id, "Thumb", 600, { tag: item.ImageTags.Thumb })
			: undefined,
		logoUrl: item.ImageTags?.Logo
			? jellyfinImageProxyUrl(item.Id, "Logo", 900, { tag: item.ImageTags.Logo })
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
		streamUrl:
			type === "collection" ? undefined : jellyfinStreamProxyUrl(jellyfinStreamUrl(item.Id)),
	};
}

export function fromJellyfinDetailed(item: JellyfinItem): DetailedMediaItem {
	const base = fromJellyfin(item);

	return {
		...base,
		cast:
			item.People?.filter((person) => person.Type === "Actor" || person.Role)
				.slice(0, 10)
				.map(
					(person) =>
						({
							id: person.Id,
							name: person.Name,
							role: person.Role,
							type: person.Type,
							imageUrl: person.PrimaryImageTag
								? jellyfinImageProxyUrl(person.Id, "Primary", 240, { tag: person.PrimaryImageTag })
								: undefined,
						}) satisfies MediaPerson,
				) ?? [],
		studios: item.Studios?.map((studio) => studio.Name) ?? [],
		tags: item.Tags ?? [],
	};
}
