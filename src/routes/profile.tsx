import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowLeft, Image as ImageIcon, KeyRound, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import {
	fetchCurrentProfileRuntime,
	fetchSetupStatusRuntime,
	updateCurrentProfileImageRuntime,
	updateCurrentProfilePasswordRuntime,
	uploadCurrentProfileImageRuntime,
} from "../lib/runtime-functions";

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
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [imageUrl, setImageUrl] = useState("");
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [fileUploadUnsupported, setFileUploadUnsupported] = useState(false);
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

	function isUnsupportedFileUploadError(error: unknown) {
		if (!(error instanceof Error)) return false;
		return error.message.includes("Jellyfin user image upload error");
	}

	const imageMutation = useMutation({
		mutationFn: async () => updateCurrentProfileImageRuntime(imageUrl),
		onSuccess: () => {
			setImageUrl("");
			void queryClient.invalidateQueries({ queryKey: ["current-profile"] });
		},
	});

	const uploadMutation = useMutation({
		mutationFn: async () => {
			if (!selectedFile) {
				throw new Error(t("profile.fileRequired"));
			}
			return uploadCurrentProfileImageRuntime(selectedFile);
		},
		onSuccess: () => {
			setFileUploadUnsupported(false);
			setSelectedFile(null);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
			void queryClient.invalidateQueries({ queryKey: ["current-profile"] });
		},
		onError: (error) => {
			if (!isUnsupportedFileUploadError(error)) return;
			setFileUploadUnsupported(true);
			setSelectedFile(null);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		},
	});

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
						</div>
					</div>
				</section>

				<section className="overview-card profile-card">
					<div className="profile-section-head">
						<ImageIcon size={16} />
						<h2>{t("profile.avatarTitle")}</h2>
					</div>
					<p className="profile-copy">{t("profile.avatarCopy")}</p>
					<form
						className="profile-form"
						onSubmit={(e) => {
							e.preventDefault();
							uploadMutation.mutate();
						}}
					>
							<label className="library-select-shell">
								<span>{t("profile.avatarUpload")}</span>
								<input
									ref={fileInputRef}
									type="file"
									accept="image/png,image/jpeg,image/webp,image/gif"
									className="library-select"
									style={{ width: "100%" }}
									disabled={fileUploadUnsupported || uploadMutation.isPending}
									onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
								/>
							</label>
							{selectedFile ? (
								<p className="profile-file-meta">{selectedFile.name}</p>
							) : (
								<p className="profile-file-meta">{t("profile.avatarUploadHint")}</p>
							)}
							{fileUploadUnsupported ? (
								<p className="profile-inline-note">{t("profile.avatarUploadUnsupported")}</p>
							) : null}
							{uploadMutation.error ? (
								<p className="detail-empty">
									{isUnsupportedFileUploadError(uploadMutation.error)
										? t("profile.avatarUploadUnsupported")
										: uploadMutation.error instanceof Error
										? uploadMutation.error.message
										: t("profile.error")}
								</p>
							) : null}
						{uploadMutation.isSuccess ? (
							<p className="eyebrow" style={{ opacity: 0.7 }}>
								{t("profile.saved")}
							</p>
						) : null}
							<button
								type="submit"
								className="primary-action"
								disabled={fileUploadUnsupported || uploadMutation.isPending || !selectedFile}
							>
								<Upload size={16} />
								{uploadMutation.isPending ? t("profile.saving") : t("profile.uploadAvatar")}
						</button>
					</form>
					<form
						className="profile-form"
						onSubmit={(e) => {
							e.preventDefault();
							imageMutation.mutate();
						}}
					>
						<label className="library-select-shell">
							<span>{t("profile.avatarUrl")}</span>
							<input
								className="library-select"
								style={{ width: "100%" }}
								value={imageUrl}
								onChange={(e) => setImageUrl(e.target.value)}
								placeholder="https://example.com/avatar.jpg"
							/>
						</label>
						{imageMutation.error ? (
							<p className="detail-empty">
								{imageMutation.error instanceof Error
									? imageMutation.error.message
									: t("profile.error")}
							</p>
						) : null}
						{imageMutation.isSuccess ? (
							<p className="eyebrow" style={{ opacity: 0.7 }}>
								{t("profile.saved")}
							</p>
						) : null}
						<button
							type="submit"
							className="primary-action"
							disabled={imageMutation.isPending || !imageUrl.trim()}
						>
							{imageMutation.isPending ? t("profile.saving") : t("profile.saveAvatar")}
						</button>
					</form>
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
