import "./iptv.css";
import { createFileRoute } from "@tanstack/react-router";
import { Film, Play, SlidersHorizontal, Tv, X } from "lucide-react";
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
	const [sourceOpen, setSourceOpen] = useState(true);
	const [attempt, setAttempt] = useState(0);
	const [entries, setEntries] = useState<IptvEntry[]>([]);
	const [selected, setSelected] = useState<IptvEntry>();
	const [kind, setKind] = useState("live");
	const [query, setQuery] = useState("");
	const [group, setGroup] = useState("");
	const [browseAll, setBrowseAll] = useState(false);
	const [page, setPage] = useState(0);
	const [message, setMessage] = useState("");
	const [providerStatus, setProviderStatus] = useState<number>();
	const [busy, setBusy] = useState(false);
	const [native, setNative] = useState(false);
	const pending = useRef<AbortController>(null);
	const search = useDeferredValue(query.trim().toLowerCase());
	const section = entries.filter((entry) => entry.vod === (kind === "vod"));
	const groups = [...new Set(section.map((entry) => entry.group).filter(Boolean))].sort();
	const illustratedGroups = new Set(
		section.filter((entry) => entry.artwork).map((entry) => entry.group),
	);
	const shelfGroups = [...groups].sort(
		(a, b) => Number(illustratedGroups.has(b)) - Number(illustratedGroups.has(a)),
	);
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
			if (!response.ok) {
				const failure = await response.json().catch(() => null);
				if (failure?.code === "origin") {
					setMessage("iptv.blockedOrigin");
					return;
				}
				if (failure?.code === "provider" && typeof failure.status === "number") {
					setProviderStatus(failure.status);
					setMessage("iptv.providerError");
					return;
				}
				throw new Error();
			}
			const catalog: IptvEntry[] = await response.json();
			setEntries(catalog);
			setSourceOpen(catalog.length === 0);
			setSelected(undefined);
			setBrowseAll(false);
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
		<section className="page-wrap iptv-library">
			<div className="iptv-hero">
				<div className="iptv-hero-copy">
					<h1>{entries.length ? t(kind === "vod" ? "iptv.vod" : "iptv.live") : "IPTV"}</h1>
					{entries.length > 0 && (
						<div className="iptv-tabs" role="group" aria-label={t("iptv.catalog")}>
							{["live", "vod"].map((value) => (
								<button
									type="button"
									className="nav-pill"
									aria-pressed={kind === value}
									key={value}
									onClick={() => {
										setKind(value);
										setBrowseAll(false);
										setGroup("");
										setQuery("");
										setPage(0);
									}}
								>
									{value === "live" ? <Tv size={17} /> : <Film size={17} />}
									{t(value === "live" ? "iptv.live" : "iptv.vod")}
								</button>
							))}
						</div>
					)}
				</div>
				{entries.length > 0 && (
					<button
						type="button"
						className="nav-pill iptv-source-toggle"
						aria-expanded={sourceOpen}
						onClick={() => setSourceOpen(!sourceOpen)}
					>
						<SlidersHorizontal size={17} /> {t("iptv.changeSource")}
					</button>
				)}
			</div>
			{native ? (
				<p>{t("iptv.native")}</p>
			) : (
				sourceOpen && (
					<form method="post" onSubmit={load} autoComplete="off" className="iptv-source grid gap-3">
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
				)
			)}
			{message && <p role="status">{t(message, { status: providerStatus })}</p>}
			{selected && (
				<IptvPlayer
					key={`${selected.src}-${attempt}`}
					entry={selected}
					retry={() => setAttempt(attempt + 1)}
					close={() => setSelected(undefined)}
				/>
			)}
			{entries.length > 0 && (
				<>
					<div className="iptv-filters">
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
					{!browseAll && !group && !search && groups.length > 1 ? (
						<div className="iptv-shelves">
							<button
								className="nav-pill justify-self-end"
								type="button"
								onClick={() => setBrowseAll(true)}
							>
								{t("iptv.viewAll")}
							</button>
							{shelfGroups.slice(0, 5).map((name) => (
								<div key={name}>
									<div className="iptv-row-heading">
										<h2>{name}</h2>
										<button
											type="button"
											className="nav-pill"
											onClick={() => {
												setGroup(name);
												setPage(0);
											}}
										>
											{t("iptv.viewGroup")}
										</button>
									</div>
									<ul className="iptv-shelf">
										{section
											.filter((entry) => entry.group === name)
											.sort((a, b) => Number(Boolean(b.artwork)) - Number(Boolean(a.artwork)))
											.slice(0, 12)
											.map((entry) => (
												<IptvCard key={entry.src} entry={entry} play={() => setSelected(entry)} />
											))}
									</ul>
								</div>
							))}
						</div>
					) : (
						<ul className={kind === "vod" ? "iptv-grid iptv-grid-poster" : "iptv-grid"}>
							{filtered.slice(page * pageSize, (page + 1) * pageSize).map((entry) => (
								<IptvCard key={entry.src} entry={entry} play={() => setSelected(entry)} />
							))}
						</ul>
					)}
					{(browseAll || group || search || groups.length <= 1) && filtered.length > pageSize && (
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

function IptvCard({ entry, play }: { entry: IptvEntry; play: () => void }) {
	const [missing, setMissing] = useState(false);
	return (
		<li>
			<button type="button" className="iptv-card" data-tv-focusable="true" onClick={play}>
				<span className={entry.vod ? "iptv-art iptv-art-poster" : "iptv-art"}>
					{entry.artwork && !missing ? (
						<img
							src={entry.artwork}
							alt=""
							loading="lazy"
							referrerPolicy="no-referrer"
							onError={() => setMissing(true)}
						/>
					) : (
						<span className="iptv-art-placeholder">{entry.vod ? <Film /> : <Tv />}</span>
					)}
					<span className="iptv-card-play" aria-hidden="true">
						<Play size={20} fill="currentColor" />
					</span>
				</span>
				<strong>{entry.title}</strong>
			</button>
		</li>
	);
}

function IptvPlayer({
	entry,
	close,
	retry,
}: {
	entry: IptvEntry;
	close: () => void;
	retry: () => void;
}) {
	const { t } = useI18n();
	const video = useRef<HTMLVideoElement>(null);
	const dialog = useRef<HTMLDialogElement>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const element = video.current;
		if (!element) return;
		dialog.current?.showModal();
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
		<dialog
			className="iptv-player"
			ref={dialog}
			aria-label={entry.title}
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
		>
			<div className="iptv-player-bar">
				<h2>{entry.title}</h2>
				<button
					type="button"
					className="icon-button"
					data-tv-focusable="true"
					aria-label={t("iptv.close")}
					onClick={close}
				>
					<X size={22} />
				</button>
			</div>
			<div className="iptv-screen">
				<video ref={video} controls playsInline onError={() => setFailed(true)} />
				{failed && (
					<div className="iptv-player-error" role="alert">
						<p>{t("iptv.playError")}</p>
						<button type="button" className="nav-pill" onClick={retry}>
							{t("iptv.retry")}
						</button>
					</div>
				)}
			</div>
		</dialog>
	);
}
