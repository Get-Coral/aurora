import {
	fetchAuthStatus,
	loginServerFn,
	logoutServerFn,
	setRequireLoginServerFn,
} from "@/server/functions";
import { callRuntime } from "./shared";

export interface AuthStatus {
	requireLogin: boolean;
	locked: boolean;
	required: boolean;
	authenticated: boolean;
	userId: string | null;
	username: string | null;
}

// The native (Capacitor) shell talks to Jellyfin directly with credentials
// stored on the device, so the server-side login gate never applies there.
const CLIENT_AUTH_STATUS: AuthStatus = {
	requireLogin: false,
	locked: false,
	required: false,
	authenticated: true,
	userId: null,
	username: null,
};

export async function fetchAuthStatusRuntime(): Promise<AuthStatus> {
	return callRuntime(
		() => CLIENT_AUTH_STATUS,
		() => fetchAuthStatus(),
	);
}

export async function loginRuntime(input: { username: string; password: string }) {
	return callRuntime(
		() => ({ ok: true, userId: null as string | null, username: input.username }),
		() => loginServerFn({ data: input }),
	);
}

export async function logoutRuntime() {
	return callRuntime(
		() => ({ ok: true }),
		() => logoutServerFn(),
	);
}

export async function setRequireLoginRuntime(enabled: boolean) {
	return callRuntime(
		() => ({ ok: true, requireLogin: enabled }),
		() => setRequireLoginServerFn({ data: { enabled } }),
	);
}
