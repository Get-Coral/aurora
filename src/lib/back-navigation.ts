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
