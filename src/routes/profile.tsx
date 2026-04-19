import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowLeft, KeyRound } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../lib/i18n";
import {
	fetchCurrentProfileRuntime,
	fetchSetupStatusRuntime,
	updateCurrentProfilePasswordRuntime,
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
	const { data: profile } = useQuery({
		queryKey: ["current-profile"],
		queryFn: () => fetchCurrentProfileRuntime(),
	});
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

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
