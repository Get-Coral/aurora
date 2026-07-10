import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useI18n } from "../lib/i18n";
import {
	fetchAdminUsersRuntime,
	fetchAuthStatusRuntime,
	fetchMultiUserSettingsRuntime,
	fetchSetupStatusRuntime,
	loginRuntime,
	setActiveUserRuntime,
} from "../lib/runtime-functions";

const IS_PRERENDER_BUILD = process.env.TSS_PRERENDERING === "true";

export const Route = createFileRoute("/profiles")({
	loader: async () => {
		if (IS_PRERENDER_BUILD) {
			return {
				users: [],
				activeUserId: null,
				auth: { required: false, userId: null as string | null },
			};
		}

		const setupStatus = await fetchSetupStatusRuntime();
		if (!setupStatus.configured) {
			throw redirect({ to: "/setup" });
		}

		const multiUser = await fetchMultiUserSettingsRuntime();
		if (!multiUser.multiUserMode) {
			throw redirect({ to: "/" });
		}

		const auth = await fetchAuthStatusRuntime();
		const users = await fetchAdminUsersRuntime();
		return {
			users,
			activeUserId: multiUser.activeUserId,
			auth: { required: auth.required, userId: auth.userId },
		};
	},
	component: ProfilesPage,
});

type AdminUser = {
	id: string;
	name: string;
	imageUrl?: string;
	isAdmin: boolean;
	isDisabled: boolean;
	lastLoginDate: string | null;
	hasPolicy: boolean;
};

function ProfilesPage() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const loaderData = Route.useLoaderData();
	const users = (loaderData?.users ?? []) as AdminUser[];
	const activeUserId = loaderData?.activeUserId ?? null;
	const auth = loaderData?.auth ?? { required: false, userId: null };
	const [selecting, setSelecting] = useState<string | null>(null);
	const [pendingUser, setPendingUser] = useState<AdminUser | null>(null);
	const [password, setPassword] = useState("");

	const selectMutation = useMutation({
		mutationFn: async (userId: string) => {
			setSelecting(userId);
			await setActiveUserRuntime(userId);
		},
		onSuccess: async () => {
			await navigate({ to: "/" });
		},
		onError: () => {
			setSelecting(null);
		},
	});

	const loginMutation = useMutation({
		mutationFn: async (user: AdminUser) => {
			setSelecting(user.id);
			await loginRuntime({ username: user.name, password });
		},
		onSuccess: () => {
			// Full reload so everything refetches with the new session cookie.
			window.location.assign("/");
		},
		onError: () => {
			setSelecting(null);
		},
	});

	const isPending = selectMutation.isPending || loginMutation.isPending;

	function needsPassword(user: AdminUser) {
		return auth.required && user.id !== auth.userId;
	}

	function handleSelect(user: AdminUser) {
		if (needsPassword(user)) {
			setPendingUser(user);
			setPassword("");
			loginMutation.reset();
			return;
		}
		setPendingUser(null);
		selectMutation.mutate(user.id);
	}

	const error = loginMutation.error ?? selectMutation.error;

	return (
		<div className="profiles-shell">
			<div className="profiles-wordmark">aurora</div>

			<div className="profiles-content">
				<h1 className="profiles-title">{t("profiles.title")}</h1>

				<div className="profiles-grid">
					{users.map((user) => {
						const isActive = user.id === activeUserId;
						const isSelecting = selecting === user.id;
						return (
							<button
								key={user.id}
								type="button"
								className={`profiles-card${isActive ? " active" : ""}${user.isDisabled ? " disabled" : ""}`}
								disabled={user.isDisabled || isPending}
								onClick={() => handleSelect(user)}
							>
								<div className="profiles-avatar">
									{isSelecting ? (
										<span className="profiles-avatar-spinner" />
									) : user.imageUrl ? (
										<img src={user.imageUrl} alt={user.name} className="profiles-avatar-image" />
									) : (
										(user.name ?? "?").slice(0, 2).toUpperCase()
									)}
								</div>
								<span className="profiles-name">{user.name}</span>
								{isActive && <span className="profiles-active-badge">{t("profiles.active")}</span>}
								{user.isDisabled && (
									<span className="profiles-disabled-badge">{t("profiles.disabled")}</span>
								)}
							</button>
						);
					})}
				</div>

				{pendingUser ? (
					<form
						style={{
							display: "flex",
							flexDirection: "column",
							gap: "0.75rem",
							maxWidth: "20rem",
							marginInline: "auto",
							marginTop: "1.5rem",
						}}
						onSubmit={(e) => {
							e.preventDefault();
							if (!loginMutation.isPending) loginMutation.mutate(pendingUser);
						}}
					>
						<div className="setup-field">
							<label htmlFor="profile-password">
								{t("profiles.passwordFor", { name: pendingUser.name })}
							</label>
							<input
								id="profile-password"
								type="password"
								className="setup-input"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								autoComplete="current-password"
								autoFocus
							/>
						</div>
						<div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
							<button
								type="button"
								className="setup-back-btn"
								onClick={() => setPendingUser(null)}
								disabled={loginMutation.isPending}
							>
								{t("profiles.passwordCancel")}
							</button>
							<button type="submit" className="setup-next-btn" disabled={loginMutation.isPending}>
								{loginMutation.isPending
									? t("profiles.passwordChecking")
									: t("profiles.passwordSubmit")}
							</button>
						</div>
					</form>
				) : null}

				{error ? (
					<p className="profiles-error">
						{error instanceof Error ? error.message : "Could not select profile."}
					</p>
				) : null}
			</div>
		</div>
	);
}
