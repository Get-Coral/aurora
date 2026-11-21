import { getCookie } from "@tanstack/react-start/server";
import { getSessionByToken, isLoginEnforced, SESSION_COOKIE_NAME } from "./auth-store";
import { getAppDatabase, getEffectiveJellyfinSettings } from "./config-store";
import type { IptvItemState } from "./iptv/mapping";
import type { IptvStateStore } from "./iptv/service";
import type { MediaItem } from "./media";

/** Watched once playback passes this share of the runtime. */
export const PLAYED_THRESHOLD = 0.9;

function database() {
	const db = getAppDatabase();
	db.exec(
		"CREATE TABLE IF NOT EXISTS iptv_user_state (user_key TEXT NOT NULL, item_id TEXT NOT NULL, position_ticks INTEGER NOT NULL DEFAULT 0, duration_ticks INTEGER NOT NULL DEFAULT 0, played INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, last_played_at INTEGER, updated_at INTEGER NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY (user_key, item_id))",
	);
	return db;
}

/**
 * Whose state this request reads and writes: the signed-in Aurora user, else
 * the active Jellyfin profile, else the configured user, else one shared slot
 * for IPTV-only installs.
 */
export function iptvUserKey() {
	try {
		if (isLoginEnforced()) {
			const session = getSessionByToken(getCookie(SESSION_COOKIE_NAME));
			if (session) return `user:${session.userId}`;
		}
	} catch {
		// Outside a request (tests, prerender) there is no session.
	}
	const userId = getEffectiveJellyfinSettings()?.userId;
	return userId ? `user:${userId}` : "local";
}

interface StateRow {
	item_id: string;
	position_ticks: number;
	duration_ticks: number;
	played: number;
	favorite: number;
	last_played_at: number | null;
	snapshot: string;
}

function toState(row: StateRow): IptvItemState {
	return {
		positionTicks: row.position_ticks || undefined,
		durationTicks: row.duration_ticks || undefined,
		played: row.played === 1,
		favorite: row.favorite === 1,
		lastPlayedAt: row.last_played_at ?? undefined,
	};
}

export function createIptvStateStore(userKey: string): IptvStateStore {
	return {
		async get(ids) {
			const result = new Map<string, IptvItemState>();
			if (!ids.length) return result;
			const statement = database().prepare(
				`SELECT * FROM iptv_user_state WHERE user_key = ? AND item_id IN (${ids.map(() => "?").join(",")})`,
			);
			for (let index = 0; index < ids.length; index += 500) {
				const chunk = ids.slice(index, index + 500);
				const query =
					chunk.length === ids.length
						? statement
						: database().prepare(
								`SELECT * FROM iptv_user_state WHERE user_key = ? AND item_id IN (${chunk.map(() => "?").join(",")})`,
							);
				for (const row of query.all(userKey, ...chunk) as unknown as StateRow[]) {
					result.set(row.item_id, toState(row));
				}
			}
			return result;
		},
		async list(kind, limit) {
			const where =
				kind === "favorites"
					? "favorite = 1"
					: kind === "continue"
						? "position_ticks > 0 AND duration_ticks > 0 AND item_id NOT LIKE 'iptv:%:live:%'"
						: "last_played_at IS NOT NULL";
			const order = kind === "favorites" ? "updated_at" : "last_played_at";
			const rows = database()
				.prepare(
					`SELECT * FROM iptv_user_state WHERE user_key = ? AND ${where} ORDER BY ${order} DESC LIMIT ?`,
				)
				.all(userKey, limit) as unknown as StateRow[];
			return rows.flatMap((row) => {
				try {
					return [
						{
							id: row.item_id,
							state: toState(row),
							snapshot: JSON.parse(row.snapshot) as MediaItem,
						},
					];
				} catch {
					return [];
				}
			});
		},
		async update(id, patch, snapshot) {
			const db = database();
			const current = db
				.prepare("SELECT * FROM iptv_user_state WHERE user_key = ? AND item_id = ?")
				.get(userKey, id) as unknown as StateRow | undefined;
			const next = { ...(current ? toState(current) : {}), ...patch };
			db.prepare(
				"INSERT INTO iptv_user_state (user_key, item_id, position_ticks, duration_ticks, played, favorite, last_played_at, updated_at, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_key, item_id) DO UPDATE SET position_ticks = excluded.position_ticks, duration_ticks = excluded.duration_ticks, played = excluded.played, favorite = excluded.favorite, last_played_at = excluded.last_played_at, updated_at = excluded.updated_at, snapshot = excluded.snapshot",
			).run(
				userKey,
				id,
				Math.max(0, Math.round(next.positionTicks ?? 0)),
				Math.max(0, Math.round(next.durationTicks ?? 0)),
				next.played ? 1 : 0,
				next.favorite ? 1 : 0,
				next.lastPlayedAt ?? null,
				Date.now(),
				JSON.stringify(snapshot),
			);
		},
	};
}
