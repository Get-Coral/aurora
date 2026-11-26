import { describe, expect, it } from "vitest";
import {
	browserCanPlayAudio,
	canCopyAudio,
	canCopyVideo,
	ffprobeBinary,
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
		]);
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

	it("finds ffprobe beside ffmpeg", () => {
		expect(ffprobeBinary("/opt/homebrew/bin/ffmpeg")).toBe("/opt/homebrew/bin/ffprobe");
	});
});
