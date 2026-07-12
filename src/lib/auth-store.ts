import crypto from "node:crypto";
import {
	authenticateUserByName,
	createClient,
	JellyfinError,
	logoutUserSession,
} from "@get-coral/jellyfin";
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
	/**
	 * The Jellyfin access token issued at sign-in. Playback and progress sync
	 * run under this token so they are attributed to the signed-in user. Null
	 * for sessions that never exchanged credentials (e.g. the bootstrap
	 * session created when the login requirement is first enabled).
	 */
	jellyfinToken: string | null;
	/** Unique per-session Jellyfin device id the token was issued for. */
	deviceId: string | null;
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

const SESSIONS_TABLE_MIGRATIONS = [
	"ALTER TABLE auth_sessions ADD COLUMN jellyfin_token TEXT",
	"ALTER TABLE auth_sessions ADD COLUMN device_id TEXT",
];

let sessionsTableReady = false;

function getSessionsDatabase() {
	const database = getAppDatabase();
	if (!sessionsTableReady) {
		database.exec(CREATE_SESSIONS_TABLE_SQL);
		for (const migration of SESSIONS_TABLE_MIGRATIONS) {
			try {
				database.exec(migration);
			} catch {
				// Column already exists.
			}
		}
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

	// Jellyfin revokes the previous token when the same user re-authenticates
	// with the same device id, so every Aurora session gets its own id — two
	// browsers signed in as the same user must not kill each other's session.
	const deviceId = `aurora-web-${crypto.randomBytes(4).toString("hex")}`;

	const client = createClient({
		url: connection.url,
		apiKey: connection.apiKey,
		userId: "",
		clientName: "Aurora",
		deviceName: "Aurora Web",
		deviceId,
		version: "1.0.0",
	});

	try {
		const result = await authenticateUserByName(client, username, password);
		return {
			userId: result.user.Id,
			username: result.user.Name ?? username,
			isAdmin: result.user.Policy?.IsAdministrator === true,
			jellyfinToken: result.accessToken,
			deviceId,
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
			"INSERT INTO auth_sessions (token_hash, user_id, username, is_admin, created_at, expires_at, jellyfin_token, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.run(
			hashToken(token),
			session.userId,
			session.username,
			session.isAdmin ? 1 : 0,
			createdAt,
			createdAt + SESSION_MAX_AGE_SECONDS,
			session.jellyfinToken,
			session.deviceId,
		);

	return token;
}

/**
 * Delete expired sessions and revoke their Jellyfin tokens (best effort),
 * so tokens don't linger on the Jellyfin side after the Aurora session dies.
 */
export async function sweepExpiredSessions(): Promise<void> {
	const database = getSessionsDatabase();
	const now = nowSeconds();
	const expired = database
		.prepare("SELECT jellyfin_token, device_id FROM auth_sessions WHERE expires_at < ?")
		.all(now) as unknown as Array<{ jellyfin_token: string | null; device_id: string | null }>;

	if (expired.length === 0) return;

	const connection = getEffectiveServerConnectionSettings();
	if (connection) {
		for (const row of expired) {
			if (!row.jellyfin_token) continue;
			const client = createClient({
				url: connection.url,
				apiKey: connection.apiKey,
				userId: "",
				clientName: "Aurora",
				deviceName: "Aurora Web",
				deviceId: row.device_id ?? "aurora-ui-web",
				version: "1.0.0",
			});
			await logoutUserSession(client, row.jellyfin_token).catch(() => {
				// Jellyfin unreachable — the token idles out on its own.
			});
		}
	}

	database.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(now);
}

export function getSessionByToken(token: string | undefined | null): AuthSession | null {
	if (!token) return null;

	const database = getSessionsDatabase();
	const row = database
		.prepare(
			"SELECT user_id, username, is_admin, expires_at, jellyfin_token, device_id FROM auth_sessions WHERE token_hash = ?",
		)
		.get(hashToken(token)) as
		| {
				user_id: string;
				username: string;
				is_admin: number;
				expires_at: number;
				jellyfin_token: string | null;
				device_id: string | null;
		  }
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
		jellyfinToken: row.jellyfin_token,
		deviceId: row.device_id,
	};
}

export function deleteSessionByToken(token: string | undefined | null): void {
	if (!token) return;
	getSessionsDatabase()
		.prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
		.run(hashToken(token));
}

/**
 * Delete a session and revoke its Jellyfin access token (best effort), so
 * signing out of Aurora also ends the session on the Jellyfin side.
 */
export async function destroySessionByToken(token: string | undefined | null): Promise<void> {
	if (!token) return;

	const session = getSessionByToken(token);
	if (session?.jellyfinToken) {
		const connection = getEffectiveServerConnectionSettings();
		if (connection) {
			const client = createClient({
				url: connection.url,
				apiKey: connection.apiKey,
				userId: session.userId,
				clientName: "Aurora",
				deviceName: "Aurora Web",
				deviceId: session.deviceId ?? "aurora-ui-web",
				version: "1.0.0",
			});
			await logoutUserSession(client, session.jellyfinToken).catch(() => {
				// Jellyfin unreachable — the token idles out on its own.
			});
		}
	}

	deleteSessionByToken(token);
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

/**
 * The signed-in session behind a plain Request (API routes), when the login
 * requirement is active.
 */
export function getSessionFromRequest(request: Request): AuthSession | null {
	if (!isLoginEnforced()) return null;

	const token = getSessionTokenFromCookieHeader(request.headers.get("cookie"));
	return getSessionByToken(token);
}

export function isRequestAuthorized(request: Request): boolean {
	if (!isLoginEnforced()) return true;

	return getSessionFromRequest(request) != null;
}

// ── Login throttling ──────────────────────────────────────────────────────────
// A small in-memory guard on top of Jellyfin's own lockout policy. Resets on
// restart, which is fine — it only needs to blunt rapid guessing.

const LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const LOGIN_ATTEMPT_LIMIT = 10;

const loginFailures = new Map<string, { count: number; resetAt: number }>();

export function assertLoginAllowed(ip: string | null | undefined): void {
	if (!ip) return;

	const entry = loginFailures.get(ip);
	if (!entry) return;

	if (entry.resetAt <= nowSeconds()) {
		loginFailures.delete(ip);
		return;
	}

	if (entry.count >= LOGIN_ATTEMPT_LIMIT) {
		throw new Error("Too many failed sign-in attempts. Try again later.");
	}
}

export function recordLoginFailure(ip: string | null | undefined): void {
	if (!ip) return;

	const now = nowSeconds();
	const entry = loginFailures.get(ip);
	if (!entry || entry.resetAt <= now) {
		loginFailures.set(ip, { count: 1, resetAt: now + LOGIN_ATTEMPT_WINDOW_SECONDS });
		return;
	}
	entry.count++;
}

export function clearLoginFailures(ip: string | null | undefined): void {
	if (!ip) return;
	loginFailures.delete(ip);
}
