import { createServerFn } from "@tanstack/react-start";

const LANGUAGE_NAMES: Record<string, string> = {
	en: "English",
	nl: "Nederlands",
	de: "Deutsch",
	fr: "Français",
	es: "Español",
	it: "Italiano",
	pt: "Português",
	"pt-pt": "Português (PT)",
	"pt-br": "Português (BR)",
	ru: "Русский",
	pl: "Polski",
	cs: "Čeština",
	sk: "Slovenčina",
	hu: "Magyar",
	ro: "Română",
	bg: "Български",
	hr: "Hrvatski",
	sr: "Srpski",
	sl: "Slovenščina",
	sv: "Svenska",
	no: "Norsk",
	da: "Dansk",
	fi: "Suomi",
	el: "Ελληνικά",
	tr: "Türkçe",
	ar: "العربية",
	he: "עברית",
	zh: "中文",
	"zh-cn": "中文(简)",
	"zh-tw": "中文(繁)",
	ja: "日本語",
	ko: "한국어",
	th: "ภาษาไทย",
	id: "Bahasa Indonesia",
	ms: "Bahasa Melayu",
	vi: "Tiếng Việt",
	uk: "Українська",
	et: "Eesti",
	lv: "Latviešu",
	lt: "Lietuvių",
};

interface OpenSubtitleResult {
	id: string;
	language: string;
	label: string;
	fileId: number;
}

function srtToVtt(srt: string): string {
	return `WEBVTT\n\n${srt.replace(/\r\n/g, "\n").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
}

export const searchOnlineSubtitles = createServerFn({ method: "GET" })
	.inputValidator(
		(input: { title: string; year?: number; season?: number; episode?: number }) => input,
	)
	.handler(async ({ data }): Promise<OpenSubtitleResult[]> => {
		const { getOpenSubtitlesApiKey } = await import("@/lib/config-store");
		const apiKey = getOpenSubtitlesApiKey();
		if (!apiKey) return [];

		const params = new URLSearchParams({
			query: data.title,
			order_by: "download_count",
			order_direction: "desc",
		});
		if (data.year) params.set("year", String(data.year));
		if (data.season) params.set("season_number", String(data.season));
		if (data.episode) params.set("episode_number", String(data.episode));

		const res = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?${params.toString()}`, {
			headers: {
				"Api-Key": apiKey,
				"Content-Type": "application/json",
				"User-Agent": "Aurora v1.0.0",
			},
		}).catch(() => null);

		if (!res?.ok) return [];

		const json = (await res.json()) as {
			data: Array<{
				id: string;
				attributes: {
					language: string;
					release: string;
					download_count: number;
					files: Array<{ file_id: number }>;
				};
			}>;
		};

		const seenLanguages = new Set<string>();
		return json.data
			.filter((subtitle) => subtitle.attributes.files[0]?.file_id)
			.filter((subtitle) => {
				if (seenLanguages.has(subtitle.attributes.language)) return false;
				seenLanguages.add(subtitle.attributes.language);
				return true;
			})
			.slice(0, 12)
			.map((subtitle) => ({
				id: subtitle.id,
				language: subtitle.attributes.language,
				label:
					LANGUAGE_NAMES[subtitle.attributes.language] ??
					subtitle.attributes.language.toUpperCase(),
				fileId: subtitle.attributes.files[0].file_id,
			}));
	});

export const fetchOnlineSubtitle = createServerFn({ method: "POST" })
	.inputValidator((input: { fileId: number }) => input)
	.handler(async ({ data }) => {
		const { getOpenSubtitlesApiKey } = await import("@/lib/config-store");
		const apiKey = getOpenSubtitlesApiKey();
		if (!apiKey) throw new Error("No OpenSubtitles API key configured");

		const linkRes = await fetch("https://api.opensubtitles.com/api/v1/download", {
			method: "POST",
			headers: {
				"Api-Key": apiKey,
				"Content-Type": "application/json",
				"User-Agent": "Aurora v1.0.0",
			},
			body: JSON.stringify({ file_id: data.fileId }),
		});

		if (!linkRes.ok) throw new Error("Failed to get subtitle download link");
		const { link } = (await linkRes.json()) as { link: string };

		const subtitleRes = await fetch(link);
		if (!subtitleRes.ok) throw new Error("Failed to download subtitle");
		const raw = await subtitleRes.text();

		const content = raw.trimStart().startsWith("WEBVTT") ? raw : srtToVtt(raw);
		return { content };
	});

export const beginPlaybackSession = createServerFn({ method: "POST" })
	.inputValidator(
		(input: {
			id: string;
			client?: {
				platform: "ios" | "android" | "android-tv" | "other";
				prefersSafeVideo: boolean;
				prefersTvMode: boolean;
			};
		}) => input,
	)
	.handler(async ({ data }) => {
		const { createPlaybackSession } = await import("@/lib/jellyfin");
		const { jellyfinStreamProxyUrl, setTranscodeQuality } = await import(
			"@/lib/jellyfin-stream-proxy"
		);
		const session = await createPlaybackSession(data.id, data.client);
		const proxiedStreamUrl = jellyfinStreamProxyUrl(session.streamUrl);
		return {
			...session,
			streamUrl:
				session.playMethod === "Transcode"
					? setTranscodeQuality(proxiedStreamUrl)
					: proxiedStreamUrl,
			subtitleTracks: session.subtitleTracks.map((track) => ({
				...track,
				url: jellyfinStreamProxyUrl(track.url),
			})),
		};
	});

export const reportPlaybackState = createServerFn({ method: "POST" })
	.inputValidator(
		(input: {
			id: string;
			positionTicks: number;
			playMethod?: "DirectPlay" | "Transcode";
			playSessionId?: string;
			mediaSourceId?: string;
			sessionId?: string;
			isPaused?: boolean;
			isStopped?: boolean;
			played?: boolean;
		}) => input,
	)
	.handler(async ({ data }) => {
		const { syncPlaybackState } = await import("@/lib/jellyfin");
		return syncPlaybackState({
			itemId: data.id,
			positionTicks: data.positionTicks,
			playMethod: data.playMethod,
			playSessionId: data.playSessionId,
			mediaSourceId: data.mediaSourceId,
			sessionId: data.sessionId,
			isPaused: data.isPaused,
			isStopped: data.isStopped,
			played: data.played,
		});
	});
