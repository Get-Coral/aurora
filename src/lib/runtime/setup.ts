import {
	fetchOpenSubtitlesKey,
	fetchSetupStatus,
	saveOpenSubtitlesKey,
	saveServerConnectionFn,
	saveSettings,
	saveSetupConfiguration,
} from "../../server/functions";
import {
	type ClientJellyfinSettings,
	getClientConfigurationSummary,
	getClientOpenSubtitlesApiKey,
	getStoredClientJellyfinSettings,
	saveClientJellyfinSettings,
	saveClientOpenSubtitlesApiKey,
	saveClientServerConnection,
	validateClientJellyfinSettings,
} from "../client-config-store";
import { callRuntime } from "./shared";

interface SetupPayload extends ClientJellyfinSettings {}

const EMPTY_SETUP_STATUS = {
	configured: false,
	source: "missing" as const,
	current: {
		url: "",
		apiKey: "",
		userId: "",
		username: "",
		password: "",
		hasApiKey: false,
		hasPassword: false,
	},
};

function mergeClientSettings(input: Partial<ClientJellyfinSettings>) {
	const current = getStoredClientJellyfinSettings();
	return {
		url: input.url?.trim() || current.url || "",
		apiKey: input.apiKey?.trim() || current.apiKey || "",
		userId: input.userId?.trim() || current.userId || "",
		username: input.username?.trim() || current.username || "",
		password: input.password?.trim() || current.password || "",
	};
}

export async function fetchSetupStatusRuntime() {
	return callRuntime(
		() => getClientConfigurationSummary(),
		async () => (await fetchSetupStatus()) ?? EMPTY_SETUP_STATUS,
	);
}

export async function saveSetupConfigurationRuntime(data: SetupPayload) {
	return callRuntime(
		async () => {
			const validated = await validateClientJellyfinSettings(data);
			saveClientJellyfinSettings(validated);
			return { configured: true };
		},
		() => saveSetupConfiguration({ data }),
	);
}

export async function saveSettingsRuntime(data: Partial<ClientJellyfinSettings>) {
	return callRuntime(
		async () => {
			const validated = await validateClientJellyfinSettings(mergeClientSettings(data));
			saveClientJellyfinSettings(validated);
			return { configured: true };
		},
		() =>
			saveSettings({
				data: {
					url: data.url ?? "",
					apiKey: data.apiKey ?? "",
					userId: data.userId ?? "",
					username: data.username ?? "",
					password: data.password ?? "",
				},
			}),
	);
}

export async function fetchOpenSubtitlesKeyRuntime() {
	return callRuntime(
		() => getClientOpenSubtitlesApiKey(),
		() => fetchOpenSubtitlesKey(),
	);
}

export async function saveOpenSubtitlesKeyRuntime(apiKey: string) {
	return callRuntime(
		() => {
			saveClientOpenSubtitlesApiKey(apiKey);
			return { apiKey: apiKey.trim() };
		},
		() => saveOpenSubtitlesKey({ data: { apiKey } }),
	);
}

export async function saveServerConnectionRuntime(url: string, apiKey: string) {
	return callRuntime(
		() => saveClientServerConnection(url, apiKey),
		() => saveServerConnectionFn({ data: { url, apiKey } }),
	);
}
