import crypto from "node:crypto";
import { getStreamTokenSecret } from "./config-store";

/**
 * Signed, short-lived stream URLs.
 *
 * AirPlay and Cast don't proxy the media through the browser — they hand the
 * URL to the receiver, which fetches it itself. The receiver has no Aurora
 * session cookie, so `/api/jellyfin-stream` would reject it. A signed token in
 * the query string is the credential it can actually carry.
 *
 * The token is deliberately narrow: it is scoped to a single Jellyfin item and
 * bound to the Aurora session that minted it, so a captured URL grants read
 * access to one title and nothing else, and signing out revokes it immediately.
 */

const TOKEN_VERSION = "1";

/** Long enough to outlast a film — see the expiry note in `mintStreamToken`. */
export const STREAM_TOKEN_TTL_SECONDS = 6 * 60 * 60;

/** Stands in for the session hash when Aurora isn't enforcing login. */
export const OPEN_SESSION_REF = "open";

export interface StreamTokenClaims {
	itemId: string;
	sessionRef: string;
	expiresAt: number;
}

function nowSeconds() {
	return Math.floor(Date.now() / 1000);
}

/** Jellyfin writes item ids both dashed and undashed; compare them one way. */
export function normalizeItemId(raw: string): string {
	return raw.replace(/-/g, "").toLowerCase();
}

/**
 * The item a media path belongs to, e.g. `/Videos/<id>/hls1/main/3.ts`.
 * Returns null for anything that isn't a per-item media path.
 */
export function itemIdFromMediaPath(pathname: string): string | null {
	const match = /^\/(?:videos|audio)\/([^/]+)/i.exec(pathname);
	if (!match?.[1]) return null;

	const itemId = normalizeItemId(decodeURIComponent(match[1]));
	return itemId.length > 0 ? itemId : null;
}

function sign(payload: string): string {
	return crypto.createHmac("sha256", getStreamTokenSecret()).update(payload).digest("base64url");
}

export function mintStreamToken(input: {
	itemId: string;
	sessionRef: string;
	/** Clamped against this when the session dies sooner than the TTL. */
	maxExpiresAt?: number | null;
	ttlSeconds?: number;
}): { token: string; expiresAt: number } {
	// A five-minute token would be useless here. Jellyfin's transcode manifest
	// is a VOD playlist the receiver fetches once, so there is no mid-playback
	// moment to slip a fresh token in — but segments keep being pulled for the
	// whole runtime. The long window is safe because revocation is session-
	// based rather than time-based: the proxy re-checks the session row on
	// every request, so signing out kills outstanding URLs instantly.
	const ttl = input.ttlSeconds ?? STREAM_TOKEN_TTL_SECONDS;
	const expiresAt = input.maxExpiresAt
		? Math.min(nowSeconds() + ttl, input.maxExpiresAt)
		: nowSeconds() + ttl;

	const payload = `${TOKEN_VERSION}.${expiresAt}.${normalizeItemId(input.itemId)}.${input.sessionRef}`;

	return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifyStreamToken(token: string): StreamTokenClaims | null {
	// version.expiresAt.itemId.sessionRef.signature — none of the four payload
	// fields can contain a dot, so the segment count is exact.
	const parts = token.split(".");
	if (parts.length !== 5) return null;

	const [version, rawExpiresAt, itemId, sessionRef, signature] = parts as [
		string,
		string,
		string,
		string,
		string,
	];
	if (version !== TOKEN_VERSION) return null;
	if (!itemId || !sessionRef || !signature) return null;

	const expiresAt = Number.parseInt(rawExpiresAt, 10);
	if (!Number.isSafeInteger(expiresAt)) return null;

	const expected = Buffer.from(sign(`${version}.${rawExpiresAt}.${itemId}.${sessionRef}`));
	const provided = Buffer.from(signature);

	// timingSafeEqual throws on a length mismatch, so guard before comparing.
	if (expected.length !== provided.length) return null;
	if (!crypto.timingSafeEqual(expected, provided)) return null;

	if (expiresAt <= nowSeconds()) return null;

	return { itemId, sessionRef, expiresAt };
}
