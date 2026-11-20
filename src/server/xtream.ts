import { publicIptvArtwork } from "../lib/iptv";

type CatalogRequest = (url: URL) => Promise<unknown>;
type XtreamItem = Record<string, unknown>;

function rows(value: unknown): XtreamItem[] {
	if (!Array.isArray(value)) throw new Error("Invalid Xtream catalog");
	return value.filter((item): item is XtreamItem => item !== null && typeof item === "object");
}

export async function loadXtreamCatalog(playlist: URL, request: CatalogRequest) {
	const username = playlist.searchParams.get("username");
	const password = playlist.searchParams.get("password");
	if (!playlist.pathname.endsWith("/get.php") || !username || !password) return null;

	const api = new URL("player_api.php", playlist);
	api.search = new URLSearchParams({ username, password }).toString();
	function get(action: string) {
		const endpoint = new URL(api);
		endpoint.searchParams.set("action", action);
		return request(endpoint);
	}

	const account = (await request(api)) as {
		user_info?: { auth?: number | string; allowed_output_formats?: string[] };
	};
	if (String(account?.user_info?.auth) !== "1") throw new Error("Xtream sign-in failed");
	const formats = account.user_info?.allowed_output_formats;
	const output = playlist.searchParams.get("output");
	const liveExtension =
		output === "m3u8" ||
		output === "hls" ||
		(Array.isArray(formats) && !formats.includes("ts") && formats.includes("m3u8"))
			? "m3u8"
			: "ts";
	const [live, liveGroups, movies, movieGroups] = await Promise.all([
		get("get_live_streams").then(rows),
		get("get_live_categories")
			.then(rows)
			.catch(() => []),
		get("get_vod_streams")
			.then(rows)
			.catch(() => []),
		get("get_vod_categories")
			.then(rows)
			.catch(() => []),
	]);
	const credentials = [username, password].map(encodeURIComponent).join("/");
	function entries(items: XtreamItem[], categories: XtreamItem[], vod: boolean) {
		const groups = new Map(
			categories.map((category) => [
				String(category.category_id),
				typeof category.category_name === "string" ? category.category_name : "",
			]),
		);
		return items.flatMap((item) => {
			const id = String(item.stream_id);
			if (!/^\d+$/.test(id) || typeof item.name !== "string" || !item.name.trim()) return [];
			const extension = vod ? String(item.container_extension ?? "mp4") : liveExtension;
			if (!/^[a-z0-9]+$/i.test(extension)) return [];
			return [
				{
					title: item.name.trim(),
					artwork: publicIptvArtwork(item.stream_icon),
					group: groups.get(String(item.category_id)) ?? "",
					vod,
					format: extension === "m3u8" ? "hls" : extension === "ts" ? "ts" : "file",
					url: new URL(`${vod ? "movie" : "live"}/${credentials}/${id}.${extension}`, api),
				},
			];
		});
	}
	return [...entries(live, liveGroups, false), ...entries(movies, movieGroups, true)];
}
