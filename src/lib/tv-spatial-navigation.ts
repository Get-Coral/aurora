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

function getRectCenter(rect: DOMRect) {
	return {
		x: rect.left + rect.width / 2,
		y: rect.top + rect.height / 2,
	};
}

function getDirectionalScore(
	currentRect: DOMRect,
	candidateRect: DOMRect,
	direction: "left" | "right" | "up" | "down",
) {
	const current = getRectCenter(currentRect);
	const candidate = getRectCenter(candidateRect);
	const deltaX = candidate.x - current.x;
	const deltaY = candidate.y - current.y;

	if (direction === "right" && deltaX <= 8) return null;
	if (direction === "left" && deltaX >= -8) return null;
	if (direction === "down" && deltaY <= 8) return null;
	if (direction === "up" && deltaY >= -8) return null;

	const primaryDistance =
		direction === "left" || direction === "right" ? Math.abs(deltaX) : Math.abs(deltaY);
	const secondaryDistance =
		direction === "left" || direction === "right" ? Math.abs(deltaY) : Math.abs(deltaX);

	return primaryDistance * 1000 + secondaryDistance * 5;
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
	}

	window.addEventListener("keydown", handleKeyDown);

	return () => {
		window.removeEventListener("keydown", handleKeyDown);
	};
}
