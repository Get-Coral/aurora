/**
 * Fired on window before the Android back button does anything else. A
 * listener that handles the press itself (closing a picker inside an overlay)
 * calls preventDefault() to stop the default: closing the top overlay, then
 * going back in history.
 */
export const AURORA_BACK_EVENT = "aurora:back";

/** Returns true when a listener has handled the back press. */
export function dispatchAuroraBack(): boolean {
	const event = new Event(AURORA_BACK_EVENT, { cancelable: true });
	return !window.dispatchEvent(event);
}

/**
 * The close button of the top-most open overlay. Overlays mark theirs with
 * `data-aurora-overlay-close`; the last visible one in the document is the
 * one on top, so a dialog opened over another closes first.
 */
export function findTopOverlayClose(): HTMLElement | null {
	const candidates = Array.from(
		document.querySelectorAll<HTMLElement>("[data-aurora-overlay-close]"),
	).filter((element) => element.getClientRects().length > 0);
	return candidates.at(-1) ?? null;
}

/**
 * On the home screen in TV mode, Back first returns to the top: scroll up and
 * put focus on the menu. Only a Back from there leaves (or exits) the app, so
 * a press deep in a row never closes Aurora by surprise. Returns whether it
 * handled the press.
 */
export function returnToTopOfHome(): boolean {
	if (!document.documentElement.classList.contains("tv-mode")) return false;
	if (window.location.pathname !== "/") return false;

	const header = document.querySelector<HTMLElement>(".app-header");
	const active = document.activeElement;
	const focusInHeader = header != null && active instanceof Element && header.contains(active);
	if (focusInHeader && window.scrollY < 8) return false;

	window.scrollTo({ top: 0, behavior: "smooth" });
	const target =
		header?.querySelector<HTMLElement>(".nav-pill-active") ??
		header?.querySelector<HTMLElement>("a[href], button");
	target?.focus({ preventScroll: true });
	return true;
}
