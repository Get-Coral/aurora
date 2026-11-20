import { spawn } from "node:child_process";
import { Readable } from "node:stream";

let active = false;

export async function transcodeIptv(
	body: ReadableStream<Uint8Array>,
	binary: string,
	signal: AbortSignal,
) {
	if (active) {
		await body.cancel();
		throw new Error("IPTV transcoder is busy");
	}
	active = true;
	const child = spawn(
		binary,
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-protocol_whitelist",
			"pipe",
			"-threads",
			"2",
			"-i",
			"pipe:0",
			"-map",
			"0:v:0",
			"-map",
			"0:a:0?",
			"-c:v",
			"libx264",
			"-preset",
			"ultrafast",
			"-pix_fmt",
			"yuv420p",
			"-vf",
			"scale=w='min(1920,iw)':h=-2",
			"-threads",
			"2",
			"-c:a",
			"aac",
			"-ac",
			"2",
			"-g",
			"48",
			"-movflags",
			"frag_keyframe+empty_moov+default_base_moof",
			"-f",
			"mp4",
			"pipe:1",
		],
		{ stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
	);
	const source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
	const stop = () => {
		source.destroy();
		child.kill();
	};
	const onExit = () => {
		active = false;
		signal.removeEventListener("abort", stop);
		source.destroy();
	};
	child.once("close", onExit);
	child.on("error", () => source.destroy());
	child.stdin.on("error", () => source.destroy());
	source.on("error", stop);
	signal.addEventListener("abort", stop, { once: true });
	if (signal.aborted) stop();
	source.pipe(child.stdin);

	const reader = Readable.toWeb(child.stdout).getReader();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const chunk = await reader.read();
			if (chunk.done) controller.close();
			else controller.enqueue(chunk.value);
		},
		async cancel() {
			stop();
			await reader.cancel();
		},
	});
}
