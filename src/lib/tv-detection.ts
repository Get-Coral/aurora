/**
 * Recognising a TV. Shared by platform.ts and the pre-paint script in
 * __root.tsx, which can't import modules, so everything here is plain data.
 */

/**
 * Lower-cased user-agent fragments of Android TV / Google TV devices and the
 * TV makers' WebViews. Fire TV models all start with "AFT" (AFTKA, AFTMM,
 * AFTSS, ...) followed by the build or a closing parenthesis.
 */
export const TV_USER_AGENT_PATTERN_SOURCE = [
	"android tv",
	"googletv",
	"google tv",
	"chromecast",
	"mibox",
	"mitv",
	"bravia",
	"smarttv",
	"hbbtv",
	"; aft[a-z0-9]+[;) ]",
].join("|");

const TV_USER_AGENT_PATTERN = new RegExp(TV_USER_AGENT_PATTERN_SOURCE);

export function isTvUserAgent(userAgent: string): boolean {
	return TV_USER_AGENT_PATTERN.test(userAgent.toLowerCase());
}

/**
 * Set by the native Android shell once it has asked the system whether it
 * runs on a TV (UiModeManager / leanback). Many TV WebViews don't say so in
 * their user agent, so this is the reliable signal inside the app.
 */
export const NATIVE_TV_STORAGE_KEY = "aurora-native-tv";

export function readNativeTvFlag(): boolean {
	try {
		return window.localStorage.getItem(NATIVE_TV_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}
