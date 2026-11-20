import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

export const fetchIptvHome = createServerFn({ method: "GET" }).handler(async () => {
	const { getIptvHome, IPTV_SOURCE_COOKIE } = await import("../../lib/iptv-source-store");
	return getIptvHome(getCookie(IPTV_SOURCE_COOKIE));
});
