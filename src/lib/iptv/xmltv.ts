import { type EpgProgramme, tidyGuide } from "./catalog";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(value: string) {
	return value
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
			if (entity[0] !== "#") return ENTITIES[entity.toLowerCase()] ?? match;
			const code =
				entity[1]?.toLowerCase() === "x"
					? Number.parseInt(entity.slice(2), 16)
					: Number.parseInt(entity.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : match;
		})
		.trim();
}

/** `20261120224500 +0100` → epoch milliseconds. */
export function parseXmltvTime(value: string) {
	const match = value
		.trim()
		.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2}))?/);
	if (!match) return undefined;
	const [, year, month, day, hour, minute, second = "00", sign, offsetHours, offsetMinutes] = match;
	const utc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
	const offset = sign
		? (sign === "-" ? -1 : 1) * (+(offsetHours ?? 0) * 60 + +(offsetMinutes ?? 0))
		: 0;
	return utc - offset * 60_000;
}

function attribute(tag: string, name: string) {
	return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function element(block: string, name: string) {
	const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
	return match?.[1] ? decodeXml(match[1]) : undefined;
}

/**
 * Streaming XMLTV reader that keeps only the wanted channels and the
 * programmes overlapping `[now - pastMs, now + windowMs]`. Guides run to hundreds of
 * megabytes, so the document is never held in memory as a whole.
 */
export function createXmltvReader(
	channels: Set<string>,
	now: number,
	windowMs = 24 * 3600_000,
	/** Earlier programmes to keep, for catch-up. */
	pastMs = 24 * 3600_000,
) {
	const guide = new Map<string, EpgProgramme[]>();
	let buffer = "";
	const until = now + windowMs;
	const from = now - pastMs;

	function take(block: string) {
		const open = block.slice(0, block.indexOf(">") + 1);
		const channel = attribute(open, "channel");
		if (!channel || !channels.has(channel)) return;
		const start = parseXmltvTime(attribute(open, "start") ?? "");
		const end = parseXmltvTime(attribute(open, "stop") ?? "");
		if (!start || !end || end <= from || start >= until || end <= start) return;
		const title = element(block, "title");
		if (!title) return;
		const list = guide.get(channel) ?? [];
		// Merged guides list shows twice, a few minutes apart: skip overlaps.
		if (
			list.length >= 96 ||
			list.some((programme) => start < programme.end && end > programme.start)
		)
			return;
		list.push({ title, start, end, description: element(block, "desc")?.slice(0, 320) });
		guide.set(channel, list);
	}

	return {
		push(chunk: string) {
			buffer += chunk;
			let cursor = 0;
			while (true) {
				const start = buffer.indexOf("<programme", cursor);
				if (start < 0) {
					cursor = Math.max(cursor, buffer.length - 16);
					break;
				}
				const end = buffer.indexOf("</programme>", start);
				if (end < 0) {
					cursor = start;
					break;
				}
				take(buffer.slice(start, end));
				cursor = end + 12;
			}
			buffer = buffer.slice(cursor);
		},
		finish() {
			for (const [channel, list] of guide) guide.set(channel, tidyGuide(list));
			return guide;
		},
	};
}
