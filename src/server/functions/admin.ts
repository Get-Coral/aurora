import { createServerFn } from "@tanstack/react-start";

export const fetchAdminUsers = createServerFn({ method: "GET" }).handler(async () => {
	const { getUsers } = await import("@/lib/jellyfin");
	const { jellyfinImageProxyUrl } = await import("@/lib/jellyfin-image-proxy");
	const users = await getUsers();
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
		lastLoginDate: user.LastLoginDate ?? null,
		hasPolicy: user.Policy != null,
	}));
});

export const toggleAdminUser = createServerFn({ method: "POST" })
	.inputValidator((input: { userId: string; disabled: boolean }) => input)
	.handler(async ({ data }) => {
		const { patchUserPolicy } = await import("@/lib/jellyfin");
		await patchUserPolicy(data.userId, { IsDisabled: data.disabled });
		return { ok: true };
	});

export const deleteAdminUser = createServerFn({ method: "POST" })
	.inputValidator((input: { userId: string }) => input)
	.handler(async ({ data }) => {
		const { deleteJellyfinUser } = await import("@/lib/jellyfin");
		await deleteJellyfinUser(data.userId);
		return { ok: true };
	});

export const createAdminUser = createServerFn({ method: "POST" })
	.inputValidator((input: { name: string; password: string }) => input)
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

export const fetchAdminLibraries = createServerFn({ method: "GET" }).handler(async () => {
	const { getVirtualFolders } = await import("@/lib/jellyfin");
	const folders = await getVirtualFolders();
	return folders.map((folder) => ({
		itemId: folder.ItemId,
		name: folder.Name,
		collectionType: folder.CollectionType ?? "unknown",
		locations: folder.Locations ?? [],
	}));
});

export const scanAllAdminLibraries = createServerFn({ method: "POST" }).handler(async () => {
	const { scanAllLibraries } = await import("@/lib/jellyfin");
	await scanAllLibraries();
	return { ok: true };
});

export const scanAdminLibrary = createServerFn({ method: "POST" })
	.inputValidator((input: { itemId: string }) => input)
	.handler(async ({ data }) => {
		const { scanLibrary } = await import("@/lib/jellyfin");
		await scanLibrary(data.itemId);
		return { ok: true };
	});

export const fetchAdminOverview = createServerFn({ method: "GET" }).handler(async () => {
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

export const fetchAdminSessions = createServerFn({ method: "GET" }).handler(async () => {
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
