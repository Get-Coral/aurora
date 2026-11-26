import { createServerFn } from "@tanstack/react-start";
import type { IptvBrowseInput } from "../../lib/iptv/service";
import type { IptvSourceInput } from "../../lib/iptv/source";
import { adminRequiredMiddleware, authRequiredMiddleware } from "../auth-middleware";

async function backend() {
	const { serverIptvBackend } = await import("../iptv/backend");
	return serverIptvBackend();
}

async function service() {
	return import("../../lib/iptv/service");
}

export interface IptvPlayback {
	streamUrl: string;
	fallbackUrl?: string;
	format: "hls" | "ts" | "file";
	live: boolean;
	/** Converted by Aurora's ffmpeg: seeking reloads the stream with `start`. */
	transcoded: boolean;
	durationSeconds?: number;
	/** Audio and text subtitle streams inside the file, when Aurora can convert it. */
	media?: {
		audio: IptvMediaTrack[];
		subtitles: IptvMediaTrack[];
	};
}

export interface IptvMediaTrack {
	id: number;
	language?: string;
	title?: string;
	codec?: string;
}

/** Whether IPTV is available on this server and has any sources. */
export const fetchIptvStatus = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.handler(async () => {
		const [{ iptvEnabled }, { listIptvSourceIds }] = await Promise.all([
			import("../iptv/network"),
			import("../../lib/iptv-source-store"),
		]);
		const enabled = iptvEnabled();
		return { enabled, sources: enabled ? listIptvSourceIds().length : 0 };
	});

function sourceError(error: unknown) {
	const code =
		error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
	const status =
		error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
	if (code === "origin") return new Error("iptv.blockedOrigin");
	if (code === "provider") return new Error(`iptv.providerError:${status ?? ""}`);
	if (error instanceof Error && /sign-in/i.test(error.message))
		return new Error("iptv.signInFailed");
	if (error instanceof Error && /Invalid|Expected/i.test(error.message))
		return new Error("iptv.invalidSource");
	return new Error("iptv.loadError");
}

export const fetchIptvSources = createServerFn({ method: "GET" })
	.middleware([adminRequiredMiddleware])
	.handler(async () => {
		const [store, { getCookie, deleteCookie }, { iptvEnabled }, { cachedCatalog }] =
			await Promise.all([
				import("../../lib/iptv-source-store"),
				import("@tanstack/react-start/server"),
				import("../iptv/network"),
				import("../iptv/backend"),
			]);
		const legacy = getCookie(store.LEGACY_IPTV_SOURCE_COOKIE);
		if (legacy) {
			try {
				store.migrateLegacyIptvSource(legacy);
			} catch {
				// A source that no longer decrypts is dropped.
			}
			deleteCookie(store.LEGACY_IPTV_SOURCE_COOKIE, { path: "/" });
		}
		return {
			enabled: iptvEnabled(),
			sources: store.listIptvSources().map((source) => {
				const catalog = cachedCatalog(source.id);
				return {
					...source,
					loadedAt: catalog?.loadedAt,
					account: catalog?.account,
					counts: catalog
						? {
								live: catalog.channels.length,
								movies: catalog.movies.length,
								series: catalog.series.length,
							}
						: undefined,
				};
			}),
		};
	});

export const saveIptvSourceFn = createServerFn({ method: "POST" })
	.middleware([adminRequiredMiddleware])
	.validator((input: { id?: string; source: IptvSourceInput }) => input)
	.handler(async ({ data }) => {
		const [store, { normalizeSourceInput, loadSourceCatalog }, network, cache] = await Promise.all([
			import("../../lib/iptv-source-store"),
			import("../../lib/iptv/source"),
			import("../iptv/network"),
			import("../iptv/backend"),
		]);
		if (!network.iptvEnabled()) throw new Error("iptv.disabled");
		const existing = data.id ? store.getIptvSource(data.id) : null;
		let normalized: ReturnType<typeof normalizeSourceInput>;
		try {
			normalized = normalizeSourceInput({
				...data.source,
				password:
					data.source.password ||
					(existing?.config.kind === "xtream" ? existing.config.xtream.password : undefined),
			});
		} catch (error) {
			throw sourceError(error);
		}
		// Check the source before saving it, so mistakes show up in the form.
		let counts: { live: number; movies: number; series: number };
		try {
			const catalog = await loadSourceCatalog(
				"check",
				normalized.config,
				network.providerFetchers(AbortSignal.timeout(180_000)),
				normalized.name,
			);
			counts = {
				live: catalog.channels.length,
				movies: catalog.movies.length,
				series: catalog.series.length,
			};
		} catch (error) {
			throw sourceError(error);
		}
		if (!counts.live && !counts.movies && !counts.series) throw new Error("iptv.empty");
		const id = store.saveIptvSource(data.source, data.id);
		cache.forgetIptvCatalog(id);
		void cache.loadServerCatalog(id).catch(() => undefined);
		return { id, ...counts };
	});

export const deleteIptvSourceFn = createServerFn({ method: "POST" })
	.middleware([adminRequiredMiddleware])
	.validator((input: { id: string }) => input)
	.handler(async ({ data }) => {
		const [store, cache] = await Promise.all([
			import("../../lib/iptv-source-store"),
			import("../iptv/backend"),
		]);
		store.deleteIptvSource(data.id);
		cache.forgetIptvCatalog(data.id);
		return { ok: true };
	});

export const refreshIptvSourceFn = createServerFn({ method: "POST" })
	.middleware([adminRequiredMiddleware])
	.validator((input: { id: string }) => input)
	.handler(async ({ data }) => {
		const cache = await import("../iptv/backend");
		try {
			const catalog = await cache.loadServerCatalog(data.id, true);
			return {
				live: catalog.channels.length,
				movies: catalog.movies.length,
				series: catalog.series.length,
				loadedAt: catalog.loadedAt,
				account: catalog.account,
			};
		} catch (error) {
			throw sourceError(error);
		}
	});

export const fetchIptvOverview = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.handler(async () => (await service()).iptvOverview(await backend()));

export const fetchIptvBrowse = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.validator((input: IptvBrowseInput) => input)
	.handler(async ({ data }) => (await service()).browseIptv(await backend(), data));

export const fetchIptvGuideRows = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.validator((input: Omit<IptvBrowseInput, "kind"> & { from: number; to: number }) => input)
	.handler(async ({ data }) => (await service()).iptvGuideRows(await backend(), data));

export const fetchIptvBrowseRows = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.validator((input: { kind: "vod" | "series"; locale?: string }) => input)
	.handler(async ({ data }) => (await service()).iptvBrowseRows(await backend(), data));

export const fetchIptvShelves = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.handler(async () => (await service()).iptvShelves(await backend()));

export const fetchIptvItemDetails = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.validator((input: { id: string }) => input)
	.handler(async ({ data }) => (await service()).iptvItemPayload(await backend(), data.id));

export const fetchIptvSeriesDetails = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.validator((input: { id: string }) => input)
	.handler(async ({ data }) => (await service()).iptvSeriesDetails(await backend(), data.id));

export const fetchIptvRelated = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.validator((input: { id: string }) => input)
	.handler(async ({ data }) => (await service()).relatedIptv(await backend(), data.id));

export const searchIptvFn = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.validator((input: { query: string }) => input)
	.handler(async ({ data }) => (await service()).searchIptv(await backend(), data.query));

export const fetchIptvGuide = createServerFn({ method: "POST" })
	.middleware([authRequiredMiddleware])
	.validator((input: { ids: string[] }) => input)
	.handler(async ({ data }) => (await service()).iptvGuide(await backend(), data.ids));

export const fetchIptvList = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.validator((input: { kind: "continue" | "favorites" | "history"; limit?: number }) => input)
	.handler(async ({ data }) =>
		(await service()).iptvList(await backend(), data.kind, Math.min(data.limit ?? 40, 200)),
	);

export const fetchIptvNextUp = createServerFn({ method: "GET" })
	.middleware([authRequiredMiddleware])
	.handler(async () => (await service()).iptvNextUp(await backend()));

export const beginIptvPlayback = createServerFn({ method: "POST" })
	.middleware([authRequiredMiddleware])
	.validator((input: { id: string; preferHls?: boolean; dolbyAudio?: boolean }) => input)
	.handler(async ({ data }): Promise<IptvPlayback> => {
		const [{ parseIptvId }, { resolveStream }, cache] = await Promise.all([
			import("../../lib/iptv/ids"),
			import("../../lib/iptv/streams"),
			import("../iptv/backend"),
		]);
		const parts = parseIptvId(data.id);
		if (!parts) throw new Error("Not an IPTV item");
		const catalog = await cache.loadServerCatalog(parts.source);
		const target = await resolveStream(catalog, parts, {
			preferHls: data.preferHls,
			seriesInfo: (pid) => cache.serverSeriesInfo(catalog, pid),
		});
		let durationSeconds = target.durationSeconds;
		if (parts.kind === "vod" && !durationSeconds) {
			const info = await (await backend()).vodInfo(catalog, parts.pid).catch(() => undefined);
			durationSeconds = info?.durationSeconds;
		}
		const ffmpeg = process.env.AURORA_IPTV_FFMPEG;
		const [{ needsConversion, finalUrl }, probe] = await Promise.all([
			import("../iptv"),
			import("../iptv-probe"),
		]);
		// Look inside files Aurora can convert, for audio tracks and subtitles.
		let media: IptvPlayback["media"];
		let audioNeedsConversion = false;
		if (ffmpeg && !target.live && target.format === "file") {
			try {
				const url = await finalUrl(AbortSignal.timeout(20_000), target.url, false);
				const probed = await probe.probeIptvMedia(data.id, url, ffmpeg);
				// Dolby, DTS and the like play without sound in most browsers:
				// convert the audio to AAC (the video is copied when it can be).
				audioNeedsConversion = !probe.browserCanPlayAudio(probed.audio[0]?.codec, {
					dolby: data.dolbyAudio === true,
				});
				media = {
					audio: probed.audio.map((track) => ({
						id: track.index,
						language: track.language,
						title: track.title,
						codec: track.codec,
					})),
					subtitles: probed.subtitles.map((track) => ({
						id: track.index,
						language: track.language,
						title: track.title,
						codec: track.codec,
					})),
				};
			} catch {
				// Without a probe the file still plays; it just offers no choices.
			}
		}
		const convertsContainer = Boolean(ffmpeg) && needsConversion(target.url);
		const base = `/api/iptv?id=${encodeURIComponent(data.id)}${data.preferHls ? "&prefer=hls" : ""}${
			audioNeedsConversion && !convertsContainer ? "&remux=1" : ""
		}`;
		return {
			streamUrl: base,
			fallbackUrl: target.fallback ? `${base}&fallback=1` : undefined,
			format: target.format,
			live: target.live,
			transcoded: convertsContainer || audioNeedsConversion,
			durationSeconds,
			media,
		};
	});

async function updateState(
	id: string,
	patch: (
		current: import("../../lib/iptv/mapping").IptvItemState | undefined,
	) => import("../../lib/iptv/mapping").IptvItemState,
) {
	const [{ iptvSnapshot }, instance] = await Promise.all([service(), backend()]);
	const current = (await instance.state.get([id])).get(id);
	const snapshot = await iptvSnapshot(instance, id);
	await instance.state.update(id, patch(current), snapshot);
}

export const reportIptvPlayback = createServerFn({ method: "POST" })
	.middleware([authRequiredMiddleware])
	.validator(
		(input: { id: string; positionTicks: number; durationTicks?: number; played?: boolean }) =>
			input,
	)
	.handler(async ({ data }) => {
		const { PLAYED_THRESHOLD } = await import("../../lib/iptv-user-store");
		await updateState(data.id, (current) => {
			const duration = data.durationTicks || current?.durationTicks || 0;
			const played =
				data.played ?? (duration > 0 && data.positionTicks >= duration * PLAYED_THRESHOLD);
			return {
				...current,
				positionTicks: played ? 0 : data.positionTicks,
				durationTicks: duration,
				played: played || current?.played,
				lastPlayedAt: Date.now(),
			};
		});
		return { ok: true };
	});

export const setIptvFavorite = createServerFn({ method: "POST" })
	.middleware([authRequiredMiddleware])
	.validator((input: { id: string; favorite: boolean }) => input)
	.handler(async ({ data }) => {
		await updateState(data.id, (current) => ({ ...current, favorite: data.favorite }));
		return { ok: true };
	});

export const setIptvPlayed = createServerFn({ method: "POST" })
	.middleware([authRequiredMiddleware])
	.validator((input: { id: string; played: boolean }) => input)
	.handler(async ({ data }) => {
		await updateState(data.id, (current) => ({
			...current,
			played: data.played,
			positionTicks: 0,
			lastPlayedAt: data.played ? Date.now() : current?.lastPlayedAt,
		}));
		return { ok: true };
	});

/** Categories of a source with their size, plus what is hidden. */
export const fetchIptvSourceGroups = createServerFn({ method: "GET" })
	.middleware([adminRequiredMiddleware])
	.validator((input: { id: string }) => input)
	.handler(async ({ data }) => {
		const [{ catalogGroups }, cache, store] = await Promise.all([
			import("../../lib/iptv/catalog"),
			import("../iptv/backend"),
			import("../../lib/iptv-source-store"),
		]);
		const catalog = await cache.loadServerCatalog(data.id);
		return { groups: catalogGroups(catalog), options: store.getIptvSourceOptions(data.id) };
	});

export const saveIptvSourceOptionsFn = createServerFn({ method: "POST" })
	.middleware([adminRequiredMiddleware])
	.validator(
		(input: { id: string; options: import("../../lib/iptv/source").IptvSourceOptions }) => input,
	)
	.handler(async ({ data }) => {
		const store = await import("../../lib/iptv-source-store");
		if (!store.getIptvSource(data.id)) throw new Error("Unknown IPTV source");
		store.setIptvSourceOptions(data.id, data.options);
		return { ok: true };
	});
