import { createServerFn } from "@tanstack/react-start";
import { adminRequiredMiddleware, authRequiredMiddleware } from "../auth-middleware";

export const fetchAdminUsers = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.handler(async () => {
		const { getUsers } = await import("@/lib/jellyfin");
		const { jellyfinImageProxyUrl } = await import("@/lib/jellyfin-image-proxy");
		const { getLastUserLogins } = await import("@/lib/auth-store");
		const users = await getUsers();

		// Jellyfin (as of 10.11) serves LastLoginDate from a cache that misses
		// sign-in writes, so merge in the sign-ins Aurora has seen itself.
		const auroraLogins = getLastUserLogins();
		const lastLogin = (user: (typeof users)[number]) => {
			const jellyfin = user.LastLoginDate ?? null;
			const aurora = auroraLogins.get(user.Id) ?? null;
			if (!jellyfin || !aurora) return jellyfin ?? aurora;
			return aurora > jellyfin ? aurora : jellyfin;
		};

		return users.map((user) => ({
			id: user.Id,
			name: user.Name,
			imageUrl: user.PrimaryImageTag
				? jellyfinImageProxyUrl(user.Id, "Primary", 160, {
						tag: user.PrimaryImageTag,
						resource: "users",
					})
				: undefined,
			isAdmin: user.Policy?.IsAdministrator ?? false,
			isDisabled: user.Policy?.IsDisabled ?? false,
			lastLoginDate: lastLogin(user),
			hasPolicy: user.Policy != null,
		}));
	});

export const toggleAdminUser = createServerFn({ method: "POST" })
	.middleware([adminRequiredMiddleware])
	.validator((input: { userId: string; disabled: boolean }) => input)
	.handler(async ({ data }) => {
		const { patchUserPolicy } = await import("@/lib/jellyfin");
		await patchUserPolicy(data.userId, { IsDisabled: data.disabled });
		return { ok: true };
	});

export const deleteAdminUser = createServerFn({ method: "POST" })
	.middleware([adminRequiredMiddleware])
	.validator((input: { userId: string }) => input)
	.handler(async ({ data }) => {
		const { deleteJellyfinUser } = await import("@/lib/jellyfin");
		await deleteJellyfinUser(data.userId);
		return { ok: true };
	});

export const createAdminUser = createServerFn({ method: "POST" })
	.middleware([adminRequiredMiddleware])
	.validator((input: { name: string; password: string }) => input)
	.handler(async ({ data }) => {
		const { createJellyfinUser } = await import("@/lib/jellyfin");
		const user = await createJellyfinUser(data.name, data.password);
		return {
			id: user.Id,
			name: user.Name,
			isAdmin: user.Policy?.IsAdministrator ?? false,
			isDisabled: user.Policy?.IsDisabled ?? false,
			lastLoginDate: user.LastLoginDate ?? null,
			hasPolicy: user.Policy != null,
		};
	});

export const fetchAdminLibraries = createServerFn({ method: "GET" })
	.middleware([adminRequiredMiddleware])
	.handler(async () => {
		const { getVirtualFolders } = await import("@/lib/jellyfin");
		const folders = await getVirtualFolders();
		return folders.map((folder) => ({
			itemId: folder.ItemId,
			name: folder.Name,
			collectionType: folder.CollectionType ?? "unknown",
			locations: folder.Locations ?? [],
		}));
	});

export const scanAllAdminLibraries = createServerFn({ method: "POST" })
	.middleware([adminRequiredMiddleware])
	.handler(async () => {
		const { scanAllLibraries } = await import("@/lib/jellyfin");
		await scanAllLibraries();
		return { ok: true };
	});

export const scanAdminLibrary = createServerFn({ method: "POST" })
	.middleware([adminRequiredMiddleware])
	.validator((input: { itemId: string }) => input)
	.handler(async ({ data }) => {
		const { scanLibrary } = await import("@/lib/jellyfin");
		await scanLibrary(data.itemId);
		return { ok: true };
	});

export const fetchAdminOverview = createServerFn({ method: "GET" })
	.middleware([adminRequiredMiddleware])
	.handler(async () => {
		const { getSystemInfo, getItemCounts } = await import("@/lib/jellyfin");
		const { getEffectiveJellyfinSettings } = await import("@/lib/config-store");
		const settings = getEffectiveJellyfinSettings();
		const [systemInfo, counts] = await Promise.all([getSystemInfo(), getItemCounts()]);
		return {
			systemInfo,
			counts,
			serverUrl: settings?.url ?? "",
			apiKey: settings?.apiKey ?? "",
		};
	});

export const fetchAdminSessions = createServerFn({ method: "GET" })
	.middleware([adminRequiredMiddleware])
	.handler(async () => {
		const { getActiveSessions } = await import("@/lib/jellyfin");
		const { jellyfinImageProxyUrl } = await import("@/lib/jellyfin-image-proxy");

		const sessions = await getActiveSessions();
		return sessions.map((session) => ({
			id: session.Id,
			userName: session.UserName ?? null,
			client: session.Client ?? null,
			deviceName: session.DeviceName ?? null,
			lastActivityDate: session.LastActivityDate ?? null,
			nowPlaying: session.NowPlayingItem
				? {
						id: session.NowPlayingItem.Id,
						name: session.NowPlayingItem.Name,
						type: session.NowPlayingItem.Type,
						seriesName: session.NowPlayingItem.SeriesName ?? null,
						runTimeTicks: session.NowPlayingItem.RunTimeTicks ?? null,
						imageUrl: session.NowPlayingItem.PrimaryImageTag
							? jellyfinImageProxyUrl(session.NowPlayingItem.Id, "Primary", 300, {
									fillWidth: 300,
									quality: 80,
									tag: session.NowPlayingItem.PrimaryImageTag,
								})
							: null,
					}
				: null,
			isPaused: session.PlayState?.IsPaused ?? false,
			positionTicks: session.PlayState?.PositionTicks ?? 0,
			playMethod: session.PlayState?.PlayMethod ?? null,
		}));
	});
