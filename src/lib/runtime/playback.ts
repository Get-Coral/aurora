import {
	beginClientPlaybackSession,
	fetchClientOnlineSubtitle,
	reportClientPlaybackState,
	searchClientOnlineSubtitles,
} from "@/lib/client-media";
import {
	beginPlaybackSession,
	createStreamToken,
	fetchOnlineSubtitle,
	reportPlaybackState,
	searchOnlineSubtitles,
} from "@/server/functions";
import { callRuntime } from "./shared";

export async function beginPlaybackSessionRuntime(input: {
	data: {
		id: string;
		client?: {
			platform: "ios" | "android" | "android-tv" | "other";
			prefersSafeVideo: boolean;
			prefersTvMode: boolean;
		};
	};
}) {
	return callRuntime(
		() => beginClientPlaybackSession(input.data.id, input.data.client),
		() => beginPlaybackSession(input),
	);
}

export async function createStreamTokenRuntime(input: { data: { id: string } }) {
	return callRuntime(
		// The native shell talks to Jellyfin directly, with an api_key already
		// in the URL, so it never goes through the proxy that checks tokens.
		async () => ({ token: null as string | null, expiresAt: 0 }),
		() => createStreamToken(input),
	);
}

export async function reportPlaybackStateRuntime(input: {
	data: {
		id: string;
		positionTicks: number;
		playMethod?: "DirectPlay" | "Transcode";
		playSessionId?: string;
		mediaSourceId?: string;
		sessionId?: string;
		isPaused?: boolean;
		isStopped?: boolean;
		played?: boolean;
	};
}) {
	return callRuntime(
		() => reportClientPlaybackState({ id: input.data.id, played: input.data.played }),
		() => reportPlaybackState(input),
	);
}

export async function searchOnlineSubtitlesRuntime(input: {
	data: {
		title: string;
		year?: number;
		season?: number;
		episode?: number;
	};
}) {
	return callRuntime(
		() => searchClientOnlineSubtitles(input.data),
		() => searchOnlineSubtitles(input),
	);
}

export async function fetchOnlineSubtitleRuntime(input: { data: { fileId: number } }) {
	return callRuntime(
		() => fetchClientOnlineSubtitle(input.data.fileId),
		() => fetchOnlineSubtitle(input),
	);
}
