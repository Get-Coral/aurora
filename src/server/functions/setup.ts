import { createServerFn } from "@tanstack/react-start";

export const fetchSetupStatus = createServerFn({ method: "GET" }).handler(async () => {
	const { getConfigurationSummary } = await import("@/lib/config-store");
	return getConfigurationSummary();
});

export const saveSetupConfiguration = createServerFn({ method: "POST" })
	.inputValidator(
		(input: { url: string; apiKey: string; userId: string; username: string; password: string }) =>
			input,
	)
	.handler(async ({ data }) => {
		const { validateJellyfinSettings, saveJellyfinSettings, isAuroraConfigured } = await import(
			"@/lib/config-store"
		);
		const validated = await validateJellyfinSettings({
			url: data.url,
			apiKey: data.apiKey,
			userId: data.userId,
			username: data.username,
			password: data.password,
		});

		saveJellyfinSettings(validated);

		return {
			configured: isAuroraConfigured(),
		};
	});

export const saveSettings = createServerFn({ method: "POST" })
	.inputValidator(
		(input: { url: string; apiKey: string; userId: string; username: string; password: string }) =>
			input,
	)
	.handler(async ({ data }) => {
		const {
			validateJellyfinSettings,
			saveJellyfinSettings,
			getEffectiveJellyfinSettings,
			isAuroraConfigured,
		} = await import("@/lib/config-store");
		const existing = getEffectiveJellyfinSettings();
		const settings = {
			url: data.url,
			apiKey: data.apiKey || existing?.apiKey || "",
			userId: data.userId,
			username: data.username,
			password: data.password || existing?.password || "",
		};
		const validated = await validateJellyfinSettings(settings);
		saveJellyfinSettings(validated);
		return { configured: isAuroraConfigured() };
	});

export const fetchOpenSubtitlesKey = createServerFn({ method: "GET" }).handler(async () => {
	const { getOpenSubtitlesApiKey } = await import("@/lib/config-store");
	return getOpenSubtitlesApiKey();
});

export const saveOpenSubtitlesKey = createServerFn({ method: "POST" })
	.inputValidator((input: { apiKey: string }) => input)
	.handler(async ({ data }) => {
		const { saveOpenSubtitlesApiKey } = await import("@/lib/config-store");
		saveOpenSubtitlesApiKey(data.apiKey);
		return { apiKey: data.apiKey };
	});

export const saveServerConnectionFn = createServerFn({ method: "POST" })
	.inputValidator((input: { url: string; apiKey: string }) => input)
	.handler(async ({ data }) => {
		const { saveServerConnection } = await import("@/lib/config-store");
		return saveServerConnection(data.url, data.apiKey);
	});
