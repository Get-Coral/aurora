import {
	addItemsToCollection as addItemsToCollectionBase,
	createClient,
	createCollection as createCollectionBase,
	createPlaybackSession as createPlaybackSessionBase,
	createUser as createUserBase,
	deleteItem as deleteItemBase,
	deleteUser as deleteUserBase,
	type GetLibraryItemsOptions,
	getActiveSessions as getActiveSessionsBase,
	getCollectionItems as getCollectionItemsBase,
	getCollections as getCollectionsBase,
	getContinueWatching as getContinueWatchingBase,
	getEpisodesForSeries as getEpisodesForSeriesBase,
	getFavoriteItems as getFavoriteItemsBase,
	getFeaturedItem as getFeaturedItemBase,
	getItem as getItemBase,
	getItemCounts as getItemCountsBase,
	getLatestMedia as getLatestMediaBase,
	getLibraryItems as getLibraryItemsBase,
	getMostPlayed as getMostPlayedBase,
	getNextUpForSeries as getNextUpForSeriesBase,
	getSimilarItems as getSimilarItemsBase,
	getSystemInfo as getSystemInfoBase,
	getUserById as getUserByIdBase,
	getUsers as getUsersBase,
	getVirtualFolders as getVirtualFoldersBase,
	getWatchHistory as getWatchHistoryBase,
	type ImageType,
	imageUrl,
	type JellyfinActiveSession,
	type JellyfinItem,
	type JellyfinItemCounts,
	type JellyfinMediaType,
	type JellyfinPlaybackSession,
	type JellyfinResponse,
	type JellyfinSystemInfo,
	type JellyfinUser,
	type JellyfinUserPolicy,
	type JellyfinVirtualFolder,
	type PlaybackSyncInput,
	personImageUrl,
	removeItemsFromCollection as removeItemsFromCollectionBase,
	scanAllLibraries as scanAllLibrariesBase,
	scanLibrary as scanLibraryBase,
	searchItems as searchItemsBase,
	setFavorite as setFavoriteBase,
	setPlayed as setPlayedBase,
	streamUrl,
	syncPlaybackState as syncPlaybackStateBase,
	transcodeUrl,
	patchUserPolicy as patchUserPolicyBase,
	updateItemName as updateItemNameBase,
	updateUserPassword as updateUserPasswordBase,
	updateUserPrimaryImage as updateUserPrimaryImageBase,
	updateUserPolicy as updateUserPolicyBase,
} from "@get-coral/jellyfin";
import {
	getEffectiveJellyfinSettings,
	getEffectiveServerConnectionSettings,
} from "./config-store";
import { jellyfinImageProxyUrl } from "./jellyfin-image-proxy";
import type { UserProfileSummary } from "./media";
import type { ClientPlaybackContext } from "./platform";

const AURORA_CLIENT_NAME = "Aurora";
const AURORA_DEVICE_NAME = "Aurora Web";
const AURORA_DEVICE_ID = "aurora-ui-web";
const AURORA_VERSION = "1.0.0";

export type {
	GetLibraryItemsOptions,
	JellyfinActiveSession,
	JellyfinItem,
	JellyfinItemCounts,
	JellyfinMediaType,
	JellyfinPlaybackSession,
	JellyfinResponse,
	JellyfinSystemInfo,
	JellyfinUser,
	JellyfinVirtualFolder,
};

export type JellyfinPlaybackSyncInput = PlaybackSyncInput;

function getJellyfinClient() {
	const settings = getEffectiveJellyfinSettings();

	if (!settings) {
		throw new Error("Aurora is not configured yet. Visit /setup to connect Jellyfin.");
	}

	return createClient({
		url: settings.url,
		apiKey: settings.apiKey,
		userId: settings.userId,
		username: settings.username,
		password: settings.password,
		clientName: AURORA_CLIENT_NAME,
		deviceName: AURORA_DEVICE_NAME,
		deviceId: AURORA_DEVICE_ID,
		version: AURORA_VERSION,
	});
}

function getAdminJellyfinClient() {
	const settings = getEffectiveServerConnectionSettings();

	if (!settings) {
		throw new Error("Aurora is not configured yet. Visit /setup to connect Jellyfin.");
	}

	return createClient({
		url: settings.url,
		apiKey: settings.apiKey,
		userId: "",
		username: settings.username,
		password: settings.password,
		clientName: AURORA_CLIENT_NAME,
		deviceName: AURORA_DEVICE_NAME,
		deviceId: AURORA_DEVICE_ID,
		version: AURORA_VERSION,
	});
}

export function jellyfinImageUrl(itemId: string, type: ImageType = "Primary", width = 400): string {
	return imageUrl(getJellyfinClient(), itemId, type, width);
}

export function jellyfinPersonImageUrl(personId: string, width = 240): string {
	return personImageUrl(getJellyfinClient(), personId, width);
}

export function jellyfinStreamUrl(
	itemId: string,
	options?: {
		playSessionId?: string;
		mediaSourceId?: string;
	},
): string {
	return streamUrl(getJellyfinClient(), itemId, options);
}

export function jellyfinTranscodeUrl(
	itemId: string,
	options?: {
		playSessionId?: string;
		mediaSourceId?: string;
	},
): string {
	return transcodeUrl(getJellyfinClient(), itemId, options);
}

export async function setFavorite(itemId: string, isFavorite: boolean) {
	return setFavoriteBase(getJellyfinClient(), itemId, isFavorite);
}

export async function setPlayed(itemId: string, played: boolean) {
	return setPlayedBase(getJellyfinClient(), itemId, played);
}

export async function createPlaybackSession(
	itemId: string,
	client?: ClientPlaybackContext,
): Promise<JellyfinPlaybackSession> {
	return createPlaybackSessionBase(getJellyfinClient(), itemId, {
		prefersSafeVideo: client?.prefersSafeVideo,
	});
}

export async function syncPlaybackState(input: JellyfinPlaybackSyncInput) {
	return syncPlaybackStateBase(getJellyfinClient(), input);
}

export async function getContinueWatching(): Promise<JellyfinItem[]> {
	return getContinueWatchingBase(getJellyfinClient());
}

export async function getFavoriteItems(type: JellyfinMediaType = "Movie"): Promise<JellyfinItem[]> {
	return getFavoriteItemsBase(getJellyfinClient(), type);
}

export async function getLatestMedia(type: JellyfinMediaType = "Movie"): Promise<JellyfinItem[]> {
	return getLatestMediaBase(getJellyfinClient(), type);
}

export async function getLibraryItems(
	type: JellyfinMediaType,
	options: GetLibraryItemsOptions = {},
): Promise<JellyfinResponse<JellyfinItem>> {
	return getLibraryItemsBase(getJellyfinClient(), type, options);
}

export async function getWatchHistory(
	options: { limit?: number; startIndex?: number } = {},
): Promise<JellyfinResponse<JellyfinItem>> {
	return getWatchHistoryBase(getJellyfinClient(), options);
}

export async function getCollections(): Promise<JellyfinItem[]> {
	return getCollectionsBase(getJellyfinClient());
}

export async function getCollectionItems(collectionId: string): Promise<JellyfinItem[]> {
	return getCollectionItemsBase(getJellyfinClient(), collectionId);
}

export async function getMostPlayed(
	type: JellyfinMediaType = "Movie",
	limit = 12,
): Promise<JellyfinItem[]> {
	return getMostPlayedBase(getJellyfinClient(), type, limit);
}

export async function getItem(itemId: string): Promise<JellyfinItem> {
	return getItemBase(getJellyfinClient(), itemId);
}

export async function getSimilarItems(itemId: string): Promise<JellyfinItem[]> {
	return getSimilarItemsBase(getJellyfinClient(), itemId);
}

export async function getEpisodesForSeries(seriesId: string): Promise<JellyfinItem[]> {
	return getEpisodesForSeriesBase(getJellyfinClient(), seriesId);
}

export async function getNextUpForSeries(seriesId: string): Promise<JellyfinItem[]> {
	return getNextUpForSeriesBase(getJellyfinClient(), seriesId);
}

export async function searchItems(query: string): Promise<JellyfinItem[]> {
	return searchItemsBase(getJellyfinClient(), query);
}

export async function createCollection(
	name: string,
	itemIds: string[] = [],
): Promise<{ Id: string }> {
	return createCollectionBase(getJellyfinClient(), name, itemIds);
}

export async function deleteItem(id: string): Promise<void> {
	return deleteItemBase(getJellyfinClient(), id);
}

export async function updateItemName(id: string, name: string): Promise<void> {
	return updateItemNameBase(getJellyfinClient(), id, name);
}

export async function addItemsToCollection(collectionId: string, itemIds: string[]): Promise<void> {
	return addItemsToCollectionBase(getJellyfinClient(), collectionId, itemIds);
}

export async function removeItemsFromCollection(
	collectionId: string,
	itemIds: string[],
): Promise<void> {
	return removeItemsFromCollectionBase(getJellyfinClient(), collectionId, itemIds);
}

export async function getFeaturedItem(): Promise<JellyfinItem | null> {
	return getFeaturedItemBase(getJellyfinClient());
}

export async function getSystemInfo(): Promise<JellyfinSystemInfo> {
	return getSystemInfoBase(getAdminJellyfinClient());
}

export async function getItemCounts(): Promise<JellyfinItemCounts> {
	return getItemCountsBase(getAdminJellyfinClient());
}

export async function getActiveSessions(): Promise<JellyfinActiveSession[]> {
	return getActiveSessionsBase(getAdminJellyfinClient());
}

export async function getUsers(): Promise<JellyfinUser[]> {
	return getUsersBase(getAdminJellyfinClient());
}

export async function getUserById(userId: string): Promise<JellyfinUser> {
	return getUserByIdBase(getAdminJellyfinClient(), userId);
}

export async function updateUserPolicy(userId: string, policy: JellyfinUserPolicy): Promise<void> {
	return updateUserPolicyBase(getAdminJellyfinClient(), userId, policy);
}

export async function patchUserPolicy(
	userId: string,
	patch: Partial<JellyfinUserPolicy>,
): Promise<void> {
	return patchUserPolicyBase(getAdminJellyfinClient(), userId, patch);
}

export async function deleteJellyfinUser(userId: string): Promise<void> {
	return deleteUserBase(getAdminJellyfinClient(), userId);
}

export async function createJellyfinUser(name: string, password: string): Promise<JellyfinUser> {
	return createUserBase(getAdminJellyfinClient(), name, password);
}

export async function getVirtualFolders(): Promise<JellyfinVirtualFolder[]> {
	return getVirtualFoldersBase(getAdminJellyfinClient());
}

export async function scanAllLibraries(): Promise<void> {
	return scanAllLibrariesBase(getAdminJellyfinClient());
}

export async function scanLibrary(itemId: string): Promise<void> {
	return scanLibraryBase(getAdminJellyfinClient(), itemId);
}

export async function getCurrentUserProfile(): Promise<UserProfileSummary> {
	const settings = getEffectiveJellyfinSettings();

	if (!settings) {
		throw new Error("Aurora is not configured yet. Visit /setup to connect Jellyfin.");
	}

	const user = await getUserByIdBase(getAdminJellyfinClient(), settings.userId);
	return {
		id: user.Id,
		name: user.Name,
		hasPassword: user.HasPassword,
		imageUrl: user.PrimaryImageTag
			? jellyfinImageProxyUrl(user.Id, "Primary", 160, {
					tag: user.PrimaryImageTag,
					resource: "users",
				})
			: undefined,
	};
}

export async function updateCurrentUserProfileImage(imageUrl: string): Promise<UserProfileSummary> {
	const settings = getEffectiveJellyfinSettings();

	if (!settings) {
		throw new Error("Aurora is not configured yet. Visit /setup to connect Jellyfin.");
	}

	await updateUserPrimaryImageBase(getAdminJellyfinClient(), settings.userId, imageUrl);

	return getCurrentUserProfile();
}

export async function updateCurrentUserPassword(currentPassword: string, newPassword: string) {
	const settings = getEffectiveJellyfinSettings();

	if (!settings) {
		throw new Error("Aurora is not configured yet. Visit /setup to connect Jellyfin.");
	}

	await updateUserPasswordBase(
		getAdminJellyfinClient(),
		settings.userId,
		currentPassword,
		newPassword,
	);

	return { userId: settings.userId };
}
