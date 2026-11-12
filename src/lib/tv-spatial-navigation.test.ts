// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getActiveTvScope,
	getDirectionalScore,
	getTvFocusCandidates,
	installTvSpatialNavigation,
	moveTvFocus,
} from "./tv-spatial-navigation";

function rect(left: number, top: number, width: number, height: number): DOMRect {
	return {
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		x: left,
		y: top,
		toJSON: () => ({}),
	} as DOMRect;
}

/** jsdom has no layout; place each element by hand. */
function place(element: Element, box: DOMRect) {
	(element as HTMLElement).getBoundingClientRect = () => box;
	(element as HTMLElement).getClientRects = () => [box] as unknown as DOMRectList;
}

function button(label: string, box: DOMRect, parent: Element = document.body) {
	const element = document.createElement("button");
	element.textContent = label;
	place(element, box);
	parent.appendChild(element);
	return element;
}

function press(key: string) {
	const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
	(document.activeElement ?? document.body).dispatchEvent(event);
	return event;
}

let uninstall: (() => void) | null = null;

beforeEach(() => {
	document.body.innerHTML = "";
	document.documentElement.classList.add("tv-mode");
	place(document.body, rect(0, 0, 1920, 1080));
	uninstall = installTvSpatialNavigation();
});

afterEach(() => {
	uninstall?.();
	document.documentElement.classList.remove("tv-mode");
});

describe("getDirectionalScore", () => {
	const current = rect(0, 0, 100, 100);

	it("ignores candidates in the wrong direction", () => {
		expect(getDirectionalScore(current, rect(-200, 0, 100, 100), "right")).toBeNull();
	});

	it("prefers the next item in the same row over a nearer one in the row below", () => {
		const sameRowFar = getDirectionalScore(current, rect(400, 0, 100, 100), "right");
		const nextRowNear = getDirectionalScore(current, rect(120, 150, 100, 100), "right");
		expect(sameRowFar).not.toBeNull();
		expect(nextRowNear).not.toBeNull();
		expect(sameRowFar!).toBeLessThan(nextRowNear!);
	});
});

describe("moveTvFocus", () => {
	it("moves along a row and down to the next one", () => {
		const a = button("a", rect(0, 0, 100, 100));
		const b = button("b", rect(150, 0, 100, 100));
		const c = button("c", rect(0, 150, 100, 100));
		a.focus();

		expect(press("ArrowRight").defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(b);
		press("ArrowLeft");
		press("ArrowDown");
		expect(document.activeElement).toBe(c);
	});

	it("reaches plain controls without any TV markup", () => {
		const input = document.createElement("input");
		place(input, rect(0, 0, 300, 40));
		document.body.appendChild(input);
		const submit = button("Sign in", rect(0, 80, 300, 40));
		input.focus();

		// Left/Right stay in the field for the caret; Down leaves it.
		expect(press("ArrowRight").defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(input);
		press("ArrowDown");
		expect(document.activeElement).toBe(submit);
	});

	it("skips disabled, hidden and opted-out elements", () => {
		const start = button("start", rect(0, 0, 100, 100));
		const disabled = button("disabled", rect(150, 0, 100, 100));
		disabled.disabled = true;
		const skipped = button("skipped", rect(300, 0, 100, 100));
		skipped.dataset.tvSkip = "";
		const hidden = button("hidden", rect(450, 0, 0, 0));
		const target = button("target", rect(600, 0, 100, 100));

		expect(getTvFocusCandidates()).toEqual([start, target]);
		start.focus();
		moveTvFocus("right");
		expect(document.activeElement).toBe(target);
		expect(hidden).not.toBe(document.activeElement);
	});

	it("stays inside an open dialog", () => {
		const behind = button("behind", rect(0, 0, 100, 100));
		const dialog = document.createElement("div");
		dialog.setAttribute("aria-modal", "true");
		place(dialog, rect(0, 0, 1920, 1080));
		document.body.appendChild(dialog);
		const play = button("play", rect(200, 300, 100, 50), dialog);
		const more = button("more", rect(200, 400, 100, 50), dialog);

		expect(getActiveTvScope()).toBe(dialog);
		play.focus();
		press("ArrowUp");
		expect(document.activeElement).toBe(play); // nothing above inside the dialog
		press("ArrowDown");
		expect(document.activeElement).toBe(more);
		press("ArrowLeft");
		expect(document.activeElement).not.toBe(behind);
	});

	it("starts on a dialog's preferred control when focus is outside it", () => {
		const card = button("card", rect(0, 0, 100, 100));
		const dialog = document.createElement("div");
		dialog.setAttribute("aria-modal", "true");
		place(dialog, rect(0, 0, 1920, 1080));
		document.body.appendChild(dialog);
		button("close", rect(1800, 20, 50, 50), dialog);
		const play = button("play", rect(200, 600, 100, 50), dialog);
		play.dataset.tvAutofocus = "";
		card.focus();

		press("ArrowDown");
		expect(document.activeElement).toBe(play);
	});

	it("leaves the arrows to a layer that handles them itself", () => {
		const player = document.createElement("div");
		player.setAttribute("aria-modal", "true");
		player.dataset.tvArrows = "manual";
		place(player, rect(0, 0, 1920, 1080));
		document.body.appendChild(player);
		const pause = button("pause", rect(0, 900, 50, 50), player);
		button("next", rect(100, 900, 50, 50), player);
		pause.focus();

		expect(press("ArrowRight").defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(pause);
	});

	it("does nothing outside TV mode", () => {
		document.documentElement.classList.remove("tv-mode");
		const a = button("a", rect(0, 0, 100, 100));
		button("b", rect(150, 0, 100, 100));
		a.focus();

		expect(press("ArrowRight").defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(a);
	});
});
