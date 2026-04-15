import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { MediaPlayerDialog } from "../../components/MediaPlayerDialog";
import { MediaSpotlightDialog } from "../../components/MediaSpotlightDialog";
import { useFavoriteAction } from "../../components/useFavoriteAction";
import { useI18n } from "../../lib/i18n";
import type { MediaItem } from "../../lib/media";
import {
	createCollectionRuntime,
	deleteCollectionRuntime,
	fetchCollectionsRuntime,
	fetchSetupStatusRuntime,
	renameCollectionRuntime,
} from "../../lib/runtime-functions";
import { useTvMode } from "../../lib/tv-mode";

export const Route = createFileRoute("/collections/")({
	loader: async ({ context: { queryClient } }) => {
		const setupStatus = await fetchSetupStatusRuntime();
		if (!setupStatus.configured) throw redirect({ to: "/setup" });
		await queryClient.ensureQueryData({
			queryKey: ["collections"],
			queryFn: () => fetchCollectionsRuntime(),
		});
	},
	component: CollectionsPage,
});

type Dialog =
	| { type: "create" }
	| { type: "rename"; id: string; currentName: string }
	| { type: "delete"; id: string; name: string };

function CollectionsPage() {
	const { t } = useI18n();
	const { tvMode } = useTvMode();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: collections = [] } = useSuspenseQuery({
		queryKey: ["collections"],
		queryFn: () => fetchCollectionsRuntime(),
	});
	const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
	const [playingItem, setPlayingItem] = useState<MediaItem | null>(null);
	const [dialog, setDialog] = useState<Dialog | null>(null);
	const [nameInput, setNameInput] = useState("");
	const nameRef = useRef<HTMLInputElement>(null);
	const favoriteMutation = useFavoriteAction();

	function handleToggleFavorite(item: MediaItem) {
		setSelectedItem((current) =>
			current?.id === item.id ? { ...current, isFavorite: !current.isFavorite } : current,
		);
		favoriteMutation.mutate({ id: item.id, isFavorite: Boolean(item.isFavorite) });
	}

	const createMutation = useMutation({
		mutationFn: () => createCollectionRuntime({ data: { name: nameInput.trim() } }),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({ queryKey: ["collections"] });
			setDialog(null);
			setNameInput("");
			void navigate({ to: "/collections/$id", params: { id: result.Id } });
		},
	});

	const renameMutation = useMutation({
		mutationFn: ({ id }: { id: string }) =>
			renameCollectionRuntime({ data: { id, name: nameInput.trim() } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["collections"] });
			setDialog(null);
			setNameInput("");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: ({ id }: { id: string }) => deleteCollectionRuntime({ data: { id } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["collections"] });
			setDialog(null);
		},
	});

	function openCreate() {
		setNameInput("");
		setDialog({ type: "create" });
		setTimeout(() => nameRef.current?.focus(), 50);
	}

	function openRename(id: string, currentName: string) {
		setNameInput(currentName);
		setDialog({ type: "rename", id, currentName });
		setTimeout(() => nameRef.current?.focus(), 50);
	}

	return (
		<main className="library-shell">
			<div className="page-wrap library-head">
				<div className="library-copy">
					<Link to="/" className="library-backlink">
						<ArrowLeft size={16} /> {t("library.backHome")}
					</Link>
					<p className="eyebrow">{t("route.collections.subtitle")}</p>
					<h1 className="library-title">{t("route.collections.title")}</h1>
					<p className="library-summary">{t("route.collections.summary")}</p>
				</div>
				{!tvMode ? (
					<div className="library-controls">
						<button type="button" className="primary-action" onClick={openCreate}>
							<Plus size={16} /> {t("route.collections.new")}
						</button>
					</div>
				) : null}
			</div>

			{collections.length === 0 ? (
				<div className="page-wrap">
					<div className="library-empty">
						<p className="eyebrow">{t("section.readyWhenYouAre")}</p>
						<h3>{t("route.collections.emptyTitle")}</h3>
						<p>{t("route.collections.emptyCopy")}</p>
					</div>
				</div>
			) : (
				<div className="page-wrap collection-grid">
					{collections.map((collection) => (
						<div key={collection.id} className="collection-card-wrap">
							<Link
								to="/collections/$id"
								params={{ id: collection.id }}
								className="collection-card"
							>
								{(collection.backdropUrl ?? collection.posterUrl) ? (
									<img
										src={collection.backdropUrl ?? collection.posterUrl}
										alt={collection.title}
										className="collection-card-thumb"
										loading="lazy"
									/>
								) : (
									<div className="collection-card-thumb collection-card-fallback">
										<Layers size={40} />
									</div>
								)}
								<div className="collection-card-overlay">
									<strong className="collection-card-title">{collection.title}</strong>
									{collection.childCount != null ? (
										<span className="collection-card-count">
											{t("route.collections.itemCount", { count: collection.childCount })}
										</span>
									) : null}
								</div>
							</Link>

							{!tvMode ? (
								<div className="collection-card-actions">
									<button
										type="button"
										className="collection-action-btn"
										onClick={() => openRename(collection.id, collection.title)}
										aria-label={t("route.collections.edit")}
									>
										<Pencil size={14} />
									</button>
									<button
										type="button"
										className="collection-action-btn collection-action-btn-danger"
										onClick={() =>
											setDialog({ type: "delete", id: collection.id, name: collection.title })
										}
										aria-label={t("route.collections.delete")}
									>
										<Trash2 size={14} />
									</button>
								</div>
							) : null}
						</div>
					))}
				</div>
			)}

			{/* ── Create dialog ── */}
			{dialog?.type === "create" ? (
				<div className="coll-dialog-backdrop" onClick={() => setDialog(null)} role="presentation">
					<div
						className="coll-dialog"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
					>
						<div className="coll-dialog-head">
							<h2>{t("route.collections.newTitle")}</h2>
							<button type="button" className="icon-button" onClick={() => setDialog(null)}>
								<X size={16} />
							</button>
						</div>
						<label className="library-select-shell" style={{ width: "100%" }}>
							<span>{t("route.collections.newName")}</span>
							<input
								ref={nameRef}
								className="library-select"
								style={{ width: "100%" }}
								value={nameInput}
								onChange={(e) => setNameInput(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && nameInput.trim() && createMutation.mutate()}
							/>
						</label>
						{createMutation.error ? (
							<p className="detail-empty">{String(createMutation.error)}</p>
						) : null}
						<div className="coll-dialog-footer">
							<button type="button" className="secondary-action" onClick={() => setDialog(null)}>
								<X size={14} /> Cancel
							</button>
							<button
								type="button"
								className="primary-action"
								disabled={!nameInput.trim() || createMutation.isPending}
								onClick={() => createMutation.mutate()}
							>
								<Plus size={14} />
								{createMutation.isPending
									? t("route.collections.creating")
									: t("route.collections.newSubmit")}
							</button>
						</div>
					</div>
				</div>
			) : null}

			{/* ── Rename dialog ── */}
			{dialog?.type === "rename" ? (
				<div className="coll-dialog-backdrop" onClick={() => setDialog(null)} role="presentation">
					<div
						className="coll-dialog"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
					>
						<div className="coll-dialog-head">
							<h2>{t("route.collections.editTitle")}</h2>
							<button type="button" className="icon-button" onClick={() => setDialog(null)}>
								<X size={16} />
							</button>
						</div>
						<label className="library-select-shell" style={{ width: "100%" }}>
							<span>{t("route.collections.newName")}</span>
							<input
								ref={nameRef}
								className="library-select"
								style={{ width: "100%" }}
								value={nameInput}
								onChange={(e) => setNameInput(e.target.value)}
								onKeyDown={(e) =>
									e.key === "Enter" && nameInput.trim() && renameMutation.mutate({ id: dialog.id })
								}
							/>
						</label>
						{renameMutation.error ? (
							<p className="detail-empty">{String(renameMutation.error)}</p>
						) : null}
						<div className="coll-dialog-footer">
							<button type="button" className="secondary-action" onClick={() => setDialog(null)}>
								<X size={14} /> Cancel
							</button>
							<button
								type="button"
								className="primary-action"
								disabled={
									!nameInput.trim() || nameInput === dialog.currentName || renameMutation.isPending
								}
								onClick={() => renameMutation.mutate({ id: dialog.id })}
							>
								{renameMutation.isPending
									? t("route.collections.saving")
									: t("route.collections.editSubmit")}
							</button>
						</div>
					</div>
				</div>
			) : null}

			{/* ── Delete confirm dialog ── */}
			{dialog?.type === "delete" ? (
				<div className="coll-dialog-backdrop" onClick={() => setDialog(null)} role="presentation">
					<div
						className="coll-dialog"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
					>
						<div className="coll-dialog-head">
							<h2>{t("route.collections.deleteTitle")}</h2>
							<button type="button" className="icon-button" onClick={() => setDialog(null)}>
								<X size={16} />
							</button>
						</div>
						<p style={{ color: "var(--ink-muted)", lineHeight: 1.6 }}>
							{t("route.collections.deleteConfirm", { name: dialog.name })}
						</p>
						{deleteMutation.error ? (
							<p className="detail-empty">{String(deleteMutation.error)}</p>
						) : null}
						<div className="coll-dialog-footer">
							<button type="button" className="secondary-action" onClick={() => setDialog(null)}>
								Cancel
							</button>
							<button
								type="button"
								className="primary-action coll-delete-btn"
								disabled={deleteMutation.isPending}
								onClick={() => deleteMutation.mutate({ id: dialog.id })}
							>
								<Trash2 size={14} />
								{deleteMutation.isPending
									? t("route.collections.deleting")
									: t("route.collections.delete")}
							</button>
						</div>
					</div>
				</div>
			) : null}

			<MediaPlayerDialog
				item={playingItem}
				open={playingItem != null}
				onClose={() => setPlayingItem(null)}
			/>

			<MediaSpotlightDialog
				item={selectedItem}
				open={selectedItem != null}
				onClose={() => setSelectedItem(null)}
				onPlay={(item) => {
					if (!item.streamUrl || item.type === "series") return;
					setSelectedItem(null);
					setPlayingItem(item);
				}}
				onSelectSimilar={setSelectedItem}
				onToggleFavorite={handleToggleFavorite}
			/>
		</main>
	);
}
