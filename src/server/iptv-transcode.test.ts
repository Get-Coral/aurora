import { describe, expect, it } from "vitest";
import { startSeconds, transcodeArgs } from "./iptv-transcode";

const source = new URL("http://provider.example/movie/u/p/1.mp4");
const plan = { start: 0, copyVideo: true, audioIndex: 0, copyAudio: false, subtitles: [] };

describe("IPTV conversion", () => {
	it("starts copied video from zero with its timestamps at zero", () => {
		const args = transcodeArgs(source, plan);
		expect(args).not.toContain("-ss");
		expect(args).toContain("setts=pts=PTS-STARTPTS:dts=DTS-STARTDTS");
		expect(args).toContain("frag_keyframe+empty_moov+default_base_moof+negative_cts_offsets");
	});

	it("starts audio and copied video on the same keyframe after a seek", () => {
		// Aimed a moment past the keyframe, so ffmpeg lands on it, not the one before.
		const args = transcodeArgs(source, { ...plan, start: 2618.042 });
		expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 3)).toEqual([
			"-ss",
			"2618.342",
			"-noaccurate_seek",
		]);
		expect(args).not.toContain("setts=pts=PTS-STARTPTS:dts=DTS-STARTDTS");
		expect(args).toContain("frag_keyframe+empty_moov+default_base_moof");
	});

	it("cuts re-encoded video exactly where asked", () => {
		const args = transcodeArgs(source, { ...plan, start: 61.5, copyVideo: false });
		expect(args).toContain("-ss");
		expect(args).not.toContain("-noaccurate_seek");
		expect(args).not.toContain("setts=pts=PTS-STARTPTS:dts=DTS-STARTDTS");
	});

	it("keeps subtitle cues on the film's clock", () => {
		// ffmpeg counts the subtitles from the seek, so they get the seek back.
		const args = transcodeArgs(source, {
			...plan,
			start: 61.25,
			copyVideo: false,
			subtitles: [{ index: 2, file: "/tmp/a-2.vtt" }],
		});
		expect(
			args.slice(args.indexOf("-output_ts_offset"), args.indexOf("-output_ts_offset") + 2),
		).toEqual(["-output_ts_offset", "61.25"]);
	});

	it("keeps start times to the millisecond", () => {
		expect(startSeconds(2618.0416667)).toBe(2618.042);
		expect(startSeconds(-3)).toBe(0);
		expect(startSeconds(Number.NaN)).toBe(0);
	});
});
