/**
 * A time of day ("20:30", or "8:30 PM" in English) in the app's language,
 * not the device's: a TV set to English still shows Dutch times in Dutch.
 */
export function formatClock(time: number | Date): string {
	const lang =
		typeof document === "undefined" ? undefined : document.documentElement.lang || undefined;
	return new Date(time).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
}
