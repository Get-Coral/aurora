import { redirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";

/**
 * Blocks server function access when the "require login" setting is enabled
 * and the request carries no valid Aurora session cookie. Passes through
 * untouched while Aurora is unconfigured so the first-run setup flow keeps
 * working.
 */
export const authRequiredMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const { isLoginEnforced, getSessionByToken, SESSION_COOKIE_NAME } =
			await import("@/lib/auth-store");

		if (isLoginEnforced()) {
			const { getCookie } = await import("@tanstack/react-start/server");
			const session = getSessionByToken(getCookie(SESSION_COOKIE_NAME));
			if (!session) {
				throw redirect({ to: "/login" });
			}
		}

		return next();
	},
);

/**
 * Administration always requires a signed-in Jellyfin administrator, even when
 * browsing is open. These functions act with the server's API key, so gating
 * them on the browsing login setting meant an open instance let anyone manage
 * users, libraries, and server settings.
 *
 * The one exception is an unconfigured Aurora: there is no Jellyfin to
 * authenticate against yet, so the first-run setup flow has to pass through.
 */
export const adminRequiredMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const { isAuroraConfigured } = await import("@/lib/config-store");
		if (!isAuroraConfigured()) {
			return next();
		}

		const { getSessionByToken, SESSION_COOKIE_NAME } = await import("@/lib/auth-store");
		const { getCookie } = await import("@tanstack/react-start/server");

		// An error, not a redirect: the client follows a redirect from any
		// server function, so an admin-only query that ran on an ordinary page
		// (the player used to ask for the OpenSubtitles key) sent everyone who
		// isn't an admin to /login and from there back to Home, over and over
		// as the query retried (#105). Admin pages check the role in their
		// loaders and redirect from there.
		const session = getSessionByToken(getCookie(SESSION_COOKIE_NAME));
		if (!session?.isAdmin) {
			throw new Error("Administrator access required");
		}

		return next();
	},
);
