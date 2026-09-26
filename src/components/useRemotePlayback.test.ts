// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useRemotePlayback } from "./useRemotePlayback";

type AvailabilityCallback = (available: boolean) => void;

function makeRemoteStub(options: { rejectWatch?: boolean } = {}) {
	const listeners = new Map<string, Set<EventListener>>();
	let availabilityCallback: AvailabilityCallback | null = null;

	const remote = {
		state: "disconnected" as "connected" | "connecting" | "disconnected",
		prompt: vi.fn(() => Promise.resolve()),
		cancelWatchAvailability: vi.fn(() => Promise.resolve()),
		watchAvailability: vi.fn((callback: AvailabilityCallback) => {
			if (options.rejectWatch) return Promise.reject(new Error("InvalidStateError"));
			availabilityCallback = callback;
			return Promise.resolve(1);
		}),
		addEventListener: vi.fn((type: string, listener: EventListener) => {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)?.add(listener);
		}),
		removeEventListener: vi.fn((type: string, listener: EventListener) => {
			listeners.get(type)?.delete(listener);
		}),
		dispatchEvent: vi.fn(() => true),
	};

	return {
		remote,
		listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
		emit(type: string, state: "connected" | "connecting" | "disconnected") {
			remote.state = state;
			for (const listener of listeners.get(type) ?? []) listener(new Event(type));
		},
		setAvailable(value: boolean) {
			availabilityCallback?.(value);
		},
	};
}

function makeVideo(remote?: object, webkit?: Partial<Record<string, unknown>>) {
	const video = document.createElement("video");
	if (remote) Object.defineProperty(video, "remote", { value: remote, configurable: true });
	if (webkit) Object.assign(video, webkit);
	return video;
}

function renderForVideo(video: HTMLVideoElement, enabled = true) {
	const ref = createRef<HTMLVideoElement | null>() as { current: HTMLVideoElement | null };
	ref.current = video;
	return renderHook(() => useRemotePlayback(ref, { enabled, srcKey: "/stream" }));
}

describe("useRemotePlayback with the Remote Playback API", () => {
	it("reports availability from watchAvailability", async () => {
		const stub = makeRemoteStub();
		const { result } = renderForVideo(makeVideo(stub.remote));

		expect(result.current.available).toBe(false);

		await act(async () => stub.setAvailable(true));
		expect(result.current.available).toBe(true);

		await act(async () => stub.setAvailable(false));
		expect(result.current.available).toBe(false);
	});

	it("tracks the connection state", async () => {
		const stub = makeRemoteStub();
		const { result } = renderForVideo(makeVideo(stub.remote));

		expect(result.current.active).toBe(false);

		await act(async () => stub.emit("connect", "connected"));
		expect(result.current.active).toBe(true);

		await act(async () => stub.emit("disconnect", "disconnected"));
		expect(result.current.active).toBe(false);
	});

	it("delegates prompt to the remote", async () => {
		const stub = makeRemoteStub();
		const { result } = renderForVideo(makeVideo(stub.remote));

		act(() => result.current.prompt());
		expect(stub.remote.prompt).toHaveBeenCalledOnce();
	});

	it("swallows a rejected prompt", async () => {
		const stub = makeRemoteStub();
		stub.remote.prompt.mockReturnValue(Promise.reject(new Error("AbortError")));
		const { result } = renderForVideo(makeVideo(stub.remote));

		expect(() => act(() => result.current.prompt())).not.toThrow();
	});

	it("cancels the availability watch and detaches listeners on unmount", async () => {
		const stub = makeRemoteStub();
		const { unmount } = renderForVideo(makeVideo(stub.remote));

		await act(async () => {});
		expect(stub.listenerCount("connect")).toBe(1);

		unmount();
		expect(stub.remote.cancelWatchAvailability).toHaveBeenCalledWith(1);
		expect(stub.listenerCount("connect")).toBe(0);
	});

	it("stays inert when disabled", () => {
		const stub = makeRemoteStub();
		const { result } = renderForVideo(makeVideo(stub.remote), false);

		expect(stub.remote.watchAvailability).not.toHaveBeenCalled();
		expect(result.current.available).toBe(false);
	});
});

describe("useRemotePlayback with the WebKit fallback", () => {
	it("uses the webkit API when there is no remote object", () => {
		const showPicker = vi.fn();
		const video = makeVideo(undefined, {
			webkitShowPlaybackTargetPicker: showPicker,
			webkitCurrentPlaybackTargetIsWireless: false,
		});
		const { result } = renderForVideo(video);

		act(() => {
			const event = new Event("webkitplaybacktargetavailabilitychanged") as Event & {
				availability?: string;
			};
			event.availability = "available";
			video.dispatchEvent(event);
		});
		expect(result.current.available).toBe(true);

		act(() => result.current.prompt());
		expect(showPicker).toHaveBeenCalledOnce();
	});

	it("falls back when watchAvailability rejects", async () => {
		const stub = makeRemoteStub({ rejectWatch: true });
		const showPicker = vi.fn();
		const video = makeVideo(stub.remote, { webkitShowPlaybackTargetPicker: showPicker });
		const { result } = renderForVideo(video);

		await act(async () => {});

		await act(async () => {
			const event = new Event("webkitplaybacktargetavailabilitychanged") as Event & {
				availability?: string;
			};
			event.availability = "available";
			video.dispatchEvent(event);
		});
		expect(result.current.available).toBe(true);
	});

	it("tracks the wireless flag", async () => {
		const video = makeVideo(undefined, {
			webkitShowPlaybackTargetPicker: vi.fn(),
			webkitCurrentPlaybackTargetIsWireless: false,
		});
		const { result } = renderForVideo(video);

		await act(async () => {
			(
				video as unknown as { webkitCurrentPlaybackTargetIsWireless: boolean }
			).webkitCurrentPlaybackTargetIsWireless = true;
			video.dispatchEvent(new Event("webkitcurrentplaybacktargetiswirelesschanged"));
		});
		expect(result.current.active).toBe(true);
	});

	it("reports nothing available when neither API exists", () => {
		const { result } = renderForVideo(makeVideo());

		expect(result.current.available).toBe(false);
		expect(() => act(() => result.current.prompt())).not.toThrow();
	});
});
