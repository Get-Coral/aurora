import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useI18n } from "../lib/i18n";
import {
	fetchAdminUsersRuntime,
	fetchMultiUserSettingsRuntime,
	fetchSetupStatusRuntime,
	setActiveUserRuntime,
} from "../lib/runtime-functions";

const IS_PRERENDER_BUILD = process.env.TSS_PRERENDERING === "true";

export const Route = createFileRoute("/profiles")({
	loader: async () => {
		if (IS_PRERENDER_BUILD) {
			return { users: [], activeUserId: null };
		}

		const setupStatus = await fetchSetupStatusRuntime();
		if (!setupStatus.configured) {
			throw redirect({ to: "/setup" });
		}

		const multiUser = await fetchMultiUserSettingsRuntime();
		if (!multiUser.multiUserMode) {
			throw redirect({ to: "/" });
		}

		const users = await fetchAdminUsersRuntime();
		return { users, activeUserId: multiUser.activeUserId };
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
	const [selecting, setSelecting] = useState<string | null>(null);

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
								disabled={user.isDisabled || selectMutation.isPending}
								onClick={() => selectMutation.mutate(user.id)}
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

				{selectMutation.error ? (
					<p className="profiles-error">
						{selectMutation.error instanceof Error
							? selectMutation.error.message
							: "Could not select profile."}
					</p>
				) : null}
			</div>
		</div>
	);
}
