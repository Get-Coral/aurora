import { createServerFn } from "@tanstack/react-start";

export const fetchUsername = createServerFn({ method: "GET" }).handler(async () => {
	const { getEffectiveJellyfinSettings, getMultiUserMode, getActiveUserId } = await import(
		"../../lib/config-store"
	);
	const settings = getEffectiveJellyfinSettings();

	if (getMultiUserMode()) {
		const activeUserId = getActiveUserId();
		if (activeUserId) {
			const { getUserById } = await import("../../lib/jellyfin");
			const user = await getUserById(activeUserId);
			return user.Name ?? settings?.username ?? "";
		}
	}

	return settings?.username ?? "";
});

export const fetchCurrentProfile = createServerFn({ method: "GET" }).handler(async () => {
	const { getCurrentUserProfile } = await import("../../lib/jellyfin");
	return getCurrentUserProfile();
});

export const updateCurrentProfilePassword = createServerFn({ method: "POST" })
	.inputValidator((input: { currentPassword: string; newPassword: string }) => input)
	.handler(async ({ data }) => {
		const { updateCurrentUserPassword } = await import("../../lib/jellyfin");
		const { updateStoredJellyfinPasswordForUser, clearStoredJellyfinPasswordForUser } =
			await import("../../lib/config-store");
		const result = await updateCurrentUserPassword(data.currentPassword, data.newPassword);
		if (data.newPassword.trim()) {
			updateStoredJellyfinPasswordForUser(result.userId, data.newPassword);
		} else {
			clearStoredJellyfinPasswordForUser(result.userId);
		}
		return { ok: true };
	});

export const fetchMultiUserSettings = createServerFn({ method: "GET" }).handler(async () => {
	const { getMultiUserMode, isMultiUserModeLocked, getActiveUserId } = await import(
		"../../lib/config-store"
	);
	return {
		multiUserMode: getMultiUserMode(),
		locked: isMultiUserModeLocked(),
		activeUserId: getActiveUserId(),
	};
});

export const setMultiUserModeServerFn = createServerFn({ method: "POST" })
	.inputValidator((input: { enabled: boolean }) => input)
	.handler(async ({ data }) => {
		const { setMultiUserMode } = await import("../../lib/config-store");
		setMultiUserMode(data.enabled);
		return { ok: true };
	});

export const setActiveUserServerFn = createServerFn({ method: "POST" })
	.inputValidator((input: { userId: string }) => input)
	.handler(async ({ data }) => {
		const { setActiveUserId } = await import("../../lib/config-store");
		setActiveUserId(data.userId);
		return { ok: true };
	});

export const clearActiveUserServerFn = createServerFn({ method: "POST" }).handler(async () => {
	const { clearActiveUserId } = await import("../../lib/config-store");
	clearActiveUserId();
	return { ok: true };
});

export const fetchUserPolicy = createServerFn({ method: "POST" })
	.inputValidator((input: { userId: string }) => input)
	.handler(async ({ data }) => {
		const { getUserById } = await import("../../lib/jellyfin");
		const user = await getUserById(data.userId);
		const policy = user.Policy ?? {};
		return {
			MaxActiveSessions: (policy.MaxActiveSessions as number) ?? 0,
			EnableRemoteAccess: (policy.EnableRemoteAccess as boolean) ?? true,
			MaxParentalRating: (policy.MaxParentalRating as number) ?? 0,
			BlockedTags: (policy.BlockedTags as string[]) ?? [],
			EnableContentDeletion: (policy.EnableContentDeletion as boolean) ?? false,
			EnableLiveTvAccess: (policy.EnableLiveTvAccess as boolean) ?? true,
		};
	});

export const updateUserParentalPolicy = createServerFn({ method: "POST" })
	.inputValidator(
		(input: {
			userId: string;
			policy: {
				MaxActiveSessions?: number;
				EnableRemoteAccess?: boolean;
				MaxParentalRating?: number;
				BlockedTags?: string[];
				EnableContentDeletion?: boolean;
				EnableLiveTvAccess?: boolean;
			};
		}) => input,
	)
	.handler(async ({ data }) => {
		const { patchUserPolicy } = await import("../../lib/jellyfin");
		await patchUserPolicy(data.userId, data.policy);
		return { ok: true };
	});
