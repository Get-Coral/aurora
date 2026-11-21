import { describe, expect, it } from "vitest";
import { detectClientPlaybackContext } from "./platform";
import { isTvUserAgent } from "./tv-detection";

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

describe("detectClientPlaybackContext", () => {
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
