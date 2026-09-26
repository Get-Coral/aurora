import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Throwaway data dir before the import — the secret is persisted in SQLite and
// the connection is cached on first use.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-stream-token-"));
process.env.AURORA_DATA_DIR = dataDir;
delete process.env.AURORA_STREAM_TOKEN_SECRET;

const store = await import("./config-store");
const streamToken = await import("./stream-token");

const ITEM = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const OTHER_ITEM = "0a1b2c3d4e5f6071829304a5b6c7d8e9";
const SESSION = "a".repeat(64);

afterAll(() => {
	try {
		fs.rmSync(dataDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe("normalizeItemId", () => {
	it("strips dashes and lowercases", () => {
		expect(streamToken.normalizeItemId("3FA85F64-5717-4562-B3FC-2C963F66AFA6")).toBe(
			"3fa85f6457174562b3fc2c963f66afa6",
		);
	});
});

describe("itemIdFromMediaPath", () => {
	it("reads the item out of a video path", () => {
		expect(streamToken.itemIdFromMediaPath(`/Videos/${ITEM}/stream.mp4`)).toBe(
			streamToken.normalizeItemId(ITEM),
		);
	});

	it("reads the item out of an HLS segment path", () => {
		expect(streamToken.itemIdFromMediaPath(`/videos/${ITEM}/hls1/main/12.ts`)).toBe(
			streamToken.normalizeItemId(ITEM),
		);
	});

	it("handles audio paths", () => {
		expect(streamToken.itemIdFromMediaPath(`/Audio/${ITEM}/universal`)).toBe(
			streamToken.normalizeItemId(ITEM),
		);
	});

	it("returns null for non-media paths", () => {
		expect(streamToken.itemIdFromMediaPath(`/Items/${ITEM}/Images/Primary`)).toBeNull();
		expect(streamToken.itemIdFromMediaPath("/Users")).toBeNull();
		expect(streamToken.itemIdFromMediaPath("/videos/")).toBeNull();
	});
});

describe("mint and verify", () => {
	it("round-trips", () => {
		const { token, expiresAt } = streamToken.mintStreamToken({
			itemId: ITEM,
			sessionRef: SESSION,
		});

		const claims = streamToken.verifyStreamToken(token);
		expect(claims).not.toBeNull();
		expect(claims?.itemId).toBe(streamToken.normalizeItemId(ITEM));
		expect(claims?.sessionRef).toBe(SESSION);
		expect(claims?.expiresAt).toBe(expiresAt);
	});

	it("clamps the expiry to the session lifetime", () => {
		const sessionExpiry = Math.floor(Date.now() / 1000) + 60;
		const { expiresAt } = streamToken.mintStreamToken({
			itemId: ITEM,
			sessionRef: SESSION,
			maxExpiresAt: sessionExpiry,
		});

		expect(expiresAt).toBe(sessionExpiry);
	});

	it("rejects a tampered payload", () => {
		const { token } = streamToken.mintStreamToken({ itemId: ITEM, sessionRef: SESSION });
		const parts = token.split(".");
		parts[2] = streamToken.normalizeItemId(OTHER_ITEM);

		expect(streamToken.verifyStreamToken(parts.join("."))).toBeNull();
	});

	it("rejects a tampered signature", () => {
		const { token } = streamToken.mintStreamToken({ itemId: ITEM, sessionRef: SESSION });
		const parts = token.split(".");
		const signature = parts[4] as string;
		parts[4] = `${signature.slice(0, -1)}${signature.at(-1) === "A" ? "B" : "A"}`;

		expect(streamToken.verifyStreamToken(parts.join("."))).toBeNull();
	});

	it("rejects an extended expiry", () => {
		const { token } = streamToken.mintStreamToken({ itemId: ITEM, sessionRef: SESSION });
		const parts = token.split(".");
		parts[1] = String(Number(parts[1]) + 86_400);

		expect(streamToken.verifyStreamToken(parts.join("."))).toBeNull();
	});

	it("rejects the wrong field count", () => {
		const { token } = streamToken.mintStreamToken({ itemId: ITEM, sessionRef: SESSION });

		expect(streamToken.verifyStreamToken(token.split(".").slice(0, 4).join("."))).toBeNull();
		expect(streamToken.verifyStreamToken(`${token}.extra`)).toBeNull();
		expect(streamToken.verifyStreamToken("")).toBeNull();
		expect(streamToken.verifyStreamToken("garbage")).toBeNull();
	});

	it("rejects an unknown version", () => {
		const { token } = streamToken.mintStreamToken({ itemId: ITEM, sessionRef: SESSION });
		const parts = token.split(".");
		parts[0] = "2";

		expect(streamToken.verifyStreamToken(parts.join("."))).toBeNull();
	});

	it("rejects an expired token", () => {
		const { token } = streamToken.mintStreamToken({
			itemId: ITEM,
			sessionRef: SESSION,
			ttlSeconds: -1,
		});

		expect(streamToken.verifyStreamToken(token)).toBeNull();
	});

	it("binds the token to one item", () => {
		const { token } = streamToken.mintStreamToken({ itemId: ITEM, sessionRef: SESSION });
		const claims = streamToken.verifyStreamToken(token);

		// The proxy compares these; a token for one item must not match another.
		expect(claims?.itemId).not.toBe(
			streamToken.itemIdFromMediaPath(`/Videos/${OTHER_ITEM}/stream.mp4`),
		);
		expect(claims?.itemId).toBe(streamToken.itemIdFromMediaPath(`/Videos/${ITEM}/stream.mp4`));
	});
});

describe("the signing secret", () => {
	it("persists across calls", () => {
		expect(store.getStreamTokenSecret()).toBe(store.getStreamTokenSecret());
	});

	it("invalidates old tokens when rotated", () => {
		const { token } = streamToken.mintStreamToken({ itemId: ITEM, sessionRef: SESSION });
		expect(streamToken.verifyStreamToken(token)).not.toBeNull();

		store.getAppDatabase().exec("DELETE FROM app_settings");

		expect(streamToken.verifyStreamToken(token)).toBeNull();
	});
});
