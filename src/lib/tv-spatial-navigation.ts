const TV_FOCUS_SELECTOR = '[data-tv-focusable="true"]';

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
	const style = window.getComputedStyle(element);
	return (
		rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
	);
}

function getFocusableCandidates() {
	return Array.from(document.querySelectorAll<HTMLElement>(TV_FOCUS_SELECTOR))
		.filter((element) => !element.hasAttribute("disabled"))
		.filter(isVisibleElement);
}

type Direction = "left" | "right" | "up" | "down";

function overlap(startA: number, endA: number, startB: number, endB: number) {
	return Math.min(endA, endB) - Math.max(startA, startB);
}

/**
 * Lower is better; null means the candidate isn't in that direction.
 * Distances run edge to edge, so a wide guide programme or a tall card is
 * judged by where it begins, not by its middle. Candidates that share the row
 * (or column) always beat ones that don't, so moving right through a grid
 * reaches the next card rather than a button above it.
 */
export function getDirectionalScore(
	current: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
	candidate: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
	direction: Direction,
) {
	const tolerance = 4;
	let primary: number;
	let shared: number;
	let gap: number;
	if (direction === "right" || direction === "left") {
		primary =
			direction === "right" ? candidate.left - current.right : current.left - candidate.right;
		if (primary < -tolerance) return null;
		shared = overlap(current.top, current.bottom, candidate.top, candidate.bottom);
		gap =
			shared > 0
				? 0
				: Math.min(
						Math.abs(candidate.top - current.bottom),
						Math.abs(current.top - candidate.bottom),
					);
	} else {
		primary =
			direction === "down" ? candidate.top - current.bottom : current.top - candidate.bottom;
		if (primary < -tolerance) return null;
		shared = overlap(current.left, current.right, candidate.left, candidate.right);
		gap =
			shared > 0
				? 0
				: Math.min(
						Math.abs(candidate.left - current.right),
						Math.abs(current.left - candidate.right),
					);
	}
	return (shared > 0 ? 0 : 1_000_000) + Math.max(primary, 0) * 10 + gap * 3;
}

function focusFirstCandidate(candidates: HTMLElement[]) {
	const first = candidates.slice().sort((a, b) => {
		const rectA = a.getBoundingClientRect();
		const rectB = b.getBoundingClientRect();
		if (rectA.top !== rectB.top) return rectA.top - rectB.top;
		return rectA.left - rectB.left;
	})[0];

	first?.focus();
}

export function installTvSpatialNavigation() {
	function handleKeyDown(event: KeyboardEvent) {
		if (!document.documentElement.classList.contains("tv-mode")) return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (isEditableElement(event.target as Element | null)) return;

		const direction =
			event.key === "ArrowLeft"
				? "left"
				: event.key === "ArrowRight"
					? "right"
					: event.key === "ArrowUp"
						? "up"
						: event.key === "ArrowDown"
							? "down"
							: null;

		if (!direction) return;

		const candidates = getFocusableCandidates();
		if (!candidates.length) return;

		const activeElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;

		if (!activeElement?.matches(TV_FOCUS_SELECTOR)) {
			event.preventDefault();
			focusFirstCandidate(candidates);
			return;
		}

		const currentRect = activeElement.getBoundingClientRect();
		let bestCandidate: HTMLElement | null = null;
		let bestScore = Number.POSITIVE_INFINITY;

		for (const candidate of candidates) {
			if (candidate === activeElement) continue;

			const score = getDirectionalScore(currentRect, candidate.getBoundingClientRect(), direction);
			if (score == null) continue;

			if (score < bestScore) {
				bestScore = score;
				bestCandidate = candidate;
			}
		}

		if (!bestCandidate) return;

		event.preventDefault();
		bestCandidate.focus();
		// Keep the focused element in view, also inside sideways-scrolling rows.
		bestCandidate.scrollIntoView?.({ block: "nearest", inline: "nearest" });
	}

	window.addEventListener("keydown", handleKeyDown);

	return () => {
		window.removeEventListener("keydown", handleKeyDown);
	};
}
