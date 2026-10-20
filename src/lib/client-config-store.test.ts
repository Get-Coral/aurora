// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getClientDeviceId,
	getEffectiveClientJellyfinSettings,
	saveClientJellyfinSettings,
	signInClientJellyfin,
	validateClientJellyfinSettings,
} from "./client-config-store";

const SERVER = "https://jellyfin.example.com";

function mockAuthResponse(status: number, body: unknown = {}) {
	const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("password sign-in", () => {
	it("signs in with an empty password and stores the session token as the API key", async () => {
		const fetchMock = mockAuthResponse(200, {
			AccessToken: "session-token",
			User: { Id: "user-1", Name: "demo" },
		});

		const settings = await signInClientJellyfin({
			url: `${SERVER}/`,
			username: " demo ",
			password: "",
		});

		expect(settings).toEqual({
			url: SERVER,
			apiKey: "session-token",
			accessToken: "session-token",
			userId: "user-1",
			username: "demo",
			password: "",
		});
		const [requestUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(requestUrl).toBe(`${SERVER}/Users/AuthenticateByName`);
		expect(JSON.parse(String(init.body))).toEqual({ Username: "demo", Pw: "" });
	});

	it("explains rejected credentials", async () => {
		mockAuthResponse(401);

		await expect(
			signInClientJellyfin({ url: SERVER, username: "demo", password: "wrong" }),
		).rejects.toThrow("Jellyfin did not accept that username and password.");
	});

	it("is used by validation when no API key is given", async () => {
		mockAuthResponse(200, { AccessToken: "session-token", User: { Id: "user-1" } });

		const settings = await validateClientJellyfinSettings({
			url: SERVER,
			apiKey: "",
			userId: "",
			username: "demo",
			password: "",
		});

		expect(settings.accessToken).toBe("session-token");
		expect(settings.userId).toBe("user-1");
	});
});

describe("stored settings", () => {
	it("treats a session sign-in without a password as complete", () => {
		saveClientJellyfinSettings({
			url: SERVER,
			apiKey: "session-token",
			accessToken: "session-token",
			userId: "user-1",
			username: "demo",
			password: "",
		});

		expect(getEffectiveClientJellyfinSettings()?.accessToken).toBe("session-token");
	});

	it("still requires a password for API-key setups", () => {
		saveClientJellyfinSettings({
			url: SERVER,
			apiKey: "api-key",
			userId: "user-1",
			username: "demo",
			password: "",
		});

		expect(getEffectiveClientJellyfinSettings()).toBeNull();
	});
});

describe("device id", () => {
	it("is generated once per install and then reused", () => {
		const first = getClientDeviceId();

		expect(first).toMatch(/^aurora-[0-9a-f-]{36}$/);
		expect(getClientDeviceId()).toBe(first);
	});
});
