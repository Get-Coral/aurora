import {
	authenticateUserByName,
	createClient,
	getSystemInfo,
	getUserById,
	JellyfinError,
} from "@get-coral/jellyfin";

export interface ClientJellyfinSettings {
	url: string;
	apiKey: string;
	userId: string;
	username: string;
	password: string;
	/**
	 * Set when Aurora signed in with username and password instead of an API
	 * key. `apiKey` then holds this same session token, and playback uses it
	 * directly, so accounts without a password can still sync progress.
	 */
	accessToken?: string;
}

export interface ClientJellyfinServerConnectionSettings {
	url: string;
	apiKey: string;
	username: string;
	password: string;
}

type SettingsSource = "local-storage" | "missing";

const JELLYFIN_SETTINGS_KEY = "aurora.client.jellyfin-settings";
const OPEN_SUBTITLES_KEY = "aurora.client.opensubtitles-api-key";
const MULTI_USER_MODE_KEY = "aurora.client.multiUserMode";
const ACTIVE_USER_ID_KEY = "aurora.client.activeUserId";
const DEVICE_ID_KEY = "aurora.client.device-id";

function readJson<T>(key: string): T | null {
	if (typeof window === "undefined") return null;

	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return null;
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

function writeJson(key: string, value: unknown) {
	if (typeof window === "undefined") return;

	window.localStorage.setItem(key, JSON.stringify(value));
}

function normalizeSettings(
	settings: Partial<ClientJellyfinSettings>,
): Partial<ClientJellyfinSettings> {
	return {
		url: settings.url?.trim(),
		apiKey: settings.apiKey?.trim(),
		userId: settings.userId?.trim(),
		username: settings.username?.trim(),
		password: settings.password?.trim(),
		...(settings.accessToken?.trim() ? { accessToken: settings.accessToken.trim() } : {}),
	};
}

function areSettingsComplete(
	settings: Partial<ClientJellyfinSettings>,
): settings is ClientJellyfinSettings {
	// A password is only needed for API-key setups, where Aurora signs in
	// separately for playback. Session sign-ins already hold a token.
	return Boolean(
		settings.url &&
			settings.apiKey &&
			settings.userId &&
			settings.username &&
			(settings.password || settings.accessToken),
	);
}

/**
 * Jellyfin ends a user's existing session when the same device ID signs in
 * again, so every install needs its own ID or two phones on one account would
 * keep signing each other out.
 */
export function getClientDeviceId(): string {
	const fallback = "aurora-ui-local";
	if (typeof window === "undefined") return fallback;

	try {
		const stored = window.localStorage.getItem(DEVICE_ID_KEY);
		if (stored) return stored;
		const created = `aurora-${crypto.randomUUID()}`;
		window.localStorage.setItem(DEVICE_ID_KEY, created);
		return created;
	} catch {
		return fallback;
	}
}

export function getClientMultiUserMode(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.localStorage.getItem(MULTI_USER_MODE_KEY) === "true";
	} catch {
		return false;
	}
}

export function setClientMultiUserMode(enabled: boolean): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(MULTI_USER_MODE_KEY, enabled ? "true" : "false");
	} catch {
		// ignore
	}
}

export function getClientActiveUserId(): string | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage.getItem(ACTIVE_USER_ID_KEY) || null;
	} catch {
		return null;
	}
}

export function setClientActiveUserId(userId: string): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(ACTIVE_USER_ID_KEY, userId.trim());
	} catch {
		// ignore
	}
}

export function clearClientActiveUserId(): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.removeItem(ACTIVE_USER_ID_KEY);
	} catch {
		// ignore
	}
}

export function getStoredClientJellyfinSettings(): Partial<ClientJellyfinSettings> {
	return normalizeSettings(readJson<Partial<ClientJellyfinSettings>>(JELLYFIN_SETTINGS_KEY) ?? {});
}

export function getEffectiveClientJellyfinSettings(): ClientJellyfinSettings | null {
	const stored = getStoredClientJellyfinSettings();

	if (getClientMultiUserMode()) {
		const activeUserId = getClientActiveUserId();
		if (!activeUserId) return null;
		const withActive = { ...stored, userId: activeUserId };
		return areSettingsComplete(withActive) ? withActive : null;
	}

	return areSettingsComplete(stored) ? stored : null;
}

export function getEffectiveClientServerConnectionSettings(): ClientJellyfinServerConnectionSettings | null {
	const stored = getStoredClientJellyfinSettings();

	if (!stored.url || !stored.apiKey) {
		return null;
	}

	return {
		url: stored.url,
		apiKey: stored.apiKey,
		username: stored.username ?? "",
		password: stored.password ?? "",
	};
}

export function getClientJellyfinSettingsSource(): SettingsSource {
	const stored = getStoredClientJellyfinSettings();
	const hasServerSettings = Boolean(stored.url && stored.apiKey);
	if (getClientMultiUserMode()) return hasServerSettings ? "local-storage" : "missing";
	return getEffectiveClientJellyfinSettings() ? "local-storage" : "missing";
}

export function getClientConfigurationSummary() {
	const stored = getStoredClientJellyfinSettings();
	const effective = getEffectiveClientJellyfinSettings();
	const multiUserMode = getClientMultiUserMode();

	return {
		configured: multiUserMode ? Boolean(stored.url && stored.apiKey) : Boolean(effective),
		source: getClientJellyfinSettingsSource(),
		current: {
			url: stored.url ?? effective?.url ?? "",
			apiKey: stored.apiKey ?? effective?.apiKey ?? "",
			userId: stored.userId ?? effective?.userId ?? "",
			username: stored.username ?? effective?.username ?? "",
			password: stored.password ?? effective?.password ?? "",
			hasApiKey: Boolean(stored.apiKey ?? effective?.apiKey),
			hasPassword: Boolean(stored.password ?? effective?.password),
		},
	};
}

export function saveClientJellyfinSettings(settings: ClientJellyfinSettings) {
	writeJson(JELLYFIN_SETTINGS_KEY, normalizeSettings(settings));
}

export function updateStoredClientJellyfinPasswordForUser(userId: string, password: string) {
	const current = getStoredClientJellyfinSettings();
	if (!current.userId || current.userId !== userId.trim()) {
		return;
	}

	writeJson(
		JELLYFIN_SETTINGS_KEY,
		normalizeSettings({
			...current,
			password: password.trim(),
		}),
	);
}

export function clearStoredClientJellyfinPasswordForUser(userId: string) {
	const current = getStoredClientJellyfinSettings();
	if (!current.userId || current.userId !== userId.trim()) {
		return;
	}

	writeJson(
		JELLYFIN_SETTINGS_KEY,
		normalizeSettings({
			...current,
			password: "",
		}),
	);
}

export function getClientOpenSubtitlesApiKey() {
	if (typeof window === "undefined") return null;

	try {
		return window.localStorage.getItem(OPEN_SUBTITLES_KEY);
	} catch {
		return null;
	}
}

export function saveClientOpenSubtitlesApiKey(apiKey: string) {
	if (typeof window === "undefined") return;

	window.localStorage.setItem(OPEN_SUBTITLES_KEY, apiKey.trim());
}

export async function saveClientServerConnection(url: string, apiKey: string) {
	const cleanUrl = url.trim().replace(/\/+$/, "");
	const cleanApiKey = apiKey.trim();

	if (!cleanUrl || !cleanApiKey) {
		throw new Error("Server URL and API key are required.");
	}

	const client = createClient({
		url: cleanUrl,
		apiKey: cleanApiKey,
		userId: "",
		username: "",
		password: "",
		clientName: "Aurora",
		deviceName: "Aurora Local",
		deviceId: getClientDeviceId(),
		version: "1.0.0",
	});

	await getSystemInfo(client);

	const current = getStoredClientJellyfinSettings();
	writeJson(
		JELLYFIN_SETTINGS_KEY,
		normalizeSettings({ ...current, url: cleanUrl, apiKey: cleanApiKey }),
	);

	return { url: cleanUrl };
}

/**
 * Sign in with a Jellyfin username and password (which may be empty) and
 * return complete settings that use the resulting session token in place of
 * an API key.
 */
export async function signInClientJellyfin(input: {
	url: string;
	username: string;
	password: string;
}): Promise<ClientJellyfinSettings> {
	const url = input.url.trim().replace(/\/+$/, "");
	const username = input.username.trim();
	const password = input.password.trim();

	if (!url || !username) {
		throw new Error("Server URL and username are required.");
	}

	const client = createClient({
		url,
		apiKey: "",
		userId: "",
		clientName: "Aurora",
		deviceName: "Aurora Local",
		deviceId: getClientDeviceId(),
		version: "1.0.0",
	});

	try {
		const { accessToken, user } = await authenticateUserByName(client, username, password);
		return { url, apiKey: accessToken, accessToken, userId: user.Id, username, password };
	} catch (error) {
		if (error instanceof JellyfinError && error.status === 401) {
			throw new Error("Jellyfin did not accept that username and password.");
		}
		throw error;
	}
}

export async function validateClientJellyfinSettings(settings: ClientJellyfinSettings) {
	if (!settings.apiKey?.trim()) {
		return signInClientJellyfin(settings);
	}

	const normalized = normalizeSettings(settings);

	if (!areSettingsComplete(normalized)) {
		throw new Error("Every Jellyfin field is required.");
	}

	const client = createClient({
		url: normalized.url,
		apiKey: normalized.apiKey,
		userId: normalized.userId,
		username: normalized.username,
		password: normalized.password,
		...(normalized.accessToken ? { accessToken: normalized.accessToken } : {}),
		clientName: "Aurora",
		deviceName: "Aurora Local",
		deviceId: getClientDeviceId(),
		version: "1.0.0",
	});

	await getUserById(client, normalized.userId);
	await client.getPlaybackAuth();

	return {
		...normalized,
		url: normalized.url.replace(/\/+$/, ""),
	};
}
