import { describe, expect, it } from "vitest";
import { enMessages } from "./en";
import { nlMessages } from "./nl";

// English is the source of truth for the key set. Every other locale must
// cover exactly the same keys — a missing key silently renders English (or the
// raw key), and an extra key is dead weight or a typo.
describe("i18n key parity", () => {
	const enKeys = Object.keys(enMessages).sort();
	const nlKeys = Object.keys(nlMessages).sort();

	it("nl has no missing keys", () => {
		const missing = enKeys.filter((k) => !(k in nlMessages));
		expect(missing).toEqual([]);
	});

	it("nl has no extra keys", () => {
		const extra = nlKeys.filter((k) => !(k in enMessages));
		expect(extra).toEqual([]);
	});

	it("keeps function-valued keys consistent across locales", () => {
		// A key that interpolates params in one locale but is a plain string in
		// another will crash when called with params. Types must match.
		const mismatched = enKeys.filter((k) => typeof enMessages[k] !== typeof nlMessages[k]);
		expect(mismatched).toEqual([]);
	});
});
