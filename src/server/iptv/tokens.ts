import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

import { deriveIptvKey } from "../../lib/iptv-source-store";
import { httpUrl } from "../../lib/iptv/urls";

/**
 * Opaque links for derived upstream URLs (HLS segments, keys). The key is
 * derived from the persistent source key, so links survive a restart; each
 * token also expires and is bound to the item it was minted for.
 */
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

let streamKey: Buffer | undefined;
let imageKey: Buffer | undefined;

function keys() {
	streamKey ??= deriveIptvKey("aurora-iptv-stream");
	imageKey ??= deriveIptvKey("aurora-iptv-image");
	return { streamKey, imageKey };
}

export function sealStreamUrl(url: URL, itemId: string) {
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", keys().streamKey, nonce);
	const body = JSON.stringify({ u: url.href, i: itemId, e: Date.now() + TOKEN_TTL_MS });
	const payload = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
	return Buffer.concat([nonce, cipher.getAuthTag(), payload]).toString("base64url");
}

export function openStreamUrl(token: string) {
	try {
		const data = Buffer.from(token, "base64url");
		const decipher = createDecipheriv("aes-256-gcm", keys().streamKey, data.subarray(0, 12));
		decipher.setAuthTag(data.subarray(12, 28));
		const body = JSON.parse(
			Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
		) as { u: string; i: string; e: number };
		if (typeof body.e !== "number" || body.e < Date.now()) return null;
		return { url: httpUrl(body.u), itemId: body.i };
	} catch {
		return null;
	}
}

function imageSignature(url: string) {
	return createHmac("sha256", keys().imageKey).update(url).digest("base64url").slice(0, 32);
}

/** A stable, signed proxy URL for provider artwork, so the browser can cache it. */
export function signedImagePath(raw: string) {
	const url = httpUrl(raw).href;
	return `/api/iptv?image=${Buffer.from(url).toString("base64url")}&sig=${imageSignature(url)}`;
}

export function verifyImage(encoded: string, signature: string) {
	try {
		const url = Buffer.from(encoded, "base64url").toString();
		const expected = Buffer.from(imageSignature(url));
		const provided = Buffer.from(signature);
		if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
		return httpUrl(url);
	} catch {
		return null;
	}
}
