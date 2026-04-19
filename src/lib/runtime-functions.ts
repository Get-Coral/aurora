import {
	beginPlaybackSession,
	clearActiveUserServerFn,
	fetchContinueWatching,
	fetchCurrentProfile,
	fetchFavoriteMovies,
	fetchFeatured,
	fetchItemDetails,
	fetchLatestMovies,
	fetchLatestSeries,
	fetchLibrary,
	fetchMostPlayed,
	fetchMultiUserSettings,
	fetchMyList,
	fetchOnlineSubtitle,
	fetchOpenSubtitlesKey,
	fetchRecommendedFromItem,
	fetchSearch,
	fetchSeriesDetails,
	fetchSetupStatus,
	fetchUsername,
	fetchUserPolicy,
	fetchWatchHistory,
	markPlayed,
	reportPlaybackState,
	saveOpenSubtitlesKey,
	saveServerConnectionFn,
	saveSettings,
	saveSetupConfiguration,
	searchOnlineSubtitles,
	setActiveUserServerFn,
	setMultiUserModeServerFn,
	toggleFavorite,
	updateCurrentProfileImage,
	updateCurrentProfilePassword,
	updateUserParentalPolicy,
	uploadCurrentProfileImage,
} from "../server/functions";
import {
	type ClientJellyfinSettings,
	clearClientActiveUserId,
	clearStoredClientJellyfinPasswordForUser,
	getClientActiveUserId,
	getClientConfigurationSummary,
	getClientMultiUserMode,
	getClientOpenSubtitlesApiKey,
	getStoredClientJellyfinSettings,
	saveClientJellyfinSettings,
	saveClientOpenSubtitlesApiKey,
	saveClientServerConnection,
	setClientActiveUserId,
	setClientMultiUserMode,
	updateStoredClientJellyfinPasswordForUser,
	validateClientJellyfinSettings,
} from "./client-config-store";
import {
	addClientItemsToCollection,
	beginClientPlaybackSession,
	createClientAdminUser,
	createClientCollection,
	deleteClientAdminUser,
	deleteClientCollection,
	fetchClientAdminLibraries,
	fetchClientAdminOverview,
	fetchClientAdminSessions,
	fetchClientAdminUsers,
	fetchClientCollectionItems,
	fetchClientCollections,
	fetchClientContinueWatching,
	fetchClientCurrentProfile,
	fetchClientCurrentUsername,
	fetchClientFavoriteItems,
	fetchClientFeatured,
	fetchClientItemDetails,
	fetchClientLatestMedia,
	fetchClientLibrary,
	fetchClientMostPlayed,
	fetchClientMyList,
	fetchClientOnlineSubtitle,
	fetchClientRecommendedFromItem,
	fetchClientSearch,
	fetchClientSeriesDetails,
	fetchClientWatchHistory,
	markClientPlayed,
	removeClientItemFromCollection,
	renameClientCollection,
	reportClientPlaybackState,
	scanAllClientAdminLibraries,
	scanClientAdminLibrary,
	searchClientOnlineSubtitles,
	toggleClientAdminUser,
	toggleClientFavorite,
	updateClientCurrentProfileImage,
	updateClientCurrentUserPassword,
	uploadClientCurrentProfileImage,
} from "./client-media";
import { shouldUseClientRuntime } from "./runtime-mode";

interface SetupPayload extends ClientJellyfinSettings {}

const EMPTY_SETUP_STATUS = {
	configured: false,
	source: "missing" as const,
	current: {
		url: "",
		apiKey: "",
		userId: "",
		username: "",
		password: "",
		hasApiKey: false,
		hasPassword: false,
	},
};

function mergeClientSettings(input: Partial<ClientJellyfinSettings>) {
	const current = getStoredClientJellyfinSettings();
	return {
		url: input.url?.trim() || current.url || "",
		apiKey: input.apiKey?.trim() || current.apiKey || "",
		userId: input.userId?.trim() || current.userId || "",
		username: input.username?.trim() || current.username || "",
		password: input.password?.trim() || current.password || "",
	};
}

export async function fetchSetupStatusRuntime() {
	if (shouldUseClientRuntime()) {
		return getClientConfigurationSummary();
	}

	return (await fetchSetupStatus()) ?? EMPTY_SETUP_STATUS;
}

export async function saveSetupConfigurationRuntime(data: SetupPayload) {
	if (shouldUseClientRuntime()) {
		const validated = await validateClientJellyfinSettings(data);
		saveClientJellyfinSettings(validated);
		return { configured: true };
	}

	return saveSetupConfiguration({ data });
}

export async function saveSettingsRuntime(data: Partial<ClientJellyfinSettings>) {
	if (shouldUseClientRuntime()) {
		const validated = await validateClientJellyfinSettings(mergeClientSettings(data));
		saveClientJellyfinSettings(validated);
		return { configured: true };
	}

	return saveSettings({
		data: {
			url: data.url ?? "",
			apiKey: data.apiKey ?? "",
			userId: data.userId ?? "",
			username: data.username ?? "",
			password: data.password ?? "",
		},
	});
}

export async function fetchOpenSubtitlesKeyRuntime() {
	if (shouldUseClientRuntime()) {
		return getClientOpenSubtitlesApiKey();
	}

	return fetchOpenSubtitlesKey();
}

export async function saveOpenSubtitlesKeyRuntime(apiKey: string) {
	if (shouldUseClientRuntime()) {
		saveClientOpenSubtitlesApiKey(apiKey);
		return { apiKey: apiKey.trim() };
	}

	return saveOpenSubtitlesKey({ data: { apiKey } });
}

export async function fetchUsernameRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientCurrentUsername();
	}

	return fetchUsername();
}

export async function fetchCurrentProfileRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientCurrentProfile();
	}

	return fetchCurrentProfile();
}

export async function fetchLibraryRuntime(input: {
	data: {
		type: "Movie" | "Series";
		page?: number;
		sortBy?: "SortName" | "DateCreated" | "PremiereDate" | "CommunityRating";
		sortOrder?: "Ascending" | "Descending";
		genre?: string;
		favoritesOnly?: boolean;
		ratings?: string;
		decade?: string;
		minScore?: number;
		watchStatus?: "watched" | "unwatched" | "inprogress";
	};
}) {
	if (shouldUseClientRuntime()) {
		return fetchClientLibrary(input.data);
	}

	return fetchLibrary(input);
}

export async function fetchFeaturedRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientFeatured();
	}

	return fetchFeatured();
}

export async function fetchContinueWatchingRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientContinueWatching();
	}

	return fetchContinueWatching();
}

export async function fetchLatestMoviesRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientLatestMedia("Movie");
	}

	return fetchLatestMovies();
}

export async function fetchLatestSeriesRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientLatestMedia("Series");
	}

	return fetchLatestSeries();
}

export async function fetchFavoriteMoviesRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientFavoriteItems("Movie");
	}

	return fetchFavoriteMovies();
}

export async function fetchMostPlayedRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientMostPlayed("Movie", 12);
	}

	return fetchMostPlayed();
}

export async function fetchMyListRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientMyList();
	}

	return fetchMyList();
}

export async function fetchCollectionsRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientCollections();
	}

	const { fetchCollections } = await import("../server/functions");
	return fetchCollections();
}

export async function fetchCollectionItemsRuntime(input: { data: { id: string } }) {
	if (shouldUseClientRuntime()) {
		return fetchClientCollectionItems(input.data.id);
	}

	const { fetchCollectionItems } = await import("../server/functions");
	return fetchCollectionItems(input);
}

export async function createCollectionRuntime(input: { data: { name: string } }) {
	if (shouldUseClientRuntime()) {
		return createClientCollection(input.data.name);
	}

	const { createCollection } = await import("../server/functions");
	return createCollection(input);
}

export async function deleteCollectionRuntime(input: { data: { id: string } }) {
	if (shouldUseClientRuntime()) {
		return deleteClientCollection(input.data.id);
	}

	const { deleteCollection } = await import("../server/functions");
	return deleteCollection(input);
}

export async function renameCollectionRuntime(input: { data: { id: string; name: string } }) {
	if (shouldUseClientRuntime()) {
		return renameClientCollection(input.data.id, input.data.name);
	}

	const { renameCollection } = await import("../server/functions");
	return renameCollection(input);
}

export async function addToCollectionRuntime(input: {
	data: { collectionId: string; itemIds: string[] };
}) {
	if (shouldUseClientRuntime()) {
		return addClientItemsToCollection(input.data.collectionId, input.data.itemIds);
	}

	const { addToCollection } = await import("../server/functions");
	return addToCollection(input);
}

export async function removeFromCollectionRuntime(input: {
	data: { collectionId: string; itemId: string };
}) {
	if (shouldUseClientRuntime()) {
		return removeClientItemFromCollection(input.data.collectionId, input.data.itemId);
	}

	const { removeFromCollection } = await import("../server/functions");
	return removeFromCollection(input);
}

export async function beginPlaybackSessionRuntime(input: {
	data: {
		id: string;
		client?: {
			platform: "ios" | "android" | "android-tv" | "other";
			prefersSafeVideo: boolean;
			prefersTvMode: boolean;
		};
	};
}) {
	if (shouldUseClientRuntime()) {
		return beginClientPlaybackSession(input.data.id, input.data.client);
	}

	return beginPlaybackSession(input);
}

export async function reportPlaybackStateRuntime(input: {
	data: {
		id: string;
		positionTicks: number;
		playMethod?: "DirectPlay" | "Transcode";
		playSessionId?: string;
		mediaSourceId?: string;
		sessionId?: string;
		isPaused?: boolean;
		isStopped?: boolean;
		played?: boolean;
	};
}) {
	if (shouldUseClientRuntime()) {
		return reportClientPlaybackState({ id: input.data.id, played: input.data.played });
	}

	return reportPlaybackState(input);
}

export async function searchOnlineSubtitlesRuntime(input: {
	data: {
		title: string;
		year?: number;
		season?: number;
		episode?: number;
	};
}) {
	if (shouldUseClientRuntime()) {
		return searchClientOnlineSubtitles(input.data);
	}

	return searchOnlineSubtitles(input);
}

export async function fetchOnlineSubtitleRuntime(input: { data: { fileId: number } }) {
	if (shouldUseClientRuntime()) {
		return fetchClientOnlineSubtitle(input.data.fileId);
	}

	return fetchOnlineSubtitle(input);
}

export async function fetchSearchRuntime(input: { data: { query: string } }) {
	if (shouldUseClientRuntime()) {
		return fetchClientSearch(input.data.query);
	}

	return fetchSearch(input);
}

export async function fetchWatchHistoryRuntime(input: { data: { page?: number } }) {
	if (shouldUseClientRuntime()) {
		return fetchClientWatchHistory(input.data.page ?? 0);
	}

	return fetchWatchHistory(input);
}

export async function fetchRecommendedFromItemRuntime(input: { data: { id: string } }) {
	if (shouldUseClientRuntime()) {
		return fetchClientRecommendedFromItem(input.data.id);
	}

	return fetchRecommendedFromItem(input);
}

export async function fetchItemDetailsRuntime(input: { data: { id: string } }) {
	if (shouldUseClientRuntime()) {
		return fetchClientItemDetails(input.data.id);
	}

	return fetchItemDetails(input);
}

export async function fetchSeriesDetailsRuntime(input: { data: { id: string } }) {
	if (shouldUseClientRuntime()) {
		return fetchClientSeriesDetails(input.data.id);
	}

	return fetchSeriesDetails(input);
}

export async function fetchAdminOverviewRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientAdminOverview();
	}

	const { fetchAdminOverview } = await import("../server/functions");
	return fetchAdminOverview();
}

export async function fetchAdminSessionsRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientAdminSessions();
	}

	const { fetchAdminSessions } = await import("../server/functions");
	return fetchAdminSessions();
}

export async function fetchAdminUsersRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientAdminUsers();
	}

	const { fetchAdminUsers } = await import("../server/functions");
	return fetchAdminUsers();
}

export async function toggleAdminUserRuntime(input: {
	data: { userId: string; disabled: boolean };
}) {
	if (shouldUseClientRuntime()) {
		return toggleClientAdminUser(input.data);
	}

	const { toggleAdminUser } = await import("../server/functions");
	return toggleAdminUser(input);
}

export async function deleteAdminUserRuntime(input: { data: { userId: string } }) {
	if (shouldUseClientRuntime()) {
		return deleteClientAdminUser(input.data.userId);
	}

	const { deleteAdminUser } = await import("../server/functions");
	return deleteAdminUser(input);
}

export async function createAdminUserRuntime(input: { data: { name: string; password: string } }) {
	if (shouldUseClientRuntime()) {
		return createClientAdminUser(input.data);
	}

	const { createAdminUser } = await import("../server/functions");
	return createAdminUser(input);
}

export async function fetchAdminLibrariesRuntime() {
	if (shouldUseClientRuntime()) {
		return fetchClientAdminLibraries();
	}

	const { fetchAdminLibraries } = await import("../server/functions");
	return fetchAdminLibraries();
}

export async function scanAllAdminLibrariesRuntime() {
	if (shouldUseClientRuntime()) {
		return scanAllClientAdminLibraries();
	}

	const { scanAllAdminLibraries } = await import("../server/functions");
	return scanAllAdminLibraries();
}

export async function scanAdminLibraryRuntime(input: { data: { itemId: string } }) {
	if (shouldUseClientRuntime()) {
		return scanClientAdminLibrary(input.data.itemId);
	}

	const { scanAdminLibrary } = await import("../server/functions");
	return scanAdminLibrary(input);
}

export async function toggleFavoriteRuntime(input: { data: { id: string; isFavorite: boolean } }) {
	if (shouldUseClientRuntime()) {
		return toggleClientFavorite(input.data);
	}

	return toggleFavorite(input);
}

export async function markPlayedRuntime(input: { data: { id: string; played: boolean } }) {
	if (shouldUseClientRuntime()) {
		return markClientPlayed(input.data);
	}

	return markPlayed(input);
}

export async function fetchMultiUserSettingsRuntime() {
	if (shouldUseClientRuntime()) {
		return {
			multiUserMode: getClientMultiUserMode(),
			locked: false,
			activeUserId: getClientActiveUserId(),
		};
	}

	return fetchMultiUserSettings();
}

export async function setMultiUserModeRuntime(enabled: boolean) {
	if (shouldUseClientRuntime()) {
		setClientMultiUserMode(enabled);
		return { ok: true };
	}

	return setMultiUserModeServerFn({ data: { enabled } });
}

export async function setActiveUserRuntime(userId: string) {
	if (shouldUseClientRuntime()) {
		setClientActiveUserId(userId);
		return { ok: true };
	}

	return setActiveUserServerFn({ data: { userId } });
}

export async function clearActiveUserRuntime() {
	if (shouldUseClientRuntime()) {
		clearClientActiveUserId();
		return { ok: true };
	}

	return clearActiveUserServerFn();
}

export async function updateCurrentProfileImageRuntime(imageUrl: string) {
	if (shouldUseClientRuntime()) {
		return updateClientCurrentProfileImage(imageUrl);
	}

	return updateCurrentProfileImage({ data: { imageUrl } });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	let binary = "";
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	for (let index = 0; index < bytes.length; index += chunkSize) {
		const chunk = bytes.subarray(index, index + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

export async function uploadCurrentProfileImageRuntime(file: File) {
	const imageBuffer = await file.arrayBuffer();
	const contentType = file.type || "image/jpeg";
	if (shouldUseClientRuntime()) {
		return uploadClientCurrentProfileImage(imageBuffer, contentType);
	}

	return uploadCurrentProfileImage({
		data: {
			contentType,
			imageBase64: arrayBufferToBase64(imageBuffer),
		},
	});
}

export async function updateCurrentProfilePasswordRuntime(input: {
	currentPassword: string;
	newPassword: string;
}) {
	if (shouldUseClientRuntime()) {
		const profile = await fetchClientCurrentProfile();
		const result = await updateClientCurrentUserPassword(input.currentPassword, input.newPassword);
		if (input.newPassword.trim()) {
			updateStoredClientJellyfinPasswordForUser(profile.id, input.newPassword);
		} else {
			clearStoredClientJellyfinPasswordForUser(profile.id);
		}
		return result;
	}

	return updateCurrentProfilePassword({ data: input });
}

export async function saveServerConnectionRuntime(url: string, apiKey: string) {
	if (shouldUseClientRuntime()) {
		return saveClientServerConnection(url, apiKey);
	}

	return saveServerConnectionFn({ data: { url, apiKey } });
}

export async function fetchUserPolicyRuntime(userId: string) {
	if (shouldUseClientRuntime()) {
		const { fetchClientUserPolicy } = await import("./client-media");
		return fetchClientUserPolicy(userId);
	}

	return fetchUserPolicy({ data: { userId } });
}

export async function updateUserParentalPolicyRuntime(input: {
	userId: string;
	policy: {
		MaxActiveSessions?: number;
		EnableRemoteAccess?: boolean;
		MaxParentalRating?: number;
		BlockedTags?: string[];
		EnableContentDeletion?: boolean;
		EnableLiveTvAccess?: boolean;
	};
}) {
	if (shouldUseClientRuntime()) {
		const { updateClientUserParentalPolicy } = await import("./client-media");
		return updateClientUserParentalPolicy(input.userId, input.policy);
	}

	return updateUserParentalPolicy({ data: input });
}
