import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Trash2, Tv } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useI18n } from "../lib/i18n";
import type { IptvSourceInput, IptvSourceKind, IptvSourceSummary } from "../lib/iptv/source";
import {
	deleteIptvSourceRuntime,
	fetchIptvSourcesRuntime,
	refreshIptvSourceRuntime,
	saveIptvSourceRuntime,
} from "../lib/runtime-functions";

type Translate = ReturnType<typeof useI18n>["t"];

/** Server errors carry an i18n key, optionally with `:status`. */
function errorMessage(t: Translate, error: unknown) {
	const message = error instanceof Error ? error.message : "";
	const [key, status] = message.split(":");
	if (key?.startsWith("iptv.")) return t(key, { status });
	return t("iptv.loadError");
}

const field = { width: "100%" } as const;

function SourceForm({ source, onDone }: { source?: IptvSourceSummary; onDone: () => void }) {
	const { t } = useI18n();
	const queryClient = useQueryClient();
	const [kind, setKind] = useState<IptvSourceKind>(source?.kind ?? "xtream");
	const save = useMutation({
		mutationFn: (input: IptvSourceInput) =>
			saveIptvSourceRuntime({ id: source?.id, source: input }),
		onSuccess: () => {
			void queryClient.invalidateQueries();
			onDone();
		},
	});

	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const value = (name: string) => String(data.get(name) ?? "").trim();
		save.mutate({
			kind,
			name: value("name"),
			url: value("url"),
			username: value("username"),
			password: String(data.get("password") ?? ""),
			epgUrl: value("epgUrl"),
		});
	}

	const editing = Boolean(source);
	return (
		<form className="iptv-source-form" onSubmit={submit} autoComplete="off">
			<label className="library-select-shell">
				<span>{t("iptv.source")}</span>
				<select
					className="library-select"
					style={field}
					value={kind}
					disabled={save.isPending}
					onChange={(event) => setKind(event.target.value as IptvSourceKind)}
				>
					<option value="xtream">Xtream Codes</option>
					<option value="m3u">{t("iptv.m3u")}</option>
					<option value="direct">{t("iptv.direct")}</option>
				</select>
			</label>
			<label className="library-select-shell">
				<span>{t("iptv.name")}</span>
				<input
					name="name"
					className="library-select"
					style={field}
					defaultValue={source?.name}
					placeholder={t("iptv.namePlaceholder")}
				/>
			</label>
			<label className="library-select-shell">
				<span>
					{kind === "xtream" ? t("iptv.server") : kind === "m3u" ? t("iptv.m3u") : t("iptv.direct")}
				</span>
				<input
					name="url"
					type={kind === "xtream" ? "url" : "password"}
					className="library-select"
					style={field}
					required={!editing || kind !== source?.kind}
					placeholder={
						editing
							? t("iptv.keepUrl")
							: kind === "xtream"
								? "http://provider.example"
								: "https://…"
					}
				/>
			</label>
			{kind === "xtream" ? (
				<>
					<label className="library-select-shell">
						<span>{t("iptv.username")}</span>
						<input
							name="username"
							className="library-select"
							style={field}
							defaultValue={source?.username}
							required
						/>
					</label>
					<label className="library-select-shell">
						<span>{t("iptv.password")}</span>
						<input
							name="password"
							type="password"
							className="library-select"
							style={field}
							required={!editing}
							placeholder={editing ? t("iptv.keepPassword") : undefined}
						/>
					</label>
				</>
			) : null}
			{kind !== "direct" ? (
				<label className="library-select-shell">
					<span>{t("iptv.epgUrl")}</span>
					<input
						name="epgUrl"
						type="url"
						className="library-select"
						style={field}
						placeholder={t("iptv.epgPlaceholder")}
					/>
				</label>
			) : null}
			<p className="settings-locked-note">{t(`iptv.hint.${kind}`)}</p>
			{save.error ? <p className="detail-empty">{errorMessage(t, save.error)}</p> : null}
			<div className="iptv-source-actions">
				<button type="submit" className="primary-action" disabled={save.isPending}>
					{save.isPending ? t("iptv.checking") : editing ? t("settings.save") : t("iptv.add")}
				</button>
				<button
					type="button"
					className="secondary-action"
					onClick={onDone}
					disabled={save.isPending}
				>
					{t("iptv.cancel")}
				</button>
			</div>
		</form>
	);
}

/** Settings card: add, edit, refresh and remove IPTV sources. */
export function IptvSourcesSection() {
	const { t } = useI18n();
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState<string | "new" | null>(null);
	const { data, isLoading } = useQuery({
		queryKey: ["iptv-sources"],
		queryFn: () => fetchIptvSourcesRuntime(),
	});
	const refresh = useMutation({
		mutationFn: (id: string) => refreshIptvSourceRuntime(id),
		onSuccess: () => void queryClient.invalidateQueries(),
	});
	const remove = useMutation({
		mutationFn: (id: string) => deleteIptvSourceRuntime(id),
		onSuccess: () => void queryClient.invalidateQueries(),
	});
	const sources = data?.sources ?? [];

	return (
		<section id="sources" className="overview-card" style={{ padding: "2rem", gap: "1.25rem" }}>
			<div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
				<p className="eyebrow">{t("iptv.sourcesSection")}</p>
				<p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.9rem", lineHeight: 1.6 }}>
					{t("iptv.sourcesCopy")}
				</p>
			</div>

			{data && !data.enabled ? <p className="settings-locked-note">{t("iptv.disabled")}</p> : null}
			{isLoading ? <p className="settings-locked-note">{t("search.searching")}</p> : null}

			{sources.length ? (
				<ul className="iptv-source-list">
					{sources.map((source) => (
						<li key={source.id}>
							{editing === source.id ? (
								<SourceForm source={source} onDone={() => setEditing(null)} />
							) : (
								<div className="iptv-source-row">
									<Tv size={18} aria-hidden="true" />
									<div className="iptv-source-copy">
										<strong>{source.name}</strong>
										<span>
											{[
												source.kind === "xtream"
													? "Xtream Codes"
													: source.kind === "m3u"
														? t("iptv.m3u")
														: t("iptv.direct"),
												source.host,
												source.username,
											]
												.filter(Boolean)
												.join(" · ")}
										</span>
										{refresh.variables === source.id && refresh.data ? (
											<span>
												{t("iptv.counts", {
													live: refresh.data.live,
													movies: refresh.data.movies,
													series: refresh.data.series,
												})}
											</span>
										) : null}
										{refresh.variables === source.id && refresh.error ? (
											<span className="detail-empty">{errorMessage(t, refresh.error)}</span>
										) : null}
									</div>
									<div className="iptv-source-buttons">
										<button
											type="button"
											className="icon-button"
											aria-label={t("iptv.refresh")}
											title={t("iptv.refresh")}
											disabled={refresh.isPending}
											onClick={() => refresh.mutate(source.id)}
											data-tv-focusable="true"
										>
											<RefreshCw
												size={16}
												className={
													refresh.isPending && refresh.variables === source.id ? "spin" : undefined
												}
											/>
										</button>
										<button
											type="button"
											className="icon-button"
											aria-label={t("iptv.edit")}
											title={t("iptv.edit")}
											onClick={() => setEditing(source.id)}
											data-tv-focusable="true"
										>
											<Pencil size={16} />
										</button>
										<button
											type="button"
											className="icon-button"
											aria-label={t("iptv.remove")}
											title={t("iptv.remove")}
											disabled={remove.isPending}
											onClick={() => {
												if (window.confirm(t("iptv.removeConfirm", { name: source.name })))
													remove.mutate(source.id);
											}}
											data-tv-focusable="true"
										>
											<Trash2 size={16} />
										</button>
									</div>
								</div>
							)}
						</li>
					))}
				</ul>
			) : null}

			{editing === "new" ? (
				<SourceForm onDone={() => setEditing(null)} />
			) : data?.enabled !== false ? (
				<button
					type="button"
					className="secondary-action"
					style={{ justifySelf: "start" }}
					onClick={() => setEditing("new")}
					data-tv-focusable="true"
				>
					<Plus size={16} /> {t("iptv.addSource")}
				</button>
			) : null}
		</section>
	);
}
