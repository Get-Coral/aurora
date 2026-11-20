export function httpUrl(value: string, base?: URL): URL {
	const url = new URL(value, base);
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
		throw new Error("Invalid IPTV URL");
	}
	url.hash = "";
	return url;
}

export function m3uPlaylist(value: string) {
	const url = httpUrl(value);
	if (
		url.pathname.endsWith("/get.php") &&
		url.searchParams.has("username") &&
		url.searchParams.has("password") &&
		/^(?:ts|mpegts|hls|m3u8),$/.test(url.searchParams.get("output") ?? "")
	) {
		const output = url.searchParams.get("output") ?? "";
		url.searchParams.set("output", output.slice(0, -1));
	}
	return url;
}

export function xtreamPlaylist(server: string, username: string, password: string) {
	const url = httpUrl(server);
	if (!username.trim() || !password || url.search) throw new Error("Invalid Xtream source");
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/get.php`;
	url.search = new URLSearchParams({
		username,
		password,
		type: "m3u_plus",
		output: "ts",
	}).toString();
	return url;
}

export function parseIptvPlaylist(text: string, base: URL) {
	if (!/^#EXTM3U\b/.test(text.trimStart()) || /^#EXT-X-/m.test(text)) {
		throw new Error("Expected a channel playlist");
	}
	const entries = [];
	let metadata = "";
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("#EXTINF:")) metadata = line.slice(8);
		if (!line || line.startsWith("#") || !metadata) continue;
		const parts = metadata.match(/^(?:[^",]|"[^"]*")*,(.*)$/);
		const group = metadata.match(/\bgroup-title="([^"]*)"/i)?.[1] ?? "";
		const title = parts?.[1]?.trim();
		metadata = "";
		if (!title) continue;
		try {
			const url = httpUrl(line, base);
			const vod = /\/(movie|series)\/|\.(mp4|mkv|webm|mov)$/i.test(url.pathname);
			const format = /\.m3u8$/i.test(url.pathname)
				? "hls"
				: /\.ts$/i.test(url.pathname) || (!vod && !/\.[^/]+$/.test(url.pathname))
					? "ts"
					: "file";
			entries.push({ title, group, vod, format, url });
		} catch {
			// Ignore unsupported playlist entries.
		}
	}
	return entries;
}

export interface IptvEntry {
	title: string;
	group: string;
	vod: boolean;
	format: string;
	src: string;
}
