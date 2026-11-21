import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAppDatabase } from "./config-store";
import {
	type IptvSourceConfig,
	type IptvSourceInput,
	type IptvSourceOptions,
	type IptvSourceSummary,
	normalizeSourceInput,
	normalizeSourceOptions,
	summarizeSource,
} from "./iptv/source";
import { m3uLegacyInput } from "./iptv/urls";

/** Cookie of the per-browser source saved by earlier versions. */
export const LEGACY_IPTV_SOURCE_COOKIE = "aurora_iptv_source";

function database() {
	const db = getAppDatabase();
	db.exec(
		[
			"CREATE TABLE IF NOT EXISTS iptv_sources (id TEXT PRIMARY KEY, source TEXT NOT NULL, home INTEGER NOT NULL)",
			"CREATE TABLE IF NOT EXISTS iptv_sources_v2 (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, config TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
		].join(";\n"),
	);
	try {
		db.exec("ALTER TABLE iptv_sources_v2 ADD COLUMN options TEXT");
	} catch {
		// Already there.
	}
	return db;
}

let cachedKey: Buffer | undefined;

/** The key that encrypts saved sources; generated beside the database. */
export function iptvSourceKey() {
	if (cachedKey) return cachedKey;
	const configured = process.env.AURORA_IPTV_SOURCE_KEY;
	if (configured) {
		if (!/^[a-f0-9]{64}$/i.test(configured)) throw new Error("Invalid IPTV source key");
		cachedKey = Buffer.from(configured, "hex");
		return cachedKey;
	}
	const file = path.join(
		process.env.AURORA_DATA_DIR ?? path.join(process.cwd(), "data"),
		".iptv-source-key",
	);
	try {
		cachedKey = readFileSync(file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const generated = randomBytes(32);
		try {
			writeFileSync(file, generated, { flag: "wx", mode: 0o600 });
			cachedKey = generated;
		} catch (writeError) {
			if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
			cachedKey = readFileSync(file);
		}
	}
	return cachedKey;
}

/** A separate key for a separate purpose, derived from the source key. */
export function deriveIptvKey(purpose: string) {
	return Buffer.from(hkdfSync("sha256", iptvSourceKey(), Buffer.alloc(0), purpose, 32));
}

function encrypt(value: string, aad: string) {
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", iptvSourceKey(), nonce);
	cipher.setAAD(Buffer.from(aad));
	const payload = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
	return Buffer.concat([nonce, cipher.getAuthTag(), payload]).toString("base64url");
}

function decrypt(value: string, aad: string) {
	const token = Buffer.from(value, "base64url");
	const decipher = createDecipheriv("aes-256-gcm", iptvSourceKey(), token.subarray(0, 12));
	decipher.setAAD(Buffer.from(aad));
	decipher.setAuthTag(token.subarray(12, 28));
	return Buffer.concat([decipher.update(token.subarray(28)), decipher.final()]).toString();
}

interface SourceRow {
	id: string;
	name: string;
	config: string;
	updated_at: number;
}

function rows() {
	return database()
		.prepare(
			"SELECT id, name, config, updated_at FROM iptv_sources_v2 ORDER BY position, created_at",
		)
		.all() as unknown as SourceRow[];
}

function configOf(row: SourceRow) {
	return JSON.parse(decrypt(row.config, row.id)) as IptvSourceConfig;
}

export function listIptvSourceIds() {
	return rows().map((row) => row.id);
}

export function listIptvSources(): IptvSourceSummary[] {
	return rows().flatMap((row) => {
		try {
			return [summarizeSource(row.id, row.name, configOf(row), row.updated_at)];
		} catch {
			return [];
		}
	});
}

export function getIptvSource(id: string) {
	const row = rows().find((candidate) => candidate.id === id);
	if (!row) return null;
	return { id: row.id, name: row.name, config: configOf(row), updatedAt: row.updated_at };
}

export function saveIptvSource(input: IptvSourceInput, id?: string) {
	const existing = id ? getIptvSource(id) : null;
	if (id && !existing) throw new Error("Unknown IPTV source");
	// Editing keeps the saved password when the form leaves it empty.
	const keepPassword =
		existing?.config.kind === "xtream" && input.kind === "xtream" && !input.password
			? existing.config.xtream.password
			: undefined;
	const { name, config } = normalizeSourceInput({
		...input,
		password: input.password || keepPassword,
	});
	const sourceId = existing?.id ?? randomBytes(6).toString("hex");
	const now = Date.now();
	database()
		.prepare(
			"INSERT INTO iptv_sources_v2 (id, name, kind, config, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, config = excluded.config, updated_at = excluded.updated_at",
		)
		.run(
			sourceId,
			name,
			config.kind,
			encrypt(JSON.stringify(config), sourceId),
			rows().length,
			now,
			now,
		);
	return sourceId;
}

export function deleteIptvSource(id: string) {
	database().prepare("DELETE FROM iptv_sources_v2 WHERE id = ?").run(id);
}

/**
 * Earlier versions saved one source per browser, behind a cookie. Move it into
 * the instance's source list the first time an administrator comes by.
 */
export function migrateLegacyIptvSource(cookieId: string | undefined) {
	if (!cookieId || !/^[a-f0-9]{64}$/.test(cookieId)) return false;
	const storageId = createHash("sha256").update(cookieId).digest("hex");
	const row = database().prepare("SELECT source FROM iptv_sources WHERE id = ?").get(storageId) as
		| { source?: string }
		| undefined;
	if (!row?.source) return false;
	try {
		const saved = JSON.parse(decrypt(row.source, cookieId)) as { input: string; direct: boolean };
		saveIptvSource(m3uLegacyInput(saved.input, saved.direct));
	} finally {
		database().prepare("DELETE FROM iptv_sources WHERE id = ?").run(storageId);
	}
	return true;
}

export function getIptvSourceOptions(id: string): IptvSourceOptions {
	const row = database().prepare("SELECT options FROM iptv_sources_v2 WHERE id = ?").get(id) as
		| { options?: string | null }
		| undefined;
	try {
		return normalizeSourceOptions(row?.options ? JSON.parse(row.options) : {});
	} catch {
		return normalizeSourceOptions({});
	}
}

/** Options aren't secret and don't change the catalog, so the cache stays. */
export function setIptvSourceOptions(id: string, options: IptvSourceOptions) {
	database()
		.prepare("UPDATE iptv_sources_v2 SET options = ? WHERE id = ?")
		.run(JSON.stringify(normalizeSourceOptions(options)), id);
}
