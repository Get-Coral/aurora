import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowLeft, Film, KeyRound, Trash2, Upload, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import {
	fetchAvatarCandidatesRuntime,
	fetchCurrentProfileRuntime,
	fetchSetupStatusRuntime,
	removeAvatarRuntime,
	setAvatarFromLibraryRuntime,
	updateCurrentProfilePasswordRuntime,
	uploadAvatarRuntime,
} from "../lib/runtime-functions";

type AvatarTab = "upload" | "posters" | "actors";

async function processAvatarFile(file: File): Promise<{ dataBase64: string; contentType: string }> {
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(new Error("Could not read the selected file."));
		reader.readAsDataURL(file);
	});

	const image = await new Promise<HTMLImageElement>((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Could not load the selected image."));
		img.src = dataUrl;
	});

	const side = Math.min(image.naturalWidth, image.naturalHeight);
	const target = Math.min(512, side || 512);
	const canvas = document.createElement("canvas");
	canvas.width = target;
	canvas.height = target;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Canvas is not supported in this browser.");
	}

	const sx = (image.naturalWidth - side) / 2;
	const sy = (image.naturalHeight - side) / 2;
	ctx.drawImage(image, sx, sy, side, side, 0, 0, target, target);

	const blob = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob(resolve, "image/jpeg", 0.9);
	});
	if (!blob) {
		throw new Error("Could not process the selected image.");
	}

	const buffer = await blob.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i]);
	}

	return { dataBase64: btoa(binary), contentType: "image/jpeg" };
}

export const Route = createFileRoute("/profile")({
	loader: async () => {
		const setupStatus = await fetchSetupStatusRuntime();
		if (!setupStatus?.configured) {
			throw redirect({ to: "/setup" });
		}
		return setupStatus;
	},
	component: ProfilePage,
});

function ProfilePage() {
	const { t } = useI18n();
	const queryClient = useQueryClient();
	const { data: profile } = useQuery({
		queryKey: ["current-profile"],
		queryFn: () => fetchCurrentProfileRuntime(),
	});
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

	const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
	const [avatarTab, setAvatarTab] = useState<AvatarTab>("upload");
	const fileInputRef = useRef<HTMLInputElement>(null);

	const refreshAvatar = () => {
		// Prefix match also refreshes the header's ["current-profile", userId] query.
		queryClient.invalidateQueries({ queryKey: ["current-profile"] });
	};

	const candidatesQuery = useQuery({
		queryKey: ["avatar-candidates"],
		queryFn: () => fetchAvatarCandidatesRuntime(),
		enabled: avatarPickerOpen,
	});

	const uploadMutation = useMutation({
		mutationFn: async (file: File) => {
			const processed = await processAvatarFile(file);
			return uploadAvatarRuntime(processed);
		},
		onSuccess: () => {
			refreshAvatar();
			setAvatarPickerOpen(false);
		},
	});

	const libraryMutation = useMutation({
		mutationFn: async (input: { sourceType: "item" | "person"; sourceId: string }) =>
			setAvatarFromLibraryRuntime(input),
		onSuccess: () => {
			refreshAvatar();
			setAvatarPickerOpen(false);
		},
	});

	const removeMutation = useMutation({
		mutationFn: async () => removeAvatarRuntime(),
		onSuccess: () => {
			refreshAvatar();
			setAvatarPickerOpen(false);
		},
	});

	const avatarBusy =
		uploadMutation.isPending || libraryMutation.isPending || removeMutation.isPending;
	const avatarError = uploadMutation.error ?? libraryMutation.error ?? removeMutation.error;

	const passwordMismatch =
		newPassword.trim().length > 0 &&
		confirmPassword.trim().length > 0 &&
		newPassword !== confirmPassword;

	const passwordMutation = useMutation({
		mutationFn: async () =>
			updateCurrentProfilePasswordRuntime({
				currentPassword,
				newPassword,
			}),
		onSuccess: () => {
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		},
	});

	return (
		<main className="library-shell">
			<div className="page-wrap library-head">
				<div className="library-copy">
					<Link to="/" className="library-backlink">
						<ArrowLeft size={16} /> {t("profile.back")}
					</Link>
					<p className="eyebrow">{t("profile.eyebrow")}</p>
					<h1 className="library-title">{t("profile.title")}</h1>
					<p className="admin-server-meta">{t("profile.subtitle")}</p>
				</div>
			</div>

			<div
				className="page-wrap"
				style={{
					display: "grid",
					gap: "1.5rem",
					paddingTop: "2rem",
					paddingBottom: "4rem",
					maxWidth: "48rem",
					marginInline: "auto",
				}}
			>
				<section className="overview-card profile-card">
					<div className="profile-identity-row">
						<div className="profile-avatar-shell">
							{profile?.imageUrl ? (
								<img src={profile.imageUrl} alt={profile.name} className="profile-avatar-image" />
							) : (
								<div className="profile-avatar-fallback">
									{profile?.name?.slice(0, 2).toUpperCase() || "??"}
								</div>
							)}
						</div>
						<div>
							<p className="eyebrow">{t("profile.currentProfile")}</p>
							<h2 className="profile-name">{profile?.name ?? t("header.profileFallback")}</h2>
							<div className="avatar-actions">
								<button
									type="button"
									className="secondary-action avatar-change-btn"
									onClick={() => setAvatarPickerOpen((open) => !open)}
									aria-expanded={avatarPickerOpen}
								>
									{t("profile.avatar.change")}
								</button>
								{profile?.imageUrl ? (
									<button
										type="button"
										className="avatar-remove-btn"
										onClick={() => removeMutation.mutate()}
										disabled={avatarBusy}
									>
										<Trash2 size={14} /> {t("profile.avatar.remove")}
									</button>
								) : null}
							</div>
						</div>
					</div>

					{avatarPickerOpen ? (
						<div className="avatar-picker">
							<p className="profile-copy">{t("profile.avatar.copy")}</p>
							<div className="avatar-tabs" role="tablist" aria-label={t("profile.avatar.title")}>
								<button
									type="button"
									role="tab"
									aria-selected={avatarTab === "upload"}
									className={`avatar-tab ${avatarTab === "upload" ? "is-active" : ""}`}
									onClick={() => setAvatarTab("upload")}
								>
									<Upload size={15} /> {t("profile.avatar.upload")}
								</button>
								<button
									type="button"
									role="tab"
									aria-selected={avatarTab === "posters"}
									className={`avatar-tab ${avatarTab === "posters" ? "is-active" : ""}`}
									onClick={() => setAvatarTab("posters")}
								>
									<Film size={15} /> {t("profile.avatar.fromPosters")}
								</button>
								<button
									type="button"
									role="tab"
									aria-selected={avatarTab === "actors"}
									className={`avatar-tab ${avatarTab === "actors" ? "is-active" : ""}`}
									onClick={() => setAvatarTab("actors")}
								>
									<UserRound size={15} /> {t("profile.avatar.fromActors")}
								</button>
							</div>

							{avatarTab === "upload" ? (
								<div className="avatar-upload">
									<input
										ref={fileInputRef}
										type="file"
										accept="image/*"
										className="avatar-file-input"
										onChange={(e) => {
											const file = e.target.files?.[0];
											if (file) {
												uploadMutation.mutate(file);
											}
											e.target.value = "";
										}}
									/>
									<button
										type="button"
										className="primary-action"
										disabled={avatarBusy}
										onClick={() => fileInputRef.current?.click()}
									>
										{uploadMutation.isPending
											? t("profile.avatar.saving")
											: t("profile.avatar.uploadCta")}
									</button>
									<p className="profile-copy avatar-hint">{t("profile.avatar.uploadHint")}</p>
								</div>
							) : null}

							{avatarTab === "posters" ? (
								<AvatarCandidateGrid
									loading={candidatesQuery.isLoading}
									loadingLabel={t("profile.avatar.loading")}
									emptyLabel={t("profile.avatar.postersEmpty")}
									busy={avatarBusy}
									items={(candidatesQuery.data?.posters ?? []).map((poster) => ({
										id: poster.itemId,
										name: poster.name,
										imageUrl: poster.imageUrl,
										onSelect: () =>
											libraryMutation.mutate({ sourceType: "item", sourceId: poster.itemId }),
									}))}
									variant="poster"
								/>
							) : null}

							{avatarTab === "actors" ? (
								<AvatarCandidateGrid
									loading={candidatesQuery.isLoading}
									loadingLabel={t("profile.avatar.loading")}
									emptyLabel={t("profile.avatar.actorsEmpty")}
									busy={avatarBusy}
									items={(candidatesQuery.data?.people ?? []).map((person) => ({
										id: person.personId,
										name: person.name,
										role: person.role,
										imageUrl: person.imageUrl,
										onSelect: () =>
											libraryMutation.mutate({ sourceType: "person", sourceId: person.personId }),
									}))}
									variant="person"
								/>
							) : null}

							{avatarError ? (
								<p className="detail-empty">
									{avatarError instanceof Error ? avatarError.message : t("profile.avatar.error")}
								</p>
							) : null}
						</div>
					) : null}
				</section>

				<section className="overview-card profile-card">
					<div className="profile-section-head">
						<KeyRound size={16} />
						<h2>{t("profile.passwordTitle")}</h2>
					</div>
					<p className="profile-copy">{t("profile.passwordCopy")}</p>
					<form
						className="profile-form"
						onSubmit={(e) => {
							e.preventDefault();
							if (passwordMismatch || !newPassword.trim()) return;
							passwordMutation.mutate();
						}}
					>
						<label className="library-select-shell">
							<span>{t("profile.currentPassword")}</span>
							<input
								type="password"
								className="library-select"
								style={{ width: "100%" }}
								value={currentPassword}
								onChange={(e) => setCurrentPassword(e.target.value)}
								placeholder={t("profile.currentPasswordPlaceholder")}
							/>
						</label>
						<label className="library-select-shell">
							<span>{t("profile.newPassword")}</span>
							<input
								type="password"
								className="library-select"
								style={{ width: "100%" }}
								value={newPassword}
								onChange={(e) => setNewPassword(e.target.value)}
							/>
						</label>
						<label className="library-select-shell">
							<span>{t("profile.confirmPassword")}</span>
							<input
								type="password"
								className="library-select"
								style={{ width: "100%" }}
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
							/>
						</label>
						{passwordMismatch ? (
							<p className="detail-empty">{t("profile.passwordMismatch")}</p>
						) : null}
						{passwordMutation.error ? (
							<p className="detail-empty">
								{passwordMutation.error instanceof Error
									? passwordMutation.error.message
									: t("profile.error")}
							</p>
						) : null}
						{passwordMutation.isSuccess ? (
							<p className="eyebrow" style={{ opacity: 0.7 }}>
								{t("profile.saved")}
							</p>
						) : null}
						<button
							type="submit"
							className="primary-action"
							disabled={passwordMutation.isPending || passwordMismatch || !newPassword.trim()}
						>
							{passwordMutation.isPending ? t("profile.saving") : t("profile.savePassword")}
						</button>
					</form>
				</section>
			</div>
		</main>
	);
}

interface AvatarCandidateGridItem {
	id: string;
	name: string;
	role?: string;
	imageUrl: string;
	onSelect: () => void;
}

function AvatarCandidateGrid({
	items,
	loading,
	loadingLabel,
	emptyLabel,
	busy,
	variant,
}: {
	items: AvatarCandidateGridItem[];
	loading: boolean;
	loadingLabel: string;
	emptyLabel: string;
	busy: boolean;
	variant: "poster" | "person";
}) {
	if (loading) {
		return <p className="detail-empty">{loadingLabel}</p>;
	}

	if (items.length === 0) {
		return <p className="detail-empty">{emptyLabel}</p>;
	}

	return (
		<ul className={`avatar-grid avatar-grid-${variant}`}>
			{items.map((item) => (
				<li key={item.id}>
					<button
						type="button"
						className="avatar-candidate"
						onClick={item.onSelect}
						disabled={busy}
						title={item.role ? `${item.name} — ${item.role}` : item.name}
					>
						<img src={item.imageUrl} alt={item.name} loading="lazy" />
						<span className="avatar-candidate-name">{item.name}</span>
					</button>
				</li>
			))}
		</ul>
	);
}
