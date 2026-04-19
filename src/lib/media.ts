export type MediaSource = "jellyfin" | "plex";
export type MediaType = "movie" | "series" | "episode" | "collection";

export interface MediaItem {
	id: string;
	source: MediaSource;
	type: MediaType;
	title: string;
	year?: number;
	runtimeMinutes?: number;
	overview?: string;
	rating?: number;
	ageRating?: string;
	genres: string[];
	posterUrl?: string;
	backdropUrl?: string;
	thumbUrl?: string;
	logoUrl?: string;
	progress?: number;
	playbackPositionTicks?: number;
	played?: boolean;
	isFavorite?: boolean;
	seriesTitle?: string;
	seasonNumber?: number;
	episodeNumber?: number;
	streamUrl?: string;
	childCount?: number;
	watchedAt?: string;
}

export interface MediaPerson {
	id: string;
	name: string;
	role?: string;
	type?: string;
	imageUrl?: string;
}

export interface DetailedMediaItem extends MediaItem {
	cast: MediaPerson[];
	studios: string[];
	tags: string[];
}

export interface SeriesDetailPayload {
	item: DetailedMediaItem;
	episodes: MediaItem[];
	nextUp: MediaItem[];
	similar: MediaItem[];
}

export interface UserProfileSummary {
	id: string;
	name: string;
	imageUrl?: string;
	hasPassword: boolean;
}

export function isResumable(
	item: Pick<MediaItem, "progress" | "playbackPositionTicks" | "played">,
) {
	return Boolean(
		!item.played &&
			((item.progress != null && item.progress > 0) ||
				(item.playbackPositionTicks != null && item.playbackPositionTicks > 0)),
	);
}
