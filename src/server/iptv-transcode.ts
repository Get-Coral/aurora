import { type ChildProcess, spawn } from "node:child_process";
import { Readable } from "node:stream";

let active: ChildProcess | undefined;

/**
 * Convert a provider file (MKV, AVI) to fragmented MP4 the browser can play.
 * One conversion runs per Aurora process — most IPTV accounts allow a single
 * connection anyway — and a new request (a seek, another title) replaces the
 * running one. `start` seeks with range requests, so resuming is fast.
 */
export async function transcodeIptv(source: URL, binary: string, signal: AbortSignal, start = 0) {
	active?.kill("SIGKILL");
	const child = spawn(
		binary,
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-protocol_whitelist",
			"http,https,tcp,tls,crypto",
			"-user_agent",
			"Aurora IPTV",
			...(start > 0 ? ["-ss", String(Math.floor(start))] : []),
			"-i",
			source.href,
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
		{ stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
	);
	active = child;
	const stop = () => child.kill("SIGKILL");
	child.once("close", () => {
		if (active === child) active = undefined;
		signal.removeEventListener("abort", stop);
	});
	signal.addEventListener("abort", stop, { once: true });
	if (signal.aborted) stop();

	const reader = Readable.toWeb(
		child.stdout,
	).getReader() as ReadableStreamDefaultReader<Uint8Array>;
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
