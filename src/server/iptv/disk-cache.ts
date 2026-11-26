import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import { deriveIptvKey } from "../../lib/iptv-source-store";

/**
 * IPTV catalogs and guides on disk, so a restart or deploy doesn't mean
 * reloading tens of megabytes from the provider before Live TV works again.
 * Catalogs hold provider credentials and playlist URLs, so those files are
 * encrypted with a key derived from the source key.
 */

const zip = promisify(gzip);
const unzip = promisify(gunzip);

function directory() {
	return path.join(process.env.AURORA_DATA_DIR ?? path.join(process.cwd(), "data"), "iptv-cache");
}

let cacheKey: Buffer | undefined;
function key() {
	cacheKey ??= deriveIptvKey("aurora-iptv-disk-cache");
	return cacheKey;
}

function fileFor(name: string) {
	if (!/^[a-z0-9._-]+$/i.test(name)) throw new Error("Invalid cache name");
	return path.join(directory(), name);
}

export async function writeCached(name: string, value: unknown, encrypted: boolean) {
	try {
		let data = await zip(Buffer.from(JSON.stringify({ savedAt: Date.now(), value })));
		if (encrypted) {
			const nonce = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key(), nonce);
			cipher.setAAD(Buffer.from(name));
			const body = Buffer.concat([cipher.update(data), cipher.final()]);
			data = Buffer.concat([nonce, cipher.getAuthTag(), body]);
		}
		await mkdir(directory(), { recursive: true });
		const file = fileFor(name);
		// Write next to it and swap, so a crash never leaves half a file.
		const temporary = `${file}.${process.pid}.tmp`;
		await writeFile(temporary, data, { mode: 0o600 });
		await rename(temporary, file);
	} catch {
		// The cache is an optimisation; failing to write it changes nothing.
	}
}

export async function readCached<T>(
	name: string,
	encrypted: boolean,
): Promise<{ savedAt: number; value: T } | null> {
	try {
		let data = await readFile(fileFor(name));
		if (encrypted) {
			const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
			decipher.setAAD(Buffer.from(name));
			decipher.setAuthTag(data.subarray(12, 28));
			data = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
		}
		const parsed = JSON.parse((await unzip(data)).toString()) as { savedAt?: unknown; value?: T };
		if (typeof parsed.savedAt !== "number" || parsed.value === undefined) return null;
		return { savedAt: parsed.savedAt, value: parsed.value };
	} catch {
		return null;
	}
}

/** Remove a source's cached files (its catalog and guide). */
export async function removeCached(prefix: string) {
	try {
		const names = await readdir(directory());
		await Promise.all(
			names
				.filter((name) => name.startsWith(prefix))
				.map((name) => rm(path.join(directory(), name), { force: true })),
		);
	} catch {
		// Nothing cached yet.
	}
}
