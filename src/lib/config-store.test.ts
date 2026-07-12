import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// Point the store at a throwaway data dir before importing it (the DB path is
// resolved from AURORA_DATA_DIR and the connection is cached on first use).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-config-"));
process.env.AURORA_DATA_DIR = dataDir;
delete process.env.AURORA_REQUIRE_LOGIN;
delete process.env.AURORA_MULTI_USER;

const store = await import("./config-store");

function resetTables() {
	const db = store.getAppDatabase();
	db.exec("DELETE FROM app_settings");
}

afterAll(() => {
	// Best effort — the cached SQLite connection stays open for the process
	// lifetime, so Windows may hold a lock on the file. The temp dir is
	// ephemeral either way.
	try {
		fs.rmSync(dataDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("require-login setting", () => {
	beforeEach(resetTables);

	it("defaults to false", () => {
		expect(store.getRequireLogin()).toBe(false);
		expect(store.isRequireLoginLocked()).toBe(false);
	});

	it("round-trips through the database", () => {
		store.setRequireLogin(true);
		expect(store.getRequireLogin()).toBe(true);
		store.setRequireLogin(false);
		expect(store.getRequireLogin()).toBe(false);
	});
});

describe("multi-user setting", () => {
	beforeEach(resetTables);

	it("defaults to false and unlocked", () => {
		expect(store.getMultiUserMode()).toBe(false);
		expect(store.isMultiUserModeLocked()).toBe(false);
	});

	it("stores and clears the active user", () => {
		expect(store.getActiveUserId()).toBeNull();
		store.setActiveUserId("user-123");
		expect(store.getActiveUserId()).toBe("user-123");
		store.clearActiveUserId();
		expect(store.getActiveUserId()).toBe("");
	});
});

describe("getConfigurationSummary credential exposure", () => {
	beforeEach(resetTables);

	it("hides the api key and password once configured", () => {
		store.saveJellyfinSettings({
			url: "http://jf.local",
			apiKey: "secret-key",
			userId: "uid",
			username: "alice",
			password: "hunter2",
		});

		const summary = store.getConfigurationSummary();
		expect(summary.configured).toBe(true);
		// Sensitive values are blanked, but the presence flags stay truthful.
		expect(summary.current.apiKey).toBe("");
		expect(summary.current.password).toBe("");
		expect(summary.current.hasApiKey).toBe(true);
		expect(summary.current.hasPassword).toBe(true);
		// Non-sensitive fields are still returned for display.
		expect(summary.current.url).toBe("http://jf.local");
		expect(summary.current.username).toBe("alice");
	});

	it("exposes stored values while unconfigured (for /setup prefill)", () => {
		store.saveJellyfinSettings({
			url: "http://jf.local",
			apiKey: "",
			userId: "",
			username: "",
			password: "",
		});
		const summary = store.getConfigurationSummary();
		expect(summary.configured).toBe(false);
		expect(summary.current.url).toBe("http://jf.local");
	});
});

describe("OpenSubtitles key", () => {
	beforeEach(resetTables);

	it("round-trips", () => {
		expect(store.getOpenSubtitlesApiKey()).toBeNull();
		store.saveOpenSubtitlesApiKey("os-key");
		expect(store.getOpenSubtitlesApiKey()).toBe("os-key");
	});
});

describe("settings source detection", () => {
	beforeEach(resetTables);

	it("reports missing when nothing is stored", () => {
		expect(store.getJellyfinSettingsSource()).toBe("missing");
	});

	it("reports database when a complete config is stored", () => {
		store.saveJellyfinSettings({
			url: "http://jf.local",
			apiKey: "k",
			userId: "u",
			username: "n",
			password: "p",
		});
		expect(store.getJellyfinSettingsSource()).toBe("database");
	});
});
