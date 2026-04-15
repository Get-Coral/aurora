import type { ImageType } from "@get-coral/jellyfin";

function normalizeDimension(value: number, fallback: number) {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(1, Math.min(4096, Math.round(value)));
}

function normalizeQuality(value: number) {
	if (!Number.isFinite(value)) return undefined;
	return Math.max(1, Math.min(100, Math.round(value)));
}

export function jellyfinImageProxyUrl(
	itemId: string,
	type: ImageType = "Primary",
	width = 400,
	options?: {
		fillWidth?: number;
		quality?: number;
		tag?: string;
	},
): string {
	const params = new URLSearchParams({
		itemId,
		type,
		width: String(normalizeDimension(width, 400)),
	});

	if (options?.fillWidth != null) {
		params.set("fillWidth", String(normalizeDimension(options.fillWidth, 300)));
	}

	if (options?.quality != null) {
		const quality = normalizeQuality(options.quality);
		if (quality != null) {
			params.set("quality", String(quality));
		}
	}

	if (options?.tag) {
		const tag = options.tag.trim();
		if (tag) {
			params.set("tag", tag);
		}
	}

	return `/api/jellyfin-image?${params.toString()}`;
}
