import type { MediaItem, MediaProgramme } from "./media";

type Translate = (key: string, params?: Record<string, string | number | undefined>) => string;

function clock(time: number) {
	return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "Now", "21:30" or "Tomorrow 08:00" for a programme. */
export function airingLabel(t: Translate, programme: MediaProgramme, now = Date.now()) {
	if (programme.start <= now && programme.end > now) return t("search.airingNow");
	const start = new Date(programme.start);
	const today = new Date(now);
	const tomorrow = new Date(now + 24 * 3600_000);
	if (start.toDateString() === today.toDateString()) return clock(programme.start);
	if (start.toDateString() === tomorrow.toDateString())
		return t("search.airingTomorrow", { time: clock(programme.start) });
	return `${start.toLocaleDateString([], { weekday: "short", day: "numeric" })} ${clock(programme.start)}`;
}

export function mediaTypeLabel(t: Translate, item: MediaItem) {
	switch (item.type) {
		case "series":
			return t("search.series");
		case "channel":
			return t("search.channel");
		case "episode":
			return t("search.episode");
		case "collection":
			return t("search.collection");
		default:
			return t("search.movie");
	}
}

/** One line under a result: what it is, where it comes from, when. */
export function searchSubtitle(t: Translate, item: MediaItem) {
	if (item.airing) return [airingLabel(t, item.airing), item.title].join(" · ");
	const parts: (string | number | undefined)[] = [mediaTypeLabel(t, item)];
	if (item.type === "episode") {
		parts.push(item.seriesTitle);
		if (item.seasonNumber != null && item.episodeNumber != null)
			parts.push(`S${item.seasonNumber} · E${item.episodeNumber}`);
	} else if (item.type === "channel") {
		parts.push(item.epg?.now ? t("card.onNow", { title: item.epg.now.title }) : item.group);
	} else {
		parts.push(item.year);
	}
	if (item.source === "iptv" && item.type !== "channel") parts.push("IPTV");
	return parts.filter((part) => part != null && part !== "").join(" · ");
}
