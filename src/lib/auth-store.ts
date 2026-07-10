import crypto from "node:crypto";
import { authenticateUserByName, createClient, JellyfinError } from "@get-coral/jellyfin";
import {
	getAppDatabase,
	getEffectiveServerConnectionSettings,
	getRequireLogin,
	isAuroraConfigured,
} from "./config-store";

export const SESSION_COOKIE_NAME = "aurora_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface AuthSession {
	userId: string;
	username: string;
	isAdmin: boolean;
}

const CREATE_SESSIONS_TABLE_SQL = [
	"CREATE TABLE IF NOT EXISTS auth_sessions (",
	"  token_hash TEXT PRIMARY KEY,",
	"  user_id TEXT NOT NULL,",
	"  username TEXT NOT NULL,",
	"  is_admin INTEGER NOT NULL DEFAULT 0,",
	"  created_at INTEGER NOT NULL,",
	"  expires_at INTEGER NOT NULL",
	");",
	"CREATE TABLE IF NOT EXISTS user_logins (",
	"  user_id TEXT PRIMARY KEY,",
	"  last_login_at INTEGER NOT NULL",
	");",
].join("\n");

let sessionsTableReady = false;

function getSessionsDatabase() {
	const database = getAppDatabase();
	if (!sessionsTableReady) {
		database.exec(CREATE_SESSIONS_TABLE_SQL);
		sessionsTableReady = true;
	}
	return database;
}

function hashToken(token: string) {
	return crypto.createHash("sha256").update(token).digest("hex");
}

function nowSeconds() {
	return Math.floor(Date.now() / 1000);
}

export function isLoginEnforced(): boolean {
	return getRequireLogin() && isAuroraConfigured();
}

export async function authenticateJellyfinCredentials(
	username: string,
	password: string,
): Promise<AuthSession> {
	const connection = getEffectiveServerConnectionSettings();

	if (!connection) {
		throw new Error("Aurora is not connected to a Jellyfin server yet.");
	}

	const client = createClient({
		url: connection.url,
		apiKey: connection.apiKey,
		userId: "",
		clientName: "Aurora",
		deviceName: "Aurora Web",
		deviceId: "aurora-ui-web",
		version: "1.0.0",
	});

	try {
		const result = await authenticateUserByName(client, username, password);
		return {
			userId: result.user.Id,
			username: result.user.Name ?? username,
			isAdmin: result.user.Policy?.IsAdministrator === true,
		};
	} catch (error) {
		if (error instanceof JellyfinError) {
			if (error.status === 401 || error.status === 403) {
				throw new Error("Invalid username or password.");
			}
			throw new Error(`Jellyfin sign-in failed (${error.status ?? "unknown"}).`);
		}
		throw new Error("Aurora could not reach the Jellyfin server.");
	}
}

export function createAuthSession(session: AuthSession): string {
	const database = getSessionsDatabase();
	const token = crypto.randomBytes(32).toString("hex");
	const createdAt = nowSeconds();

	database
		.prepare(
			"INSERT INTO auth_sessions (token_hash, user_id, username, is_admin, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.run(
			hashToken(token),
			session.userId,
			session.username,
			session.isAdmin ? 1 : 0,
			createdAt,
			createdAt + SESSION_MAX_AGE_SECONDS,
		);

	database.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(createdAt);

	return token;
}

export function getSessionByToken(token: string | undefined | null): AuthSession | null {
	if (!token) return null;

	const database = getSessionsDatabase();
	const row = database
		.prepare(
			"SELECT user_id, username, is_admin, expires_at FROM auth_sessions WHERE token_hash = ?",
		)
		.get(hashToken(token)) as
		| { user_id: string; username: string; is_admin: number; expires_at: number }
		| undefined;

	if (!row) return null;

	if (row.expires_at < nowSeconds()) {
		deleteSessionByToken(token);
		return null;
	}

	return {
		userId: row.user_id,
		username: row.username,
		isAdmin: row.is_admin === 1,
	};
}

export function deleteSessionByToken(token: string | undefined | null): void {
	if (!token) return;
	getSessionsDatabase()
		.prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
		.run(hashToken(token));
}

/**
 * Track successful Aurora sign-ins per Jellyfin user. Jellyfin does write
 * LastLoginDate on AuthenticateByName, but (as of 10.11) serves user info
 * from an in-memory cache that misses that write, so the admin dashboard
 * merges this in to show accurate last-login times.
 */
export function recordUserLogin(userId: string): void {
	getSessionsDatabase()
		.prepare(
			"INSERT INTO user_logins (user_id, last_login_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_login_at = excluded.last_login_at",
		)
		.run(userId, nowSeconds());
}

export function getLastUserLogins(): Map<string, string> {
	const rows = getSessionsDatabase()
		.prepare("SELECT user_id, last_login_at FROM user_logins")
		.all() as unknown as Array<{ user_id: string; last_login_at: number }>;

	return new Map(
		rows.map((row) => [row.user_id, new Date(row.last_login_at * 1000).toISOString()]),
	);
}

export function getSessionTokenFromCookieHeader(cookieHeader: string | null): string | null {
	if (!cookieHeader) return null;

	for (const part of cookieHeader.split(";")) {
		const separatorIndex = part.indexOf("=");
		if (separatorIndex === -1) continue;
		const name = part.slice(0, separatorIndex).trim();
		if (name !== SESSION_COOKIE_NAME) continue;
		const value = part.slice(separatorIndex + 1).trim();
		if (value) return decodeURIComponent(value);
	}

	return null;
}

export function isRequestAuthorized(request: Request): boolean {
	if (!isLoginEnforced()) return true;

	const token = getSessionTokenFromCookieHeader(request.headers.get("cookie"));
	return getSessionByToken(token) != null;
}
