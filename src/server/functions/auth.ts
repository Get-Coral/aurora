import { createServerFn } from "@tanstack/react-start";

const SESSION_COOKIE_OPTIONS = {
	httpOnly: true,
	sameSite: "lax",
	path: "/",
} as const;

async function setSessionCookie(token: string) {
	const { SESSION_MAX_AGE_SECONDS, SESSION_COOKIE_NAME } = await import("@/lib/auth-store");
	const { setCookie, getRequestProtocol } = await import("@tanstack/react-start/server");

	setCookie(SESSION_COOKIE_NAME, token, {
		...SESSION_COOKIE_OPTIONS,
		maxAge: SESSION_MAX_AGE_SECONDS,
		secure: getRequestProtocol({ xForwardedProto: true }) === "https",
	});
}

export const fetchAuthStatus = createServerFn({ method: "GET" }).handler(async () => {
	const { isLoginEnforced, getSessionByToken, SESSION_COOKIE_NAME } = await import(
		"@/lib/auth-store"
	);
	const { getRequireLogin, isRequireLoginLocked } = await import("@/lib/config-store");
	const { getCookie } = await import("@tanstack/react-start/server");

	const required = isLoginEnforced();
	const session = getSessionByToken(getCookie(SESSION_COOKIE_NAME));

	return {
		requireLogin: getRequireLogin(),
		locked: isRequireLoginLocked(),
		required,
		authenticated: !required || session != null,
		userId: session?.userId ?? null,
		username: session?.username ?? null,
		// On an open instance everyone can administer, matching pre-login behavior.
		isAdmin: required ? (session?.isAdmin ?? false) : true,
	};
});

export const loginServerFn = createServerFn({ method: "POST" })
	.inputValidator((input: { username: string; password: string }) => input)
	.handler(async ({ data }) => {
		const { authenticateJellyfinCredentials, createAuthSession, recordUserLogin } = await import(
			"@/lib/auth-store"
		);

		const username = data.username.trim();
		if (!username) {
			throw new Error("Username is required.");
		}

		const session = await authenticateJellyfinCredentials(username, data.password);

		// Replace any existing session (and revoke its Jellyfin token) instead
		// of leaving it valid until expiry.
		const { destroySessionByToken, SESSION_COOKIE_NAME } = await import("@/lib/auth-store");
		const { getCookie } = await import("@tanstack/react-start/server");
		await destroySessionByToken(getCookie(SESSION_COOKIE_NAME));

		const token = createAuthSession(session);
		await setSessionCookie(token);
		recordUserLogin(session.userId);

		// In multi-user mode a successful sign-in also selects that user's
		// profile, so switching profiles is the same as signing in as them.
		const { getMultiUserMode, setActiveUserId } = await import("@/lib/config-store");
		if (getMultiUserMode()) {
			setActiveUserId(session.userId);
		}

		return { ok: true, userId: session.userId, username: session.username };
	});

export const logoutServerFn = createServerFn({ method: "POST" }).handler(async () => {
	const { destroySessionByToken, SESSION_COOKIE_NAME } = await import("@/lib/auth-store");
	const { getCookie, deleteCookie } = await import("@tanstack/react-start/server");

	await destroySessionByToken(getCookie(SESSION_COOKIE_NAME));
	deleteCookie(SESSION_COOKIE_NAME, { path: "/" });

	return { ok: true };
});

export const setRequireLoginServerFn = createServerFn({ method: "POST" })
	.inputValidator((input: { enabled: boolean }) => input)
	.handler(async ({ data }) => {
		const { isLoginEnforced, getSessionByToken, createAuthSession, SESSION_COOKIE_NAME } =
			await import("@/lib/auth-store");
		const { isRequireLoginLocked, setRequireLogin, getEffectiveJellyfinSettings } = await import(
			"@/lib/config-store"
		);
		const { getCookie } = await import("@tanstack/react-start/server");

		if (isRequireLoginLocked()) {
			throw new Error("The login requirement is forced on by AURORA_REQUIRE_LOGIN.");
		}

		const currentSession = getSessionByToken(getCookie(SESSION_COOKIE_NAME));

		if (isLoginEnforced() && !currentSession?.isAdmin) {
			throw new Error("Only a Jellyfin administrator can change the login requirement.");
		}

		setRequireLogin(data.enabled);

		// When enabling, keep the current visitor signed in as the configured
		// Jellyfin user so they are not locked out the moment the requirement
		// takes effect.
		if (data.enabled && !currentSession) {
			const settings = getEffectiveJellyfinSettings();
			if (settings?.userId) {
				let isAdmin = true;
				try {
					const { getUserById } = await import("@/lib/jellyfin");
					const user = await getUserById(settings.userId);
					isAdmin = user.Policy?.IsAdministrator ?? true;
				} catch {
					// If Jellyfin cannot be reached, keep admin so the person who
					// enabled the requirement can still turn it back off.
				}

				const token = createAuthSession({
					userId: settings.userId,
					username: settings.username,
					isAdmin,
					// No credential exchange happened here, so playback falls back
					// to the configured account until this visitor signs in.
					jellyfinToken: null,
					deviceId: null,
				});
				await setSessionCookie(token);
			}
		}

		return { ok: true, requireLogin: data.enabled };
	});
