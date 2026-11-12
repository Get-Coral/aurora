import { useCallback, useEffect, useState } from "react";
import { getClientPlaybackContext } from "./platform";
import { NATIVE_TV_STORAGE_KEY } from "./tv-detection";

const STORAGE_KEY = "aurora-tv-mode";
const CHANGE_EVENT = "aurora:tv-mode-change";

export function getTvMode(): boolean {
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		if (stored === "1") return true;
		if (stored === "0") return false;
		return getClientPlaybackContext().prefersTvMode;
	} catch {
		return false;
	}
}

function applyTvMode(enabled: boolean) {
	document.documentElement.classList.toggle("tv-mode", enabled);
	// Every useTvMode instance follows, not only the one that changed it.
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Records what the native shell reported about the device. Unless the user
 * has chosen a mode in Settings, a TV switches to TV mode straight away; the
 * pre-paint script in __root.tsx picks the flag up on every later start.
 */
export function setNativeTvDetected(isTv: boolean) {
	try {
		window.localStorage.setItem(NATIVE_TV_STORAGE_KEY, isTv ? "1" : "0");
	} catch {
		// Without storage the user agent is all there is to go on.
	}
	const context = getClientPlaybackContext();
	document.documentElement.dataset.platform = context.platform;
	const enabled = getTvMode();
	if (enabled !== document.documentElement.classList.contains("tv-mode")) applyTvMode(enabled);
}

export function useTvMode() {
	const [tvMode, setTvModeState] = useState(false);

	// Read from localStorage after hydration. The init script in __root.tsx already
	// applies the class before paint, so there's no visual flash.
	useEffect(() => {
		setTvModeState(getTvMode());
		const sync = () => setTvModeState(getTvMode());
		window.addEventListener(CHANGE_EVENT, sync);
		return () => window.removeEventListener(CHANGE_EVENT, sync);
	}, []);

	const setTvMode = useCallback((enabled: boolean) => {
		try {
			if (enabled) {
				window.localStorage.setItem(STORAGE_KEY, "1");
			} else {
				window.localStorage.setItem(STORAGE_KEY, "0");
			}
		} catch {
			// ignore
		}
		setTvModeState(enabled);
		applyTvMode(enabled);
	}, []);

	return { tvMode, setTvMode };
}
