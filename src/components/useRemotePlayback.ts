import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/**
 * Surfaces the browser's own "play this on a TV" picker — AirPlay in Safari,
 * Cast in Chrome — for a `<video>` Aurora draws its own controls over.
 *
 * Chrome exposes Cast at the browser level (the ⋮ menu), which is why casting
 * appears to work without any of this. Safari doesn't: it only offers AirPlay
 * through native `<video controls>` or an explicit call, so a player with a
 * custom control bar has to ask for the picker itself.
 *
 * Two APIs, because neither covers everything:
 *   - Remote Playback, in Safari 13.1+ and Chrome, but secure-context only —
 *     over plain HTTP on a LAN, Chrome never exposes it and the button simply
 *     never appears.
 *   - The older WebKit `webkit*` calls, which aren't secure-context gated and
 *     are the only option in iOS WKWebView (the Capacitor shell), where
 *     Remote Playback isn't implemented at all.
 */

type RemoteState = "connected" | "connecting" | "disconnected";

interface RemotePlaybackLike extends EventTarget {
	readonly state: RemoteState;
	watchAvailability(callback: (available: boolean) => void): Promise<number>;
	cancelWatchAvailability(id?: number): Promise<void>;
	prompt(): Promise<void>;
}

interface WebKitAirplayVideo {
	webkitShowPlaybackTargetPicker?: () => void;
	webkitCurrentPlaybackTargetIsWireless?: boolean;
}

interface WebKitTargetAvailabilityEvent extends Event {
	availability?: "available" | "not-available";
}

export interface RemotePlaybackApi {
	/** A receiver has been discovered. False for the first second or two while mDNS runs. */
	available: boolean;
	/** Playback has been handed off to a receiver. */
	active: boolean;
	prompt: () => void;
}

// Reached through `unknown` rather than a global augmentation of
// HTMLMediaElement: whether lib.dom declares these varies by TS version, and a
// conflicting redeclaration is a hard error.
function getRemotePlayback(video: HTMLVideoElement): RemotePlaybackLike | null {
	const candidate = (video as unknown as { remote?: unknown }).remote;
	if (!candidate || typeof candidate !== "object") return null;

	const remote = candidate as Partial<RemotePlaybackLike>;
	return typeof remote.watchAvailability === "function" && typeof remote.prompt === "function"
		? (candidate as RemotePlaybackLike)
		: null;
}

function asWebKitVideo(video: HTMLVideoElement): WebKitAirplayVideo {
	return video as unknown as WebKitAirplayVideo;
}

export function useRemotePlayback(
	videoRef: RefObject<HTMLVideoElement | null>,
	options: { enabled: boolean; srcKey: string | null },
): RemotePlaybackApi {
	const { enabled, srcKey } = options;
	const [available, setAvailable] = useState(false);
	const [active, setActive] = useState(false);
	const videoElementRef = useRef<HTMLVideoElement | null>(null);

	useEffect(() => {
		const video = videoRef.current;
		videoElementRef.current = video;

		if (!enabled || !video) {
			setAvailable(false);
			setActive(false);
			return;
		}

		// The effect can wire the WebKit fallback asynchronously (when
		// watchAvailability rejects), so teardown is collected as it goes.
		const teardown: Array<() => void> = [];
		let cancelled = false;

		function attachWebKitFallback(element: HTMLVideoElement) {
			if (cancelled) return;
			if (typeof asWebKitVideo(element).webkitShowPlaybackTargetPicker !== "function") return;

			const onAvailability = (event: Event) => {
				setAvailable((event as WebKitTargetAvailabilityEvent).availability === "available");
			};
			const onWirelessChange = () => {
				setActive(asWebKitVideo(element).webkitCurrentPlaybackTargetIsWireless === true);
			};

			element.addEventListener("webkitplaybacktargetavailabilitychanged", onAvailability);
			element.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", onWirelessChange);
			onWirelessChange();

			teardown.push(() => {
				element.removeEventListener("webkitplaybacktargetavailabilitychanged", onAvailability);
				element.removeEventListener(
					"webkitcurrentplaybacktargetiswirelesschanged",
					onWirelessChange,
				);
			});
		}

		const remote = getRemotePlayback(video);

		if (remote) {
			const syncState = () => setActive(remote.state !== "disconnected");
			for (const event of ["connect", "connecting", "disconnect"]) {
				remote.addEventListener(event, syncState);
				teardown.push(() => remote.removeEventListener(event, syncState));
			}
			syncState();

			remote
				.watchAvailability((isAvailable) => {
					if (!cancelled) setAvailable(isAvailable);
				})
				.then((watchId) => {
					if (cancelled) {
						void remote.cancelWatchAvailability(watchId).catch(() => {});
						return;
					}
					teardown.push(() => {
						void remote.cancelWatchAvailability(watchId).catch(() => {});
					});
				})
				.catch(() => {
					// Rejects with InvalidStateError when remote playback is
					// disabled for the element. Safari can still offer AirPlay.
					attachWebKitFallback(video);
				});
		} else {
			attachWebKitFallback(video);
		}

		return () => {
			cancelled = true;
			for (const dispose of teardown) dispose();
			setAvailable(false);
			setActive(false);
		};
		// srcKey: the <video> is remounted whenever the stream URL changes, so
		// the listeners have to be re-attached to the new element.
	}, [videoRef, enabled, srcKey]);

	const prompt = useCallback(() => {
		const video = videoElementRef.current;
		if (!video) return;

		// Must stay synchronous — Safari spends the user gesture on the first
		// await, and then refuses to open the picker.
		const remote = getRemotePlayback(video);
		if (remote) {
			remote.prompt().catch(() => {
				// NotAllowedError, or AbortError when the picker is dismissed.
			});
			return;
		}

		asWebKitVideo(video).webkitShowPlaybackTargetPicker?.();
	}, []);

	return { available, active, prompt };
}
