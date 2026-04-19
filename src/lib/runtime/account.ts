import {
	clearClientActiveUserId,
	clearStoredClientJellyfinPasswordForUser,
	getClientActiveUserId,
	getClientMultiUserMode,
	setClientActiveUserId,
	setClientMultiUserMode,
	updateStoredClientJellyfinPasswordForUser,
} from "@/lib/client-config-store";
import {
	fetchClientCurrentProfile,
	fetchClientCurrentUsername,
	fetchClientUserPolicy,
	updateClientCurrentUserPassword,
	updateClientUserParentalPolicy,
} from "@/lib/client-media";
import {
	clearActiveUserServerFn,
	fetchCurrentProfile,
	fetchMultiUserSettings,
	fetchUsername,
	fetchUserPolicy,
	setActiveUserServerFn,
	setMultiUserModeServerFn,
	updateCurrentProfilePassword,
	updateUserParentalPolicy,
} from "@/server/functions";
import { callRuntime } from "./shared";

export async function fetchUsernameRuntime() {
	return callRuntime(
		() => fetchClientCurrentUsername(),
		() => fetchUsername(),
	);
}

export async function fetchCurrentProfileRuntime() {
	return callRuntime(
		() => fetchClientCurrentProfile(),
		() => fetchCurrentProfile(),
	);
}

export async function fetchMultiUserSettingsRuntime() {
	return callRuntime(
		() => ({
			multiUserMode: getClientMultiUserMode(),
			locked: false,
			activeUserId: getClientActiveUserId(),
		}),
		() => fetchMultiUserSettings(),
	);
}

export async function setMultiUserModeRuntime(enabled: boolean) {
	return callRuntime(
		() => {
			setClientMultiUserMode(enabled);
			return { ok: true };
		},
		() => setMultiUserModeServerFn({ data: { enabled } }),
	);
}

export async function setActiveUserRuntime(userId: string) {
	return callRuntime(
		() => {
			setClientActiveUserId(userId);
			return { ok: true };
		},
		() => setActiveUserServerFn({ data: { userId } }),
	);
}

export async function clearActiveUserRuntime() {
	return callRuntime(
		() => {
			clearClientActiveUserId();
			return { ok: true };
		},
		() => clearActiveUserServerFn(),
	);
}

export async function updateCurrentProfilePasswordRuntime(input: {
	currentPassword: string;
	newPassword: string;
}) {
	return callRuntime(
		async () => {
			const profile = await fetchClientCurrentProfile();
			const result = await updateClientCurrentUserPassword(
				input.currentPassword,
				input.newPassword,
			);
			if (input.newPassword.trim()) {
				updateStoredClientJellyfinPasswordForUser(profile.id, input.newPassword);
			} else {
				clearStoredClientJellyfinPasswordForUser(profile.id);
			}
			return result;
		},
		() => updateCurrentProfilePassword({ data: input }),
	);
}

export async function fetchUserPolicyRuntime(userId: string) {
	return callRuntime(
		() => fetchClientUserPolicy(userId),
		() => fetchUserPolicy({ data: { userId } }),
	);
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
	return callRuntime(
		() => updateClientUserParentalPolicy(input.userId, input.policy),
		() => updateUserParentalPolicy({ data: input }),
	);
}
