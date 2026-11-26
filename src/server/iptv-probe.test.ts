import { describe, expect, it } from "vite-plus/test";

import {
	browserCanPlayAudio,
	canCopyAudio,
	canCopyVideo,
	ffprobeBinary,
	parseKeyframe,
	parseProbe,
} from "./iptv-probe";

const output = JSON.stringify({
	streams: [
		{ index: 0, codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p" },
		{ index: 1, codec_type: "audio", codec_name: "aac", channels: 6, tags: { language: "ger" } },
		{
			index: 2,
			codec_type: "audio",
			codec_name: "aac",
			channels: 2,
			tags: { language: "eng", title: "Commentary" },
		},
		{ index: 3, codec_type: "subtitle", codec_name: "subrip", tags: { language: "eng" } },
		{
			index: 4,
			codec_type: "subtitle",
			codec_name: "hdmv_pgs_subtitle",
			tags: { language: "nld" },
		},
		{ index: 5, codec_type: "subtitle", codec_name: "ass", tags: { language: "nld" } },
		{
			index: 6,
			codec_type: "subtitle",
			codec_name: "subrip",
			tags: { language: "eng" },
			disposition: { forced: 0, hearing_impaired: 1 },
		},
		{
			index: 7,
			codec_type: "subtitle",
			codec_name: "subrip",
			tags: { language: "eng" },
			disposition: { forced: 1, hearing_impaired: 0 },
		},
	],
});

describe("IPTV media probe", () => {
	it("lists audio and the text subtitles ffmpeg can turn into WebVTT", () => {
		const media = parseProbe(output);
		expect(media.audio.map((track) => [track.index, track.language])).toEqual([
			[0, "ger"],
			[1, "eng"],
		]);
		// Bitmap subtitles can't become WebVTT; indexes count all subtitle streams.
		expect(media.subtitles.map((track) => [track.index, track.codec])).toEqual([
			[0, "subrip"],
			[2, "ass"],
			[3, "subrip"],
			[4, "subrip"],
		]);
	});

	it("marks SDH and forced subtitles", () => {
		const [plain, , sdh, forced] = parseProbe(output).subtitles;
		expect([plain?.hearingImpaired, plain?.forced]).toEqual([undefined, undefined]);
		expect(sdh?.hearingImpaired).toBe(true);
		expect(forced?.forced).toBe(true);
	});

	it("repackages browser-ready video and stereo AAC, converts the rest", () => {
		const media = parseProbe(output);
		expect(canCopyVideo(media)).toBe(true);
		expect(canCopyVideo({ ...media, video: { codec: "hevc" } })).toBe(false);
		expect(canCopyVideo({ ...media, video: { codec: "h264", pixFmt: "yuv420p10le" } })).toBe(false);
		expect(canCopyAudio(media.audio[0])).toBe(false);
		expect(canCopyAudio(media.audio[1])).toBe(true);
	});

	it("converts Dolby audio unless the browser decodes it", () => {
		expect(browserCanPlayAudio("aac", { dolby: false })).toBe(true);
		expect(browserCanPlayAudio("eac3", { dolby: false })).toBe(false);
		expect(browserCanPlayAudio("ac3", { dolby: false })).toBe(false);
		expect(browserCanPlayAudio("eac3", { dolby: true })).toBe(true);
		expect(browserCanPlayAudio("dts", { dolby: true })).toBe(false);
		expect(browserCanPlayAudio("truehd", { dolby: true })).toBe(false);
		// No audio track: nothing to convert.
		expect(browserCanPlayAudio(undefined, { dolby: false })).toBe(true);
	});

	it("reads the keyframe a seek lands on", () => {
		expect(parseKeyframe("2618.041667,K_\n")).toBe(2618.041667);
		expect(parseKeyframe("12.5,__\n")).toBeUndefined();
		expect(parseKeyframe("")).toBeUndefined();
	});

	it("finds ffprobe beside ffmpeg", () => {
		expect(ffprobeBinary("/opt/homebrew/bin/ffmpeg")).toBe("/opt/homebrew/bin/ffprobe");
	});
});
