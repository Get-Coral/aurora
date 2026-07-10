import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../lib/i18n";
import { fetchAuthStatusRuntime, loginRuntime } from "../lib/runtime-functions";

const IS_PRERENDER_BUILD = process.env.TSS_PRERENDERING === "true";

export const Route = createFileRoute("/login")({
	loader: async () => {
		if (IS_PRERENDER_BUILD) return;

		const auth = await fetchAuthStatusRuntime();
		if (!auth.required || auth.authenticated) {
			throw redirect({ to: "/" });
		}
	},
	component: LoginPage,
});

function LoginPage() {
	const { t } = useI18n();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");

	const loginMutation = useMutation({
		mutationFn: () => loginRuntime({ username, password }),
		onSuccess: () => {
			// Full reload so every loader refetches with the new session cookie.
			window.location.assign("/");
		},
	});

	const canSubmit = username.trim().length > 0 && !loginMutation.isPending;

	return (
		<div className="setup-shell">
			<div className="setup-wordmark">aurora</div>

			<div className="setup-flow">
				<div className="setup-card">
					<div className="setup-step-icon">
						<Lock size={22} />
					</div>

					<h1 className="setup-step-title">{t("login.title")}</h1>
					<p className="setup-step-subtitle">{t("login.subtitle")}</p>

					<form
						onSubmit={(e) => {
							e.preventDefault();
							if (canSubmit) loginMutation.mutate();
						}}
					>
						<div className="setup-field">
							<label htmlFor="login-username">{t("login.username")}</label>
							<input
								id="login-username"
								className="setup-input"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								autoComplete="username"
								autoFocus
							/>
						</div>

						<div className="setup-field">
							<label htmlFor="login-password">{t("login.password")}</label>
							<input
								id="login-password"
								type="password"
								className="setup-input"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								autoComplete="current-password"
							/>
						</div>

						<p className="setup-hint">{t("login.hint")}</p>

						{loginMutation.error ? (
							<p className="setup-error">
								{loginMutation.error instanceof Error
									? loginMutation.error.message
									: t("login.errorFallback")}
							</p>
						) : null}

						<div className="setup-actions">
							<button type="submit" className="setup-next-btn" disabled={!canSubmit}>
								{loginMutation.isPending ? t("login.signingIn") : t("login.submit")}
							</button>
						</div>
					</form>
				</div>
			</div>
		</div>
	);
}
