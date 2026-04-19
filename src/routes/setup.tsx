import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Globe, Key, User, Users } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../lib/i18n";
import {
	fetchMultiUserSettingsRuntime,
	fetchSetupStatusRuntime,
	saveServerConnectionRuntime,
	saveSetupConfigurationRuntime,
	setMultiUserModeRuntime,
} from "../lib/runtime-functions";

const IS_PRERENDER_BUILD = process.env.TSS_PRERENDERING === "true";

export const Route = createFileRoute("/setup")({
	loader: async () => {
		if (IS_PRERENDER_BUILD) {
			return {
				configured: false,
				source: "missing",
				current: {
					url: "",
					apiKey: "",
					userId: "",
					username: "",
					password: "",
					hasApiKey: false,
					hasPassword: false,
				},
				multiUserLocked: false,
			};
		}

		const setupStatus = await fetchSetupStatusRuntime();
		if (setupStatus.configured) {
			throw redirect({ to: "/" });
		}

		const multiUser = await fetchMultiUserSettingsRuntime();

		return { ...setupStatus, multiUserLocked: multiUser.locked };
	},
	component: SetupPage,
});

const BASE_STEPS = [
	{
		id: "server" as const,
		icon: Globe,
		title: "Jellyfin Server",
		subtitle: "Where is your Jellyfin server running?",
		hint: "Enter the full URL of your server, including the port if needed. For example: http://localhost:8096 or https://jellyfin.myhome.net",
	},
	{
		id: "apikey" as const,
		icon: Key,
		title: "API Key",
		subtitle: "Authorize Aurora to talk to Jellyfin",
		hint: "Open your Jellyfin Dashboard → Administration → API Keys and create a new key. Paste it above.",
	},
];

const MULTIUSER_STEP = {
	id: "multiuser" as const,
	icon: Users,
	title: "User Profiles",
	subtitle: "Would you like to enable multiple user profiles?",
	hint: "Enable this if multiple people share this Aurora instance. Each person picks their own profile when opening Aurora.",
};

const ACCOUNT_STEP = {
	id: "account" as const,
	icon: User,
	title: "Your Account",
	subtitle: "Link your Jellyfin account",
	hint: "Aurora uses your credentials to create a real playback session so watch progress stays in sync with Jellyfin.",
};

function getSteps(multiUserLocked: boolean) {
	if (multiUserLocked) {
		return [...BASE_STEPS];
	}
	return [...BASE_STEPS, MULTIUSER_STEP, ACCOUNT_STEP];
}

function SetupPage() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { current, multiUserLocked } = Route.useLoaderData();

	const steps = getSteps(multiUserLocked);

	const [step, setStep] = useState(0);
	const [url, setUrl] = useState(current.url);
	const [apiKey, setApiKey] = useState(current.apiKey);
	const [multiUserEnabled, setMultiUserEnabled] = useState<boolean | null>(
		multiUserLocked ? true : null,
	);
	const [userId, setUserId] = useState(current.userId);
	const [username, setUsername] = useState(current.username);
	const [password, setPassword] = useState(current.password);

	const totalSteps = steps.length;
	const current_step = steps[step];
	const Icon = current_step.icon;
	const progress = ((step + 1) / totalSteps) * 100;

	const singleUserSetupMutation = useMutation({
		mutationFn: async () =>
			saveSetupConfigurationRuntime({ url, apiKey, userId, username, password }),
		onSuccess: async () => {
			await navigate({ to: "/" });
		},
	});

	const multiUserSetupMutation = useMutation({
		mutationFn: async () => {
			await saveServerConnectionRuntime(url, apiKey);
			await setMultiUserModeRuntime(true);
		},
		onSuccess: async () => {
			await navigate({ to: "/profiles" });
		},
	});

	function canAdvance() {
		if (step === 0) return url.trim().length > 0;
		if (step === 1) return apiKey.trim().length > 0;
		if (current_step.id === "multiuser") return multiUserEnabled !== null;
		return userId.trim().length > 0 && username.trim().length > 0;
	}

	function handleNext() {
		if (current_step.id === "multiuser") {
			if (multiUserEnabled) {
				multiUserSetupMutation.mutate();
				return;
			}
			setStep((s) => s + 1);
			return;
		}

		if (multiUserLocked && step === BASE_STEPS.length - 1) {
			multiUserSetupMutation.mutate();
			return;
		}

		if (step < totalSteps - 1) {
			setStep((s) => s + 1);
		} else {
			singleUserSetupMutation.mutate();
		}
	}

	const isLastStep =
		current_step.id === "multiuser" ? multiUserEnabled === false : step === totalSteps - 1;

	const isPending = multiUserSetupMutation.isPending || singleUserSetupMutation.isPending;
	const error = multiUserSetupMutation.error ?? singleUserSetupMutation.error;

	return (
		<div className="setup-shell">
			<div className="setup-wordmark">aurora</div>

			<div className="setup-flow">
				<div className="setup-progress-meta">
					<span className="setup-step-label">
						Step {step + 1} of {totalSteps}
					</span>
					<span className="setup-step-label">{current_step.title}</span>
				</div>
				<div className="setup-progress-track">
					<div className="setup-progress-fill" style={{ width: `${progress}%` }} />
				</div>

				<div className="setup-card">
					<div className="setup-step-icon">
						<Icon size={22} />
					</div>

					<h1 className="setup-step-title">{current_step.title}</h1>
					<p className="setup-step-subtitle">{current_step.subtitle}</p>

					{current_step.id === "server" && (
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

					{current_step.id === "apikey" && (
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

					{current_step.id === "multiuser" && (
						<div className="setup-multiuser-choice">
							<button
								type="button"
								className={`setup-multiuser-btn${multiUserEnabled === true ? " selected" : ""}`}
								onClick={() => setMultiUserEnabled(true)}
							>
								<Users size={18} />
								{t("setup.multiUser.enableButton")}
							</button>
							<button
								type="button"
								className={`setup-multiuser-btn${multiUserEnabled === false ? " selected" : ""}`}
								onClick={() => setMultiUserEnabled(false)}
							>
								<User size={18} />
								{t("setup.multiUser.disableButton")}
							</button>
						</div>
					)}

					{current_step.id === "account" && (
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

					<p className="setup-hint">{current_step.hint}</p>

					{error ? (
						<p className="setup-error">
							{error instanceof Error ? error.message : t("setup.errorFallback")}
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
							disabled={!canAdvance() || isPending}
							onClick={handleNext}
						>
							{isPending
								? t("setup.saving")
								: isLastStep
									? t("setup.submit")
									: "Continue"}
							{!isPending && !isLastStep ? <ArrowRight size={15} /> : null}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
