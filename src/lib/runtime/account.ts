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
	fetchClientAvatarCandidates,
	fetchClientCurrentProfile,
	fetchClientCurrentUsername,
	fetchClientUserPolicy,
	removeClientAvatar,
	setClientAvatarFromLibrary,
	updateClientCurrentUserPassword,
	updateClientUserParentalPolicy,
	uploadClientAvatar,
} from "@/lib/client-media";
import {
	clearActiveUserServerFn,
	fetchAvatarCandidatesServerFn,
	fetchCurrentProfile,
	fetchMultiUserSettings,
	fetchUsername,
	fetchUserPolicy,
	removeAvatarServerFn,
	setActiveUserServerFn,
	setAvatarFromLibraryServerFn,
	setMultiUserModeServerFn,
	updateCurrentProfilePassword,
	updateUserParentalPolicy,
	uploadAvatarServerFn,
} from "@/server/functions";
import { callRuntime } from "./shared";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

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

export async function uploadAvatarRuntime(input: { dataBase64: string; contentType: string }) {
	return callRuntime(
		() => uploadClientAvatar(base64ToArrayBuffer(input.dataBase64), input.contentType),
		() => uploadAvatarServerFn({ data: input }),
	);
}

export async function setAvatarFromLibraryRuntime(input: {
	sourceType: "item" | "person";
	sourceId: string;
}) {
	return callRuntime(
		() => setClientAvatarFromLibrary(input),
		() => setAvatarFromLibraryServerFn({ data: input }),
	);
}

export async function removeAvatarRuntime() {
	return callRuntime(
		() => removeClientAvatar(),
		() => removeAvatarServerFn(),
	);
}

export async function fetchAvatarCandidatesRuntime() {
	return callRuntime(
		() => fetchClientAvatarCandidates(),
		() => fetchAvatarCandidatesServerFn(),
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
