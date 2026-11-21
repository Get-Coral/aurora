// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findTopOverlayClose, returnToTopOfHome } from "./back-navigation";

function visible<T extends HTMLElement>(element: T): T {
	element.getClientRects = () => [{}] as unknown as DOMRectList;
	return element;
}

beforeEach(() => {
	document.body.innerHTML = "";
	window.history.replaceState(null, "", "/");
	window.scrollTo = () => undefined;
});

afterEach(() => document.documentElement.classList.remove("tv-mode"));

describe("findTopOverlayClose", () => {
	it("picks the close button of the overlay on top", () => {
		const details = visible(document.createElement("button"));
		details.dataset.auroraOverlayClose = "";
		const picker = visible(document.createElement("button"));
		picker.dataset.auroraOverlayClose = "";
		const hidden = document.createElement("button");
		hidden.dataset.auroraOverlayClose = "";
		hidden.getClientRects = () => [] as unknown as DOMRectList;
		document.body.append(details, picker, hidden);

		expect(findTopOverlayClose()).toBe(picker);
	});
});

describe("returnToTopOfHome", () => {
	function renderHome() {
		document.body.innerHTML = `
			<header class="app-header"><a href="/" class="nav-pill nav-pill-active">Home</a></header>
			<main><button id="card">Card</button></main>`;
		return {
			home: document.querySelector<HTMLElement>(".nav-pill-active")!,
			card: document.querySelector<HTMLElement>("#card")!,
		};
	}

	it("moves focus from a row back to the menu before leaving", () => {
		document.documentElement.classList.add("tv-mode");
		const { home, card } = renderHome();
		card.focus();

		expect(returnToTopOfHome()).toBe(true);
		expect(document.activeElement).toBe(home);
		// Already at the top: the next Back is the app's to handle.
		expect(returnToTopOfHome()).toBe(false);
	});

	it("only applies to the home screen in TV mode", () => {
		const { card } = renderHome();
		card.focus();
		expect(returnToTopOfHome()).toBe(false);

		document.documentElement.classList.add("tv-mode");
		window.history.replaceState(null, "", "/settings");
		expect(returnToTopOfHome()).toBe(false);
	});
});
