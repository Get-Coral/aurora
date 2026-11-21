import type { JellyfinClient, JellyfinItem } from "@get-coral/jellyfin";
import type { MediaItem } from "./media";
import type { SearchPerson, SearchResults } from "./search";

/**
 * Library search for both runtimes (server and native app): films, series,
 * episodes, collections and people, in one round trip each.
 */
export async function searchLibraryWith(client: JellyfinClient, query: string) {
	const userId = client.config.userId;
	const [items, people] = await Promise.all([
		client.fetch<{ Items?: JellyfinItem[] }>(`/Users/${userId}/Items`, {
			SearchTerm: query,
			Recursive: "true",
			Limit: "60",
			Fields: "Overview,GenreItems,UserData",
			IncludeItemTypes: "Movie,Series,Episode,BoxSet",
			EnableTotalRecordCount: "false",
		}),
		client
			.fetch<{ Items?: JellyfinItem[] }>("/Persons", {
				SearchTerm: query,
				Limit: "12",
				UserId: userId,
				EnableTotalRecordCount: "false",
			})
			.catch(() => ({ Items: [] as JellyfinItem[] })),
	]);
	return { items: items.Items ?? [], people: people.Items ?? [] };
}

export async function getPersonItemsWith(client: JellyfinClient, personId: string) {
	const data = await client.fetch<{ Items?: JellyfinItem[] }>(
		`/Users/${client.config.userId}/Items`,
		{
			PersonIds: personId,
			Recursive: "true",
			IncludeItemTypes: "Movie,Series",
			SortBy: "PremiereDate,SortName",
			SortOrder: "Descending",
			Fields: "Overview,GenreItems,UserData",
			Limit: "200",
		},
	);
	return data.Items ?? [];
}

/** Sort library hits into search sections. */
export function librarySearchParts(
	found: { items: JellyfinItem[]; people: JellyfinItem[] },
	toMedia: (item: JellyfinItem) => MediaItem,
	personImage: (person: JellyfinItem) => string | undefined,
): Partial<SearchResults> {
	const media = found.items.map(toMedia);
	return {
		movies: media.filter((item) => item.type === "movie"),
		series: media.filter((item) => item.type === "series"),
		episodes: media.filter((item) => item.type === "episode"),
		collections: media.filter((item) => item.type === "collection"),
		people: found.people.map(
			(person): SearchPerson => ({
				id: person.Id,
				name: person.Name,
				imageUrl: person.ImageTags?.Primary ? personImage(person) : undefined,
			}),
		),
	};
}

/**
 * The next unwatched episode of series in progress. The first episode of a
 * series nobody started is left out, so new shows don't flood the list.
 */
export async function getNextUpWith(client: JellyfinClient, limit = 12) {
	const data = await client.fetch<{ Items?: JellyfinItem[] }>("/Shows/NextUp", {
		UserId: client.config.userId,
		Limit: String(limit),
		Fields: "Overview,GenreItems,UserData",
		DisableFirstEpisode: "true",
		EnableTotalRecordCount: "false",
	});
	return data.Items ?? [];
}
