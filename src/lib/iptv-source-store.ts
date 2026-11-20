import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAppDatabase } from "./config-store";

export const IPTV_SOURCE_COOKIE = "aurora_iptv_source";
export const IPTV_SOURCE_MAX_AGE = 365 * 24 * 60 * 60;

function database() {
	const db = getAppDatabase();
	db.exec(
		"CREATE TABLE IF NOT EXISTS iptv_sources (id TEXT PRIMARY KEY, source TEXT NOT NULL, home INTEGER NOT NULL)",
	);
	return db;
}

function key() {
	const configured = process.env.AURORA_IPTV_SOURCE_KEY;
	if (configured) {
		if (!/^[a-f0-9]{64}$/i.test(configured)) throw new Error("Invalid IPTV source key");
		return Buffer.from(configured, "hex");
	}
	const file = path.join(
		process.env.AURORA_DATA_DIR ?? path.join(process.cwd(), "data"),
		".iptv-source-key",
	);
	try {
		return readFileSync(file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const generated = randomBytes(32);
		try {
			writeFileSync(file, generated, { flag: "wx", mode: 0o600 });
			return generated;
		} catch (writeError) {
			if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
			return readFileSync(file);
		}
	}
}

export function validIptvSourceId(value: string | undefined): value is string {
	return Boolean(value && /^[a-f0-9]{64}$/.test(value));
}

function storageId(id: string) {
	return createHash("sha256").update(id).digest("hex");
}

export function getIptvHome(id: string | undefined) {
	return (
		validIptvSourceId(id) &&
		database().prepare("SELECT home FROM iptv_sources WHERE id = ?").get(storageId(id))?.home === 1
	);
}

export function loadIptvSource(id: string | undefined) {
	if (!validIptvSourceId(id)) return null;
	const row = database()
		.prepare("SELECT source, home FROM iptv_sources WHERE id = ?")
		.get(storageId(id));
	if (!row || typeof row.source !== "string") return null;
	const token = Buffer.from(row.source, "base64url");
	const decipher = createDecipheriv("aes-256-gcm", key(), token.subarray(0, 12));
	decipher.setAAD(Buffer.from(id));
	decipher.setAuthTag(token.subarray(12, 28));
	return {
		...(JSON.parse(
			Buffer.concat([decipher.update(token.subarray(28)), decipher.final()]).toString(),
		) as { input: string; direct: boolean }),
		home: row.home === 1,
	};
}

export function saveIptvSource(previous: string | undefined, input: URL, direct: boolean) {
	const id = validIptvSourceId(previous) ? previous : randomBytes(32).toString("hex");
	const db = database();
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key(), nonce);
	cipher.setAAD(Buffer.from(id));
	const payload = Buffer.concat([
		cipher.update(JSON.stringify({ input: input.href, direct }), "utf8"),
		cipher.final(),
	]);
	const encrypted = Buffer.concat([nonce, cipher.getAuthTag(), payload]).toString("base64url");
	db.prepare(
		"INSERT INTO iptv_sources (id, source, home) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET source = excluded.source, home = 1",
	).run(storageId(id), encrypted);
	return id;
}

export function setIptvHome(id: string | undefined, enabled: boolean) {
	if (validIptvSourceId(id)) {
		database()
			.prepare("UPDATE iptv_sources SET home = ? WHERE id = ?")
			.run(Number(enabled), storageId(id));
	}
}

export function forgetIptvSource(id: string | undefined) {
	if (validIptvSourceId(id))
		database().prepare("DELETE FROM iptv_sources WHERE id = ?").run(storageId(id));
}
