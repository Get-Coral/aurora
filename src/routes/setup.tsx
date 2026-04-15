import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Globe, Key, ArrowLeft, ArrowRight, User } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../lib/i18n";
import { fetchSetupStatusRuntime, saveSetupConfigurationRuntime } from "../lib/runtime-functions";

const IS_PRERENDER_BUILD = process.env["TSS_PRERENDERING"] === "true";

export const Route = createFileRoute("/setup")({
	loader: async () => {
		if (IS_PRERENDER_BUILD) {
			return {
				configured: false,
				source: "missing",
				current: {
					url: "",
					userId: "",
					username: "",
					hasApiKey: false,
					hasPassword: false,
				},
			};
		}

		const setupStatus = await fetchSetupStatusRuntime();

		if (setupStatus.configured) {
			throw redirect({ to: "/" });
		}

		return setupStatus;
	},
	component: SetupPage,
});

const STEPS = [
	{
		id: "server",
		icon: Globe,
		title: "Jellyfin Server",
		subtitle: "Where is your Jellyfin server running?",
		hint: "Enter the full URL of your server, including the port if needed. For example: http://localhost:8096 or https://jellyfin.myhome.net",
	},
	{
		id: "apikey",
		icon: Key,
		title: "API Key",
		subtitle: "Authorize Aurora to talk to Jellyfin",
		hint: "Open your Jellyfin Dashboard → Administration → API Keys and create a new key. Paste it above.",
	},
	{
		id: "account",
		icon: User,
		title: "Your Account",
		subtitle: "Link your Jellyfin account",
		hint: "Aurora uses your credentials to create a real playback session so watch progress stays in sync with Jellyfin.",
	},
] as const;

function SetupPage() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const setupStatus = Route.useLoaderData();

	const [step, setStep] = useState(0);
	const [url, setUrl] = useState(setupStatus.current.url);
	const [apiKey, setApiKey] = useState("");
	const [userId, setUserId] = useState(setupStatus.current.userId);
	const [username, setUsername] = useState(setupStatus.current.username);
	const [password, setPassword] = useState("");

	const setupMutation = useMutation({
		mutationFn: async () =>
			saveSetupConfigurationRuntime({ url, apiKey, userId, username, password }),
		onSuccess: async () => {
			await navigate({ to: "/" });
		},
	});

	const totalSteps = STEPS.length;
	const current = STEPS[step];
	const Icon = current.icon;
	const progress = ((step + 1) / totalSteps) * 100;

	function canAdvance() {
		if (step === 0) return url.trim().length > 0;
		if (step === 1) return apiKey.trim().length > 0;
		return userId.trim().length > 0 && username.trim().length > 0;
	}

	function handleNext() {
		if (step < totalSteps - 1) {
			setStep((s) => s + 1);
		} else {
			setupMutation.mutate();
		}
	}

	const isLastStep = step === totalSteps - 1;

	return (
		<div className="setup-shell">
			<div className="setup-wordmark">aurora</div>

			<div className="setup-flow">
				<div className="setup-progress-meta">
					<span className="setup-step-label">
						Step {step + 1} of {totalSteps}
					</span>
					<span className="setup-step-label">{current.title}</span>
				</div>
				<div className="setup-progress-track">
					<div className="setup-progress-fill" style={{ width: `${progress}%` }} />
				</div>

				<div className="setup-card">
					<div className="setup-step-icon">
						<Icon size={22} />
					</div>

					<h1 className="setup-step-title">{current.title}</h1>
					<p className="setup-step-subtitle">{current.subtitle}</p>

					{step === 0 && (
						<div className="setup-field">
							<label htmlFor="setup-url">{t("setup.serverUrl")}</label>
							<input
								id="setup-url"
								className="setup-input"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								placeholder="http://localhost:8096"
								autoFocus
								onKeyDown={(e) => {
									if (e.key === "Enter" && canAdvance()) handleNext();
								}}
							/>
						</div>
					)}

					{step === 1 && (
						<div className="setup-field">
							<label htmlFor="setup-apikey">{t("setup.apiKey")}</label>
							<input
								id="setup-apikey"
								className="setup-input"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								autoFocus
								onKeyDown={(e) => {
									if (e.key === "Enter" && canAdvance()) handleNext();
								}}
							/>
						</div>
					)}

					{step === 2 && (
						<>
							<div className="setup-field">
								<label htmlFor="setup-username">{t("setup.username")}</label>
								<input
									id="setup-username"
									className="setup-input"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									autoFocus
								/>
							</div>
							<div className="setup-field">
								<label htmlFor="setup-password">{t("setup.password")}</label>
								<input
									id="setup-password"
									type="password"
									className="setup-input"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
								/>
							</div>
							<div className="setup-field">
								<label htmlFor="setup-userid">{t("setup.userId")}</label>
								<input
									id="setup-userid"
									className="setup-input"
									value={userId}
									onChange={(e) => setUserId(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && canAdvance()) handleNext();
									}}
								/>
							</div>
						</>
					)}

					<p className="setup-hint">{current.hint}</p>

					{setupMutation.error ? (
						<p className="setup-error">
							{setupMutation.error instanceof Error
								? setupMutation.error.message
								: t("setup.errorFallback")}
						</p>
					) : null}

					<div className="setup-actions">
						{step > 0 ? (
							<button
								type="button"
								className="setup-back-btn"
								onClick={() => setStep((s) => s - 1)}
							>
								<ArrowLeft size={15} /> Back
							</button>
						) : null}

						<button
							type="button"
							className="setup-next-btn"
							disabled={!canAdvance() || setupMutation.isPending}
							onClick={handleNext}
						>
							{setupMutation.isPending
								? t("setup.saving")
								: isLastStep
									? t("setup.submit")
									: "Continue"}
							{!setupMutation.isPending && !isLastStep ? <ArrowRight size={15} /> : null}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
