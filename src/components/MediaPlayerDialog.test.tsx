// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import type { MediaItem } from "../lib/media";
import { MediaPlayerDialog } from "./MediaPlayerDialog";

const runtime = vi.hoisted(() => ({
	beginPlaybackSessionRuntime: vi.fn(),
	createStreamTokenRuntime: vi.fn(),
	reportPlaybackStateRuntime: vi.fn(),
	fetchOpenSubtitlesKeyRuntime: vi.fn(),
	searchOnlineSubtitlesRuntime: vi.fn(),
	fetchOnlineSubtitleRuntime: vi.fn(),
}));

vi.mock("../lib/runtime-functions", () => runtime);

// Desktop Safari: always a native HLS transcode, the case that misbehaved.
vi.mock("../lib/platform", () => ({
	getClientPlaybackContext: () => ({
		platform: "other",
		prefersSafeVideo: true,
		prefersTvMode: false,
	}),
}));

vi.mock("./useRemotePlayback", () => ({
	useRemotePlayback: () => ({ available: false, active: false, prompt: () => undefined }),
}));

const RUNTIME_SECONDS = 6000;
const HLS_URL = "/api/jellyfin-stream?path=%2Fvideos%2Fabc%2Fmaster.m3u8%3FSegmentContainer%3Dts";

const item: MediaItem = {
	id: "abc",
	source: "jellyfin",
	type: "movie",
	title: "Test Film",
	genres: [],
	runtimeMinutes: 100,
	runtimeSeconds: RUNTIME_SECONDS,
	streamUrl: "/api/jellyfin-stream?path=%2Fvideos%2Fabc%2Fstream.mp4",
};

/** jsdom's media element has no clock; give it one the test controls. */
function instrumentVideo(video: HTMLVideoElement) {
	let time = 0;
	const assignments: number[] = [];
	Object.defineProperty(video, "currentTime", {
		configurable: true,
		get: () => time,
		set: (value: number) => {
			time = value;
			assignments.push(value);
		},
	});
	Object.defineProperty(video, "duration", { configurable: true, get: () => Number.NaN });
	Object.defineProperty(video, "paused", { configurable: true, get: () => false });
	return {
		assignments,
		/** The element reports `seconds`, as Safari does while it is still at the old spot. */
		play(seconds: number) {
			time = seconds;
			fireEvent(video, new Event("timeupdate"));
		},
		landSeek() {
			fireEvent(video, new Event("seeked"));
		},
	};
}

async function renderPlayer() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const view = render(
		<QueryClientProvider client={queryClient}>
			<I18nProvider>
				<MediaPlayerDialog item={item} open onClose={() => undefined} />
			</I18nProvider>
		</QueryClientProvider>,
	);
	const video = await waitFor(() => {
		const element = view.container.querySelector("video");
		if (!element) throw new Error("player has no stream yet");
		return element;
	});
	const slider = view.container.querySelector<HTMLDivElement>(".player-progress")!;
	slider.getBoundingClientRect = () =>
		({ left: 0, width: 1000, top: 0, height: 20, right: 1000, bottom: 20 }) as DOMRect;
	const fill = view.container.querySelector<HTMLDivElement>(".player-progress-fill")!;
	return { view, video, slider, fill, media: instrumentVideo(video) };
}

/** jsdom has no PointerEvent; a MouseEvent carrying the pointer fields will do. */
function pointer(
	type: string,
	target: Element,
	clientX: number,
	extra: { button?: number; buttons?: number } = {},
) {
	const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, ...extra });
	Object.defineProperties(event, {
		pointerId: { value: 1 },
		pointerType: { value: "mouse" },
	});
	fireEvent(target, event);
}

beforeEach(() => {
	runtime.beginPlaybackSessionRuntime.mockResolvedValue({
		streamUrl: HLS_URL,
		canSyncProgress: true,
		playMethod: "Transcode",
		playSessionId: "session-1",
		subtitleTracks: [],
	});
	runtime.createStreamTokenRuntime.mockResolvedValue({ token: null });
	runtime.reportPlaybackStateRuntime.mockResolvedValue(undefined);
	runtime.fetchOpenSubtitlesKeyRuntime.mockResolvedValue(null);
	runtime.searchOnlineSubtitlesRuntime.mockResolvedValue([]);

	const captured = new WeakSet<Element>();
	HTMLElement.prototype.setPointerCapture = function (this: HTMLElement) {
		captured.add(this);
	};
	HTMLElement.prototype.hasPointerCapture = function (this: HTMLElement) {
		return captured.has(this);
	};
	HTMLElement.prototype.releasePointerCapture = function (this: HTMLElement) {
		captured.delete(this);
	};
	HTMLMediaElement.prototype.load = () => undefined;
	HTMLMediaElement.prototype.pause = () => undefined;
	HTMLMediaElement.prototype.play = () => Promise.resolve();
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("MediaPlayerDialog progress bar", () => {
	it("uses the exact runtime for a transcode whose element reports no duration", async () => {
		const { view } = await renderPlayer();
		expect(view.container.querySelector(".player-time")?.textContent).toContain("1:40:00");
	});

	it("jumps to a clicked position at once and stays there until Safari catches up", async () => {
		const { slider, fill, media } = await renderPlayer();
		act(() => media.play(600));

		pointer("pointerdown", slider, 500, { button: 0, buttons: 1 });
		pointer("pointerup", slider, 500, { button: 0, buttons: 0 });

		expect(media.assignments).toEqual([RUNTIME_SECONDS / 2]);
		expect(fill.style.width).toBe("50%");

		// Safari keeps reporting the old spot while the segment is fetched.
		act(() => media.play(601));
		expect(fill.style.width).toBe("50%");

		act(() => {
			media.play(RUNTIME_SECONDS / 2 + 0.4);
			media.landSeek();
		});
		expect(Number.parseFloat(fill.style.width)).toBeCloseTo(50, 0);
	});

	it("follows the pointer while dragging and seeks only once, on release", async () => {
		const { slider, fill, media } = await renderPlayer();
		act(() => media.play(600));

		pointer("pointerdown", slider, 100, { button: 0, buttons: 1 });
		pointer("pointermove", slider, 400, { buttons: 1 });
		pointer("pointermove", slider, 700, { buttons: 1 });
		expect(fill.style.width).toBe("70%");
		expect(slider.classList.contains("scrubbing")).toBe(true);

		// Playback carrying on underneath must not pull the bar away.
		act(() => media.play(602));
		expect(fill.style.width).toBe("70%");
		expect(media.assignments).toEqual([]);

		pointer("pointerup", slider, 700, { button: 0, buttons: 0 });
		expect(media.assignments).toEqual([RUNTIME_SECONDS * 0.7]);
		expect(slider.classList.contains("scrubbing")).toBe(false);
	});

	it("ignores a release over the bar when the press started elsewhere", async () => {
		const { slider, media } = await renderPlayer();
		pointer("pointerup", slider, 800, { button: 0, buttons: 0 });
		expect(media.assignments).toEqual([]);
	});

	it("drops a drag the browser cancels", async () => {
		const { slider, fill, media } = await renderPlayer();
		act(() => media.play(600));
		pointer("pointerdown", slider, 300, { button: 0, buttons: 1 });
		pointer("pointercancel", slider, 300);

		expect(media.assignments).toEqual([]);
		expect(fill.style.width).toBe("10%");
		// Hovering afterwards is not a drag.
		pointer("pointermove", slider, 900, { buttons: 0 });
		expect(media.assignments).toEqual([]);
	});

	it("seeks from the keyboard", async () => {
		const { slider, media } = await renderPlayer();
		act(() => media.play(600));
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		expect(media.assignments).toEqual([610]);
	});
});
