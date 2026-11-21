// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import type { MediaItem } from "../lib/media";
import { MediaSpotlightDialog } from "./MediaSpotlightDialog";

const film: MediaItem = {
	id: "film-1",
	source: "jellyfin",
	type: "movie",
	title: "Test Film",
	overview: "A film to test with.",
	genres: [],
	streamUrl: "/stream/film-1",
};

vi.mock("../lib/runtime-functions", () => ({
	fetchItemDetailsRuntime: vi.fn(async () => ({
		item: { ...film, cast: [], studios: [], tags: [] },
		similar: [],
	})),
	fetchSeriesDetailsRuntime: vi.fn(),
	markPlayedRuntime: vi.fn(),
}));

afterEach(() => {
	cleanup();
	document.documentElement.classList.remove("tv-mode");
	localStorage.clear();
});

function dialog(open: boolean) {
	return (
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<I18nProvider>
				<MediaSpotlightDialog
					item={open ? film : null}
					open={open}
					onClose={() => undefined}
					onPlay={() => undefined}
				/>
			</I18nProvider>
		</QueryClientProvider>
	);
}

describe("MediaSpotlightDialog", () => {
	it("opens after rendering closed, as it does in the app", async () => {
		// It is always mounted; opening it must not change its hooks (a hook
		// after the early return for the closed state crashed the app).
		const view = render(dialog(false));
		view.rerender(dialog(true));
		expect(await view.findAllByText("Test Film")).not.toHaveLength(0);
		view.rerender(dialog(false));
		view.rerender(dialog(true));
		expect(await view.findAllByText("Test Film")).not.toHaveLength(0);
	});

	it("starts the remote on Play in TV mode", async () => {
		localStorage.setItem("aurora-tv-mode", "1");
		document.documentElement.classList.add("tv-mode");
		const view = render(dialog(false));
		view.rerender(dialog(true));
		await waitFor(() => {
			expect(document.activeElement?.classList.contains("primary-action")).toBe(true);
		});
		expect(view.container.ownerDocument.querySelector(".tv-detail-shell")).not.toBeNull();
	});
});
