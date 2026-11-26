import { describe, expect, it } from "vite-plus/test";

import { detectClientPlaybackContext } from "./platform";
import { isQuestUserAgent, isTvUserAgent } from "./tv-detection";

const UA = {
	chromecastGoogleTv:
		"Mozilla/5.0 (Linux; Android 12; Chromecast Build/STTE.230319.008; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36",
	fireTvStick:
		"Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7633.3445N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36",
	fireTvSilk:
		"Mozilla/5.0 (Linux; Android 9; AFTMM) AppleWebKit/537.36 (KHTML, like Gecko) Silk/116.3.5 like Chrome/116.0.0.0 Safari/537.36",
	shield:
		"Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36",
	miBox:
		"Mozilla/5.0 (Linux; Android 9; MIBOX4 Build/PI; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.0.0 Safari/537.36",
	pixelPhone:
		"Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240305.019; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36",
	macSafari:
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
	macChrome:
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
	quest3App:
		"Mozilla/5.0 (Linux; Android 14; Quest 3 Build/UP1A.231005.007.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/132.0.0.0 Mobile Safari/537.36",
	questProApp:
		"Mozilla/5.0 (Linux; Android 12; Quest Pro Build/SQ3A.220605.009.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36",
	questBrowser:
		"Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/38.0.0.0 SamsungBrowser/4.0 Chrome/132.0.0.0 VR Safari/537.36",
};

describe("isTvUserAgent", () => {
	it.each([
		["Chromecast with Google TV", UA.chromecastGoogleTv],
		["Fire TV Stick", UA.fireTvStick],
		["Fire TV Silk browser", UA.fireTvSilk],
		["NVIDIA Shield", UA.shield],
		["Xiaomi Mi Box", UA.miBox],
	])("recognises %s", (_name, userAgent) => {
		expect(isTvUserAgent(userAgent)).toBe(true);
	});

	it.each([
		["an Android phone", UA.pixelPhone],
		["Safari on a Mac", UA.macSafari],
		["Chrome on a Mac", UA.macChrome],
	])("leaves %s alone", (_name, userAgent) => {
		expect(isTvUserAgent(userAgent)).toBe(false);
	});
});

describe("isQuestUserAgent", () => {
	it.each([
		["the app on a Quest 3", UA.quest3App],
		["the app on a Quest Pro", UA.questProApp],
		["the Quest Browser", UA.questBrowser],
	])("recognises %s", (_name, userAgent) => {
		expect(isQuestUserAgent(userAgent)).toBe(true);
	});

	it.each([
		["an Android phone", UA.pixelPhone],
		["Chromecast with Google TV", UA.chromecastGoogleTv],
		["Chrome on a Mac", UA.macChrome],
	])("leaves %s alone", (_name, userAgent) => {
		expect(isQuestUserAgent(userAgent)).toBe(false);
	});
});

describe("detectClientPlaybackContext", () => {
	it("treats a Quest as its own pointer-driven platform, not a TV", () => {
		expect(detectClientPlaybackContext({ userAgent: UA.quest3App })).toEqual({
			platform: "quest",
			prefersSafeVideo: false,
			prefersTvMode: false,
		});
		// Even if a stale native TV flag says otherwise.
		expect(
			detectClientPlaybackContext({ userAgent: UA.quest3App, isNativeTv: true }),
		).toMatchObject({ platform: "quest", prefersTvMode: false });
	});

	it("treats a TV user agent as Android TV with TV mode", () => {
		expect(detectClientPlaybackContext({ userAgent: UA.chromecastGoogleTv })).toEqual({
			platform: "android-tv",
			prefersSafeVideo: true,
			prefersTvMode: true,
		});
	});

	it("trusts the native shell when the user agent says nothing", () => {
		// Some TV WebViews report an ordinary Android user agent.
		expect(detectClientPlaybackContext({ userAgent: UA.pixelPhone })).toMatchObject({
			platform: "android",
			prefersTvMode: false,
		});
		expect(
			detectClientPlaybackContext({ userAgent: UA.pixelPhone, isNativeTv: true }),
		).toMatchObject({ platform: "android-tv", prefersTvMode: true });
	});

	it("keeps desktop Safari on the safe-video path without TV mode", () => {
		expect(detectClientPlaybackContext({ userAgent: UA.macSafari })).toEqual({
			platform: "other",
			prefersSafeVideo: true,
			prefersTvMode: false,
		});
	});
});
