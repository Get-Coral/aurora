import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useDeferredValue, useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import type { IptvEntry } from "../lib/iptv";
import { isNativeShell } from "../lib/runtime-mode";

export const Route = createFileRoute("/iptv")({ component: IptvPage });

const pageSize = 60;
const field = "rounded-lg border border-current/25 bg-transparent p-2";

function IptvPage() {
	const { t } = useI18n();
	const [mode, setMode] = useState("m3u");
	const [entries, setEntries] = useState<IptvEntry[]>([]);
	const [selected, setSelected] = useState<IptvEntry>();
	const [kind, setKind] = useState("live");
	const [query, setQuery] = useState("");
	const [group, setGroup] = useState("");
	const [page, setPage] = useState(0);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [native, setNative] = useState(false);
	const pending = useRef<AbortController>(null);
	const search = useDeferredValue(query.trim().toLowerCase());
	const section = entries.filter((entry) => entry.vod === (kind === "vod"));
	const groups = [...new Set(section.map((entry) => entry.group).filter(Boolean))].sort();
	const filtered = section.filter(
		(entry) => (!group || entry.group === group) && entry.title.toLowerCase().includes(search),
	);

	useEffect(() => {
		setNative(isNativeShell());
		return () => pending.current?.abort();
	}, []);

	async function load(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const controller = new AbortController();
		pending.current?.abort();
		pending.current = controller;
		setBusy(true);
		setMessage("");
		try {
			const source = Object.fromEntries(new FormData(form));
			const response = await fetch("/api/iptv", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...source, mode }),
				signal: controller.signal,
			});
			if (response.status === 503) {
				setMessage("iptv.disabled");
				return;
			}
			if (!response.ok) throw new Error();
			const catalog: IptvEntry[] = await response.json();
			setEntries(catalog);
			setSelected(undefined);
			setKind(catalog.some((entry) => !entry.vod) ? "live" : "vod");
			setGroup("");
			setQuery("");
			setPage(0);
			form.reset();
			if (!catalog.length) setMessage("iptv.empty");
		} catch {
			if (!controller.signal.aborted) setMessage("iptv.loadError");
		} finally {
			if (!controller.signal.aborted) setBusy(false);
		}
	}

	return (
		<section className="page-wrap grid gap-5 py-8">
			<h1 className="text-3xl font-bold">IPTV</h1>
			{native ? (
				<p>{t("iptv.native")}</p>
			) : (
				<form method="post" onSubmit={load} autoComplete="off" className="grid max-w-xl gap-3">
					<label className="grid gap-1">
						{t("iptv.source")}
						<select
							className={field}
							value={mode}
							disabled={busy}
							onChange={(event) => setMode(event.target.value)}
						>
							<option value="m3u">M3U URL</option>
							<option value="xtream">Xtream Codes</option>
						</select>
					</label>
					{mode === "xtream" ? (
						<>
							<label className="grid gap-1">
								{t("iptv.server")}
								<input name="server" type="url" className={field} required />
							</label>
							<label className="grid gap-1">
								{t("iptv.username")}
								<input name="username" className={field} required />
							</label>
							<label className="grid gap-1">
								{t("iptv.password")}
								<input name="password" type="password" className={field} required />
							</label>
						</>
					) : (
						<label className="grid gap-1">
							M3U URL
							<input name="playlist" type="password" className={field} required />
						</label>
					)}
					<button type="submit" className="nav-pill justify-self-start" disabled={busy}>
						{t(busy ? "iptv.loading" : "iptv.connect")}
					</button>
				</form>
			)}
			{message && <p role="status">{t(message)}</p>}
			{selected && (
				<IptvPlayer key={selected.src} entry={selected} close={() => setSelected(undefined)} />
			)}
			{entries.length > 0 && (
				<>
					<div className="flex flex-wrap items-end gap-3">
						<label className="grid gap-1">
							{t("iptv.catalog")}
							<select
								className={field}
								value={kind}
								onChange={(event) => {
									setKind(event.target.value);
									setGroup("");
									setPage(0);
								}}
							>
								<option value="live">{t("iptv.live")}</option>
								<option value="vod">{t("iptv.vod")}</option>
							</select>
						</label>
						<label className="grid gap-1">
							{t("iptv.groups")}
							<select
								className={field}
								value={group}
								onChange={(event) => {
									setGroup(event.target.value);
									setPage(0);
								}}
							>
								<option value="">{t("iptv.allGroups")}</option>
								{groups.map((value) => (
									<option key={value}>{value}</option>
								))}
							</select>
						</label>
						<label className="grid gap-1">
							{t("iptv.search")}
							<input
								className={field}
								type="search"
								value={query}
								onChange={(event) => {
									setQuery(event.target.value);
									setPage(0);
								}}
							/>
						</label>
					</div>
					{filtered.length === 0 && <p>{t("iptv.noResults")}</p>}
					<ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{filtered.slice(page * pageSize, (page + 1) * pageSize).map((entry) => (
							<li key={entry.src}>
								<button
									type="button"
									data-tv-focusable="true"
									aria-pressed={selected === entry}
									className="nav-pill w-full justify-start text-left"
									onClick={() => setSelected(entry)}
								>
									{entry.title}
								</button>
							</li>
						))}
					</ul>
					{filtered.length > pageSize && (
						<div className="flex items-center gap-3">
							<button
								type="button"
								className="nav-pill"
								disabled={page === 0}
								onClick={() => setPage(page - 1)}
							>
								{t("iptv.previous")}
							</button>
							<span>
								{page + 1} / {Math.ceil(filtered.length / pageSize)}
							</span>
							<button
								type="button"
								className="nav-pill"
								disabled={(page + 1) * pageSize >= filtered.length}
								onClick={() => setPage(page + 1)}
							>
								{t("iptv.next")}
							</button>
						</div>
					)}
				</>
			)}
		</section>
	);
}

function IptvPlayer({ entry, close }: { entry: IptvEntry; close: () => void }) {
	const { t } = useI18n();
	const video = useRef<HTMLVideoElement>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const element = video.current;
		if (!element) return;
		element.scrollIntoView({ block: "nearest" });
		let disposed = false;
		let destroy: (() => void) | undefined;
		const fail = () => {
			if (!disposed) setFailed(true);
		};
		async function attach(media: HTMLVideoElement) {
			if (entry.format === "hls" && !media.canPlayType("application/vnd.apple.mpegurl")) {
				const { default: Hls } = await import("hls.js");
				if (disposed) return;
				if (!Hls.isSupported()) return fail();
				const player = new Hls();
				destroy = () => player.destroy();
				player.on(Hls.Events.ERROR, (_, data) => {
					if (data.fatal) fail();
				});
				player.attachMedia(media);
				player.loadSource(entry.src);
			} else if (entry.format === "ts" && !media.canPlayType("video/mp2t")) {
				const { default: mpegts } = await import("mpegts.js");
				if (disposed) return;
				if (!mpegts.getFeatureList().mseLivePlayback) return fail();
				const player = mpegts.createPlayer({ type: "mpegts", isLive: !entry.vod, url: entry.src });
				destroy = () => player.destroy();
				player.on(mpegts.Events.ERROR, fail);
				player.attachMediaElement(media);
				player.load();
			} else {
				media.src = entry.src;
			}
			void media.play().catch(() => {});
		}
		void attach(element).catch(fail);
		return () => {
			disposed = true;
			destroy?.();
			element.removeAttribute("src");
			element.load();
		};
	}, [entry]);

	return (
		<div className="grid gap-2">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-xl font-semibold">{entry.title}</h2>
				<button type="button" className="nav-pill" onClick={close}>
					{t("iptv.close")}
				</button>
			</div>

			<video
				ref={video}
				controls
				playsInline
				className="max-h-[65vh] w-full bg-black"
				onError={() => setFailed(true)}
			/>
			{failed && <p role="alert">{t("iptv.playError")}</p>}
		</div>
	);
}
