export type MediaSource = "jellyfin" | "plex" | "iptv";
export type MediaType = "movie" | "series" | "episode" | "collection" | "channel";

/** A programme in a live channel's guide. Times are epoch milliseconds. */
export interface MediaProgramme {
	title: string;
	start: number;
	end: number;
	description?: string;
	/** Item id that plays this programme from the provider's archive. */
	replayId?: string;
}

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
	/** A live channel: no seeking, no progress. */
	live?: boolean;
	/** The provider category an IPTV item belongs to. */
	group?: string;
	channelNumber?: number;
	epg?: { now?: MediaProgramme; next?: MediaProgramme };
	/** The day's guide for a live channel, earlier programmes included. */
	schedule?: MediaProgramme[];
	/** A guide programme this item stands for (search, catch-up). */
	airing?: MediaProgramme;
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

export interface AvatarPosterCandidate {
	itemId: string;
	name: string;
	imageUrl: string;
}

export interface AvatarPersonCandidate {
	personId: string;
	name: string;
	role?: string;
	imageUrl: string;
}

export interface AvatarCandidates {
	posters: AvatarPosterCandidate[];
	people: AvatarPersonCandidate[];
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
