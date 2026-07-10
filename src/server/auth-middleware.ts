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
		const { isLoginEnforced, getSessionByToken, SESSION_COOKIE_NAME } = await import(
			"@/lib/auth-store"
		);

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
