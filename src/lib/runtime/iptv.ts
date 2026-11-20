import type { IptvItemState } from "@/lib/iptv/mapping";
import type { IptvBrowseInput } from "@/lib/iptv/service";
import type { IptvSourceInput } from "@/lib/iptv/source";
import {
	beginIptvPlayback,
	deleteIptvSourceFn,
	fetchIptvBrowse,
	fetchIptvGuide,
	fetchIptvItemDetails,
	fetchIptvList,
	fetchIptvOverview,
	fetchIptvRelated,
	fetchIptvSeriesDetails,
	fetchIptvShelves,
	fetchIptvSources,
	fetchIptvStatus,
	type IptvPlayback,
	refreshIptvSourceFn,
	reportIptvPlayback,
	saveIptvSourceFn,
	searchIptvFn,
	setIptvFavorite,
	setIptvPlayed,
} from "@/server/functions/iptv";
import { callRuntime } from "./shared";

export type { IptvPlayback };

async function client() {
	const [backendModule, service] = await Promise.all([
		import("@/lib/client-iptv"),
		import("@/lib/iptv/service"),
	]);
	return { ...backendModule, service, backend: backendModule.clientIptvBackend() };
}

let statusCache: { at: number; value: Promise<{ enabled: boolean; sources: number }> } | null =
	null;

/** Whether any IPTV source is set up, cached briefly so merged lists stay cheap. */
export function iptvActive() {
	// On the server every request asks again; only the browser caches.
	if (typeof window === "undefined")
		return fetchIptvStatusRuntime()
			.then((status) => status.enabled && status.sources > 0)
			.catch(() => false);
	if (!statusCache || Date.now() - statusCache.at > 60_000) {
		statusCache = {
			at: Date.now(),
			value: fetchIptvStatusRuntime().catch(() => ({ enabled: false, sources: 0 })),
		};
	}
	return statusCache.value.then((status) => status.enabled && status.sources > 0);
}

export function forgetIptvStatus() {
	statusCache = null;
}

export async function fetchIptvStatusRuntime() {
	return callRuntime(
		async () => {
			const { hasClientIptvSources } = await import("@/lib/client-iptv");
			return { enabled: true, sources: hasClientIptvSources() ? 1 : 0 };
		},
		() => fetchIptvStatus(),
	);
}

export async function fetchIptvSourcesRuntime() {
	return callRuntime(
		async () => ({ enabled: true, sources: (await client()).listClientIptvSources() }),
		() => fetchIptvSources(),
	);
}

export async function saveIptvSourceRuntime(input: { id?: string; source: IptvSourceInput }) {
	return callRuntime(
		async () => {
			forgetIptvStatus();
			return (await client()).saveClientIptvSource(input.source, input.id);
		},
		() => {
			forgetIptvStatus();
			return saveIptvSourceFn({ data: input });
		},
	);
}

export async function deleteIptvSourceRuntime(id: string) {
	return callRuntime(
		async () => {
			forgetIptvStatus();
			return (await client()).deleteClientIptvSource(id);
		},
		() => {
			forgetIptvStatus();
			return deleteIptvSourceFn({ data: { id } });
		},
	);
}

export async function refreshIptvSourceRuntime(id: string) {
	return callRuntime(
		async () => (await client()).refreshClientIptvSource(id),
		() => refreshIptvSourceFn({ data: { id } }),
	);
}

export async function fetchIptvOverviewRuntime() {
	return callRuntime(
		async () => {
			const { service, backend } = await client();
			return service.iptvOverview(backend);
		},
		() => fetchIptvOverview(),
	);
}

export async function fetchIptvBrowseRuntime(input: IptvBrowseInput) {
	return callRuntime(
		async () => {
			const { service, backend } = await client();
			return service.browseIptv(backend, input);
		},
		() => fetchIptvBrowse({ data: input }),
	);
}

export async function fetchIptvShelvesRuntime() {
	return callRuntime(
		async () => {
			const { service, backend } = await client();
			return service.iptvShelves(backend);
		},
		() => fetchIptvShelves(),
	);
}

export async function fetchIptvItemDetailsRuntime(id: string) {
	return callRuntime(
		async () => {
			const { service, backend } = await client();
			return service.iptvItemPayload(backend, id);
		},
		() => fetchIptvItemDetails({ data: { id } }),
	);
}

export async function fetchIptvSeriesDetailsRuntime(id: string) {
	return callRuntime(
		async () => {
			const { service, backend } = await client();
			return service.iptvSeriesDetails(backend, id);
		},
		() => fetchIptvSeriesDetails({ data: { id } }),
	);
}

export async function fetchIptvRelatedRuntime(id: string) {
	return callRuntime(
		async () => {
			const { service, backend } = await client();
			return service.relatedIptv(backend, id);
		},
		() => fetchIptvRelated({ data: { id } }),
	);
}

export async function searchIptvRuntime(query: string) {
	return callRuntime(
		async () => {
			const { service, backend } = await client();
			return service.searchIptv(backend, query);
		},
		() => searchIptvFn({ data: { query } }),
	);
}

export async function fetchIptvGuideRuntime(ids: string[]) {
	return callRuntime(
		async () => {
			const { service, backend } = await client();
			return service.iptvGuide(backend, ids);
		},
		() => fetchIptvGuide({ data: { ids } }),
	);
}

export async function fetchIptvListRuntime(kind: "continue" | "favorites" | "history", limit = 40) {
	return callRuntime(
		async () => {
			const { service, backend } = await client();
			return service.iptvList(backend, kind, limit);
		},
		() => fetchIptvList({ data: { kind, limit } }),
	);
}

export async function beginIptvPlaybackRuntime(
	id: string,
	preferHls = false,
): Promise<IptvPlayback> {
	return callRuntime(
		async () => (await client()).beginClientIptvPlayback(id),
		() => beginIptvPlayback({ data: { id, preferHls } }),
	);
}

async function updateClientState(
	id: string,
	patch: (current: IptvItemState | undefined) => IptvItemState,
) {
	const { service, backend } = await client();
	const current = (await backend.state.get([id])).get(id);
	await backend.state.update(id, patch(current), await service.iptvSnapshot(backend, id));
	return { ok: true };
}

export async function reportIptvPlaybackRuntime(input: {
	id: string;
	positionTicks: number;
	durationTicks?: number;
	played?: boolean;
}) {
	return callRuntime(
		() =>
			updateClientState(input.id, (current) => {
				const duration = input.durationTicks || current?.durationTicks || 0;
				const played = input.played ?? (duration > 0 && input.positionTicks >= duration * 0.9);
				return {
					...current,
					positionTicks: played ? 0 : input.positionTicks,
					durationTicks: duration,
					played: played || current?.played,
					lastPlayedAt: Date.now(),
				};
			}),
		() => reportIptvPlayback({ data: input }),
	);
}

export async function setIptvFavoriteRuntime(id: string, favorite: boolean) {
	return callRuntime(
		() => updateClientState(id, (current) => ({ ...current, favorite })),
		() => setIptvFavorite({ data: { id, favorite } }),
	);
}

export async function setIptvPlayedRuntime(id: string, played: boolean) {
	return callRuntime(
		() =>
			updateClientState(id, (current) => ({
				...current,
				played,
				positionTicks: 0,
				lastPlayedAt: played ? Date.now() : current?.lastPlayedAt,
			})),
		() => setIptvPlayed({ data: { id, played } }),
	);
}

/** Jellyfin, IPTV, or both: whether Aurora has anything to show yet. */
export async function fetchSourcesRuntime() {
	const { fetchSetupStatusRuntime } = await import("./setup");
	const [setup, iptv] = await Promise.all([
		fetchSetupStatusRuntime(),
		fetchIptvStatusRuntime().catch(() => ({ enabled: false, sources: 0 })),
	]);
	return {
		jellyfin: setup.configured,
		iptv: iptv.enabled && iptv.sources > 0,
		iptvEnabled: iptv.enabled,
	};
}
