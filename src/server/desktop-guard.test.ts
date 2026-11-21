import { describe, expect, it } from "vitest";
import { createDesktopGuard, DESKTOP_ENTRY_PATH } from "../../desktop-guard.mjs";

const token = "a".repeat(43);
const guard = createDesktopGuard({ token, port: 4123 });
const at = (path: string) => new URL(path, "http://127.0.0.1:4123");

describe("desktop guard", () => {
	it("is off for a normal server", () => {
		expect(createDesktopGuard({ token: undefined, port: 3000 })).toBeNull();
	});

	it("opens the window's session with the launch token and nothing else", () => {
		const entry = guard?.({ host: "127.0.0.1:4123" }, at(`${DESKTOP_ENTRY_PATH}?token=${token}`));
		expect(entry?.status).toBe(200);
		expect(entry?.body).toContain('location.replace("/")');
		expect(entry?.headers?.["set-cookie"]).toContain("SameSite=Strict");
		expect(entry?.headers?.["set-cookie"]).toContain("HttpOnly");

		expect(
			guard?.({ host: "127.0.0.1:4123" }, at(`${DESKTOP_ENTRY_PATH}?token=wrong`))?.status,
		).toBe(403);
		expect(guard?.({ host: "127.0.0.1:4123" }, at(DESKTOP_ENTRY_PATH))?.status).toBe(403);
	});

	it("lets the window through and refuses requests without its cookie", () => {
		expect(
			guard?.({ host: "127.0.0.1:4123", cookie: `x=1; aurora_desktop=${token}` }, at("/")),
		).toBeNull();
		expect(
			guard?.({ host: "localhost:4123", cookie: `aurora_desktop=${token}` }, at("/api/x")),
		).toBeNull();
		expect(guard?.({ host: "127.0.0.1:4123" }, at("/"))?.status).toBe(403);
		expect(
			guard?.({ host: "127.0.0.1:4123", cookie: "aurora_desktop=nope" }, at("/"))?.status,
		).toBe(403);
	});

	it("serves the built client files without the cookie, but only on the loopback host", () => {
		expect(
			guard?.({ host: "127.0.0.1:4123" }, at("/manifest.json"), { publicFile: true }),
		).toBeNull();
		expect(
			guard?.({ host: "evil.example:4123" }, at("/manifest.json"), { publicFile: true })?.status,
		).toBe(403);
	});

	it("refuses a rebound domain even with the cookie", () => {
		const rebound = guard?.(
			{ host: "evil.example:4123", cookie: `aurora_desktop=${token}` },
			new URL("http://evil.example:4123/"),
		);
		expect(rebound?.status).toBe(403);
	});
});
