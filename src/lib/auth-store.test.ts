import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-auth-"));
process.env.AURORA_DATA_DIR = dataDir;
delete process.env.AURORA_REQUIRE_LOGIN;
delete process.env.AURORA_MULTI_USER;

const store = await import("./config-store");
const auth = await import("./auth-store");

function resetTables() {
	// A read touches the store, which lazily creates the sessions table.
	auth.getSessionByToken("_prime_");
	const db = store.getAppDatabase();
	db.exec("DELETE FROM app_settings");
	db.exec("DELETE FROM auth_sessions");
}

/** Enable required sign-in with a complete (but unreachable) config. */
function configureWithLogin() {
	store.saveJellyfinSettings({
		url: "http://jf.local",
		apiKey: "k",
		userId: "u",
		username: "n",
		password: "p",
	});
	store.setRequireLogin(true);
}

const sampleSession = {
	userId: "user-1",
	username: "alice",
	isAdmin: true,
	jellyfinToken: "jf-token-1",
	deviceId: "aurora-web-abcd",
};

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

describe("session lifecycle", () => {
	beforeEach(resetTables);

	it("creates a session and reads it back by token", () => {
		const token = auth.createAuthSession(sampleSession);
		expect(token).toMatch(/^[a-f0-9]{64}$/);

		const session = auth.getSessionByToken(token);
		expect(session).toMatchObject({
			userId: "user-1",
			username: "alice",
			isAdmin: true,
			jellyfinToken: "jf-token-1",
			deviceId: "aurora-web-abcd",
		});
	});

	it("returns null for unknown or empty tokens", () => {
		expect(auth.getSessionByToken(undefined)).toBeNull();
		expect(auth.getSessionByToken("")).toBeNull();
		expect(auth.getSessionByToken("nope")).toBeNull();
	});

	it("stores only a hash of the token, never the token itself", () => {
		const token = auth.createAuthSession(sampleSession);
		const row = store.getAppDatabase().prepare("SELECT token_hash FROM auth_sessions").get() as {
			token_hash: string;
		};
		expect(row.token_hash).not.toBe(token);
		expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("deletes a session by token", () => {
		const token = auth.createAuthSession(sampleSession);
		auth.deleteSessionByToken(token);
		expect(auth.getSessionByToken(token)).toBeNull();
	});

	it("treats an expired session as gone and removes it", () => {
		const token = auth.createAuthSession(sampleSession);
		store
			.getAppDatabase()
			.prepare("UPDATE auth_sessions SET expires_at = ?")
			.run(Math.floor(Date.now() / 1000) - 10);

		expect(auth.getSessionByToken(token)).toBeNull();
		const count = store.getAppDatabase().prepare("SELECT COUNT(*) c FROM auth_sessions").get() as {
			c: number;
		};
		expect(count.c).toBe(0);
	});
});

describe("cookie parsing", () => {
	it("extracts the session cookie among others", () => {
		const header = `theme=dark; ${auth.SESSION_COOKIE_NAME}=abc123; other=x`;
		expect(auth.getSessionTokenFromCookieHeader(header)).toBe("abc123");
	});

	it("returns null when absent", () => {
		expect(auth.getSessionTokenFromCookieHeader("theme=dark")).toBeNull();
		expect(auth.getSessionTokenFromCookieHeader(null)).toBeNull();
	});
});

describe("request authorization", () => {
	beforeEach(resetTables);

	it("allows any request when login is not enforced", () => {
		const req = new Request("http://localhost/api/x");
		expect(auth.isRequestAuthorized(req)).toBe(true);
	});

	it("blocks requests without a valid session when login is enforced", () => {
		configureWithLogin();
		const req = new Request("http://localhost/api/x");
		expect(auth.isRequestAuthorized(req)).toBe(false);
	});

	it("authorizes a request carrying a valid session cookie", () => {
		configureWithLogin();
		const token = auth.createAuthSession(sampleSession);
		const req = new Request("http://localhost/api/x", {
			headers: { cookie: `${auth.SESSION_COOKIE_NAME}=${token}` },
		});
		expect(auth.isRequestAuthorized(req)).toBe(true);
	});
});

describe("last-login tracking", () => {
	beforeEach(resetTables);

	it("records and reads back a login timestamp", () => {
		auth.recordUserLogin("user-9");
		const logins = auth.getLastUserLogins();
		expect(logins.has("user-9")).toBe(true);
		expect(() => new Date(logins.get("user-9") as string).toISOString()).not.toThrow();
	});
});
