import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient, getSystemInfo, getUserById } from "@get-coral/jellyfin";

export interface JellyfinSettings {
	url: string;
	apiKey: string;
	userId: string;
	username: string;
	password: string;
}

export interface JellyfinServerConnectionSettings {
	url: string;
	apiKey: string;
	username: string;
	password: string;
}

type SettingsSource = "database" | "env" | "merged" | "missing";

function getDataDirectory() {
	return process.env.AURORA_DATA_DIR ?? path.join(process.cwd(), "data");
}

function getDatabasePath() {
	return path.join(getDataDirectory(), "aurora.sqlite");
}

let database: DatabaseSync | null = null;

const CREATE_TABLE_SQL = [
	"CREATE TABLE IF NOT EXISTS app_settings (",
	"  key TEXT PRIMARY KEY,",
	"  value TEXT NOT NULL,",
	"  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
	");",
].join("\n");

function getDatabase() {
	if (database) return database;

	fs.mkdirSync(getDataDirectory(), { recursive: true });
	database = new DatabaseSync(getDatabasePath());
	database.exec(CREATE_TABLE_SQL);

	return database;
}

function getSetting(key: string) {
	const statement = getDatabase().prepare("SELECT value FROM app_settings WHERE key = ?");
	const row = statement.get(key) as { value?: string } | undefined;
	return row?.value;
}

const UPSERT_SQL = [
	"INSERT INTO app_settings (key, value, updated_at)",
	"VALUES (?, ?, CURRENT_TIMESTAMP)",
	"ON CONFLICT(key) DO UPDATE SET",
	"  value = excluded.value,",
	"  updated_at = CURRENT_TIMESTAMP",
].join("\n");

function setSetting(key: string, value: string) {
	const statement = getDatabase().prepare(UPSERT_SQL);
	statement.run(key, value);
}

function clearSetting(key: string) {
	const statement = getDatabase().prepare("DELETE FROM app_settings WHERE key = ?");
	statement.run(key);
}

function readEnvSettings(): Partial<JellyfinSettings> {
	return {
		url: process.env.JELLYFIN_URL?.trim(),
		apiKey: process.env.JELLYFIN_API_KEY?.trim(),
		userId: process.env.JELLYFIN_USER_ID?.trim(),
		username: process.env.JELLYFIN_USERNAME?.trim(),
		password: process.env.JELLYFIN_PASSWORD?.trim(),
	};
}

export function getStoredJellyfinSettings(): Partial<JellyfinSettings> {
	return {
		url: getSetting("jellyfin.url")?.trim(),
		apiKey: getSetting("jellyfin.apiKey")?.trim(),
		userId: getSetting("jellyfin.userId")?.trim(),
		username: getSetting("jellyfin.username")?.trim(),
		password: getSetting("jellyfin.password")?.trim(),
	};
}

function normalizeSettings(settings: Partial<JellyfinSettings>): Partial<JellyfinSettings> {
	return {
		url: settings.url?.trim(),
		apiKey: settings.apiKey?.trim(),
		userId: settings.userId?.trim(),
		username: settings.username?.trim(),
		password: settings.password?.trim(),
	};
}

function areSettingsComplete(settings: Partial<JellyfinSettings>): settings is JellyfinSettings {
	return Boolean(
		settings.url && settings.apiKey && settings.userId && settings.username && settings.password,
	);
}

function areServerSettingsComplete(settings: Partial<JellyfinSettings>): boolean {
	return Boolean(settings.url && settings.apiKey);
}

function getMergedStoredAndEnvSettings(): Partial<JellyfinSettings> {
	const stored = normalizeSettings(getStoredJellyfinSettings());
	const env = normalizeSettings(readEnvSettings());

	return {
		url: stored.url || env.url,
		apiKey: stored.apiKey || env.apiKey,
		userId: stored.userId || env.userId,
		username: stored.username || env.username,
		password: stored.password || env.password,
	};
}

export function getMultiUserMode(): boolean {
	if (process.env.AURORA_MULTI_USER === "true") return true;
	return getSetting("aurora.multiUserMode") === "true";
}

export function isMultiUserModeLocked(): boolean {
	return process.env.AURORA_MULTI_USER === "true";
}

export function getActiveUserId(): string | null {
	return getSetting("aurora.activeUserId") ?? null;
}

export function setMultiUserMode(enabled: boolean): void {
	setSetting("aurora.multiUserMode", enabled ? "true" : "false");
}

export function setActiveUserId(userId: string): void {
	setSetting("aurora.activeUserId", userId.trim());
}

export function clearActiveUserId(): void {
	setSetting("aurora.activeUserId", "");
}

export function getEffectiveJellyfinSettings(): JellyfinSettings | null {
	const merged = getMergedStoredAndEnvSettings();

	if (getMultiUserMode()) {
		const activeUserId = getActiveUserId();
		if (!activeUserId) return null;
		merged.userId = activeUserId;
	}

	return areSettingsComplete(merged) ? merged : null;
}

export function getEffectiveServerConnectionSettings(): JellyfinServerConnectionSettings | null {
	const merged = getMergedStoredAndEnvSettings();

	if (!areServerSettingsComplete(merged)) {
		return null;
	}

	return {
		url: merged.url!,
		apiKey: merged.apiKey!,
		username: merged.username ?? "",
		password: merged.password ?? "",
	};
}

export function getJellyfinSettingsSource(): SettingsSource {
	const stored = normalizeSettings(getStoredJellyfinSettings());
	const env = normalizeSettings(readEnvSettings());

	const storedComplete = areSettingsComplete(stored);
	const envComplete = areSettingsComplete(env);

	if (storedComplete) return "database";
	if (envComplete) return "env";
	if (Object.values({ ...stored, ...env }).some(Boolean)) return "merged";
	return "missing";
}

export function isAuroraConfigured() {
	if (getMultiUserMode()) {
		return getEffectiveServerConnectionSettings() != null;
	}
	return getEffectiveJellyfinSettings() != null;
}

export function getConfigurationSummary() {
	const stored = normalizeSettings(getStoredJellyfinSettings());
	const effective = getEffectiveJellyfinSettings();

	return {
		configured: isAuroraConfigured(),
		source: getJellyfinSettingsSource(),
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

export function getOpenSubtitlesApiKey(): string | null {
	return getSetting("opensubtitles.apiKey") ?? null;
}

export function saveOpenSubtitlesApiKey(apiKey: string) {
	setSetting("opensubtitles.apiKey", apiKey.trim());
}

export function saveJellyfinSettings(settings: JellyfinSettings) {
	setSetting("jellyfin.url", settings.url.trim());
	setSetting("jellyfin.apiKey", settings.apiKey.trim());
	setSetting("jellyfin.userId", settings.userId.trim());
	setSetting("jellyfin.username", settings.username.trim());
	setSetting("jellyfin.password", settings.password.trim());
}

export function updateStoredJellyfinPasswordForUser(userId: string, password: string) {
	const storedUserId = getSetting("jellyfin.userId")?.trim();
	if (!storedUserId || storedUserId !== userId.trim()) {
		return;
	}

	setSetting("jellyfin.password", password.trim());
}

export function clearStoredJellyfinPasswordForUser(userId: string) {
	const storedUserId = getSetting("jellyfin.userId")?.trim();
	if (!storedUserId || storedUserId !== userId.trim()) {
		return;
	}

	clearSetting("jellyfin.password");
}

export async function saveServerConnection(url: string, apiKey: string) {
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
		deviceName: "Aurora Web",
		deviceId: "aurora-ui-web",
		version: "1.0.0",
	});

	await getSystemInfo(client);

	setSetting("jellyfin.url", cleanUrl);
	setSetting("jellyfin.apiKey", cleanApiKey);

	return { url: cleanUrl };
}

export async function validateJellyfinSettings(settings: JellyfinSettings) {
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
		clientName: "Aurora",
		deviceName: "Aurora Web",
		deviceId: "aurora-ui-web",
		version: "1.0.0",
	});

	await getUserById(client, normalized.userId);
	await client.getPlaybackAuth();

	return {
		...normalized,
		url: normalized.url.replace(/\/+$/, ""),
	};
}
