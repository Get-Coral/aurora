import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { iptvEnabled, isAllowedOrigin } from "./network";

afterEach(() => vi.unstubAllEnvs());

describe("IPTV origins", () => {
	it("stays off on a server until origins are allowed, and then only those", () => {
		vi.stubEnv("AURORA_IPTV_ORIGINS", "");
		vi.stubEnv("AURORA_IPTV_ANY_ORIGIN", "");
		expect(iptvEnabled()).toBe(false);

		vi.stubEnv("AURORA_IPTV_ORIGINS", "http://provider.example");
		expect(iptvEnabled()).toBe(true);
		expect(isAllowedOrigin(new URL("http://provider.example/get.php"))).toBe(true);
		expect(isAllowedOrigin(new URL("http://other.example/get.php"))).toBe(false);
	});

	it("reaches any provider in the desktop app, but only over http(s)", () => {
		vi.stubEnv("AURORA_IPTV_ORIGINS", "");
		vi.stubEnv("AURORA_IPTV_ANY_ORIGIN", "true");
		expect(iptvEnabled()).toBe(true);
		expect(isAllowedOrigin(new URL("http://provider.example/get.php"))).toBe(true);
		expect(isAllowedOrigin(new URL("http://192.168.1.20:9981/playlist"))).toBe(true);
		expect(isAllowedOrigin(new URL("file:///etc/passwd"))).toBe(false);
	});
});
