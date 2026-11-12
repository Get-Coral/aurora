/**
 * D-pad navigation for TV mode: the arrow keys move focus to the nearest
 * control in that direction, the way a remote expects.
 *
 * - Every native control takes part (buttons, links, fields, anything with a
 *   tabindex), so new screens work without marking each element. An element
 *   that should be skipped gets `data-tv-skip`.
 * - Only the top-most open layer is navigable: a dialog (`aria-modal="true"`)
 *   or `[data-tv-scope]`. Focus can't wander to the page behind it.
 * - When a layer opens, focus moves into it (`data-tv-autofocus` wins); when
 *   it closes, focus returns to where it was before.
 * - A layer with `data-tv-arrows="manual"` (the player) handles the arrow
 *   keys itself; it can call `moveTvFocus` for its own controls.
 */

export type TvDirection = "left" | "right" | "up" | "down";

const FOCUSABLE_SELECTOR = [
	"button",
	"a[href]",
	'input:not([type="hidden"])',
	"select",
	"textarea",
	'[tabindex]:not([tabindex="-1"])',
	'[data-tv-focusable="true"]',
].join(",");

const SCOPE_SELECTOR = '[aria-modal="true"], [data-tv-scope]';
const AUTOFOCUS_SELECTOR = "[data-tv-autofocus]";

function isTvModeActive() {
	return document.documentElement.classList.contains("tv-mode");
}

function isEditableElement(element: Element | null) {
	if (!(element instanceof HTMLElement)) return false;

	const tagName = element.tagName.toLowerCase();
	return (
		tagName === "input" ||
		tagName === "textarea" ||
		tagName === "select" ||
		element.isContentEditable
	);
}

function isVisibleElement(element: HTMLElement) {
	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return false;
	const style = window.getComputedStyle(element);
	return style.visibility !== "hidden" && style.display !== "none";
}

function isNavigable(element: HTMLElement) {
	if (element.matches(":disabled")) return false;
	if (element.closest('[inert], [aria-hidden="true"], [data-tv-skip]')) return false;
	return isVisibleElement(element);
}

/** The layer that owns the remote: the last open dialog, or the page. */
export function getActiveTvScope(): HTMLElement | null {
	const scopes = Array.from(document.querySelectorAll<HTMLElement>(SCOPE_SELECTOR)).filter(
		(scope) => !scope.closest("[inert]") && isVisibleElement(scope),
	);
	return scopes.at(-1) ?? null;
}

export function getTvFocusCandidates(scope: ParentNode = document): HTMLElement[] {
	return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isNavigable);
}

/**
 * Lower is better; null when the candidate isn't in that direction at all.
 *
 * Candidates that line up with the current element (overlap on the other
 * axis) always beat ones that don't, so Right moves along a row of cards
 * instead of jumping to a nearer card in the row below. Among those, the edge
 * gap counts most and the off-axis distance breaks ties.
 */
export function getDirectionalScore(
	currentRect: DOMRect,
	candidateRect: DOMRect,
	direction: TvDirection,
): number | null {
	const currentCenterX = currentRect.left + currentRect.width / 2;
	const currentCenterY = currentRect.top + currentRect.height / 2;
	const candidateCenterX = candidateRect.left + candidateRect.width / 2;
	const candidateCenterY = candidateRect.top + candidateRect.height / 2;
	const deltaX = candidateCenterX - currentCenterX;
	const deltaY = candidateCenterY - currentCenterY;

	if (direction === "right" && deltaX <= 8) return null;
	if (direction === "left" && deltaX >= -8) return null;
	if (direction === "down" && deltaY <= 8) return null;
	if (direction === "up" && deltaY >= -8) return null;

	const horizontal = direction === "left" || direction === "right";
	const gap =
		direction === "right"
			? candidateRect.left - currentRect.right
			: direction === "left"
				? currentRect.left - candidateRect.right
				: direction === "down"
					? candidateRect.top - currentRect.bottom
					: currentRect.top - candidateRect.bottom;
	const overlap = horizontal
		? Math.min(currentRect.bottom, candidateRect.bottom) -
			Math.max(currentRect.top, candidateRect.top)
		: Math.min(currentRect.right, candidateRect.right) -
			Math.max(currentRect.left, candidateRect.left);
	const offAxis = horizontal ? Math.abs(deltaY) : Math.abs(deltaX);

	return (overlap > 0 ? 0 : 1_000_000) + Math.max(0, gap) * 10 + offAxis;
}

function focusElement(element: HTMLElement) {
	element.focus({ preventScroll: true });
	// "nearest" keeps the page still when the element is already on screen and
	// also scrolls horizontal rows; scroll-padding keeps it clear of the header.
	element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

function getInitialTarget(scope: HTMLElement | null) {
	const root: ParentNode = scope ?? document;
	const preferred = Array.from(root.querySelectorAll<HTMLElement>(AUTOFOCUS_SELECTOR)).find(
		isNavigable,
	);
	if (preferred) return preferred;

	return getTvFocusCandidates(root)
		.map((element) => ({ element, rect: element.getBoundingClientRect() }))
		.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]?.element;
}

/** Puts focus on the layer's preferred control. Returns whether it did. */
export function focusTvScope(scope: HTMLElement | null = getActiveTvScope()) {
	const target = getInitialTarget(scope);
	if (!target) return false;
	focusElement(target);
	return true;
}

/**
 * Moves focus one step in `direction` within `scope` (default: the active
 * layer). Returns whether focus moved, so callers know if the key was used.
 */
export function moveTvFocus(
	direction: TvDirection,
	scope: HTMLElement | null = getActiveTvScope(),
) {
	const root: ParentNode = scope ?? document;
	const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const candidates = getTvFocusCandidates(root);
	if (!candidates.length) return false;

	if (!active || active === document.body || !candidates.includes(active)) {
		return focusTvScope(scope);
	}

	const currentRect = active.getBoundingClientRect();
	let best: HTMLElement | null = null;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		if (candidate === active) continue;
		const score = getDirectionalScore(currentRect, candidate.getBoundingClientRect(), direction);
		if (score != null && score < bestScore) {
			bestScore = score;
			best = candidate;
		}
	}

	if (!best) return false;
	focusElement(best);
	return true;
}

function directionForKey(key: string): TvDirection | null {
	switch (key) {
		case "ArrowLeft":
			return "left";
		case "ArrowRight":
			return "right";
		case "ArrowUp":
			return "up";
		case "ArrowDown":
			return "down";
		default:
			return null;
	}
}

export function installTvSpatialNavigation() {
	function handleKeyDown(event: KeyboardEvent) {
		if (event.defaultPrevented || !isTvModeActive()) return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

		const direction = directionForKey(event.key);
		if (!direction) return;

		// Left/Right move the caret in a text field; Up/Down leave it, since a
		// remote has no other way out.
		if (
			isEditableElement(event.target as Element | null) &&
			(direction === "left" || direction === "right")
		) {
			return;
		}

		const scope = getActiveTvScope();
		if (scope?.dataset.tvArrows === "manual") return;

		if (moveTvFocus(direction, scope)) event.preventDefault();
	}

	// Focus follows the layers: into a dialog when it opens, back to where it
	// came from when it closes.
	let currentScope: HTMLElement | null = getActiveTvScope();
	const returnFocus = new WeakMap<HTMLElement, HTMLElement>();
	let frame = 0;

	function syncScope() {
		frame = 0;
		const nextScope = getActiveTvScope();
		if (nextScope === currentScope) return;
		const previousScope = currentScope;
		currentScope = nextScope;
		if (!isTvModeActive()) return;

		const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const previousClosed = previousScope != null && !previousScope.isConnected;

		if (nextScope && !nextScope.contains(active)) {
			if (previousClosed) {
				// One layer replaced another (details → player): go back to
				// where the first one was opened from.
				const origin = returnFocus.get(previousScope);
				if (origin) returnFocus.set(nextScope, origin);
			} else if (active && active !== document.body) {
				returnFocus.set(nextScope, active);
			}
			// A newly opened layer gets focus; one that was underneath gets
			// its origin back if that lives inside it.
			const origin = previousClosed ? returnFocus.get(previousScope) : undefined;
			if (origin?.isConnected && nextScope.contains(origin)) focusElement(origin);
			else focusTvScope(nextScope);
			return;
		}

		if (!nextScope && previousScope) {
			const origin = returnFocus.get(previousScope);
			if (origin?.isConnected && isNavigable(origin)) focusElement(origin);
			else if (!active || active === document.body || !active.isConnected) focusTvScope(null);
		}
	}

	const observer = new MutationObserver(() => {
		// Wait a frame so the new layer has laid out and its controls are
		// visible to the candidate filter.
		if (!frame) frame = requestAnimationFrame(syncScope);
	});
	observer.observe(document.body, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["aria-modal", "data-tv-scope", "inert"],
	});

	window.addEventListener("keydown", handleKeyDown);

	return () => {
		observer.disconnect();
		if (frame) cancelAnimationFrame(frame);
		window.removeEventListener("keydown", handleKeyDown);
	};
}
