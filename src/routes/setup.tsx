import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Globe, Key, Tv, User, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { AuroraMark } from "../components/AuroraMark";
import { useI18n } from "../lib/i18n";
import {
	fetchMultiUserSettingsRuntime,
	fetchSetupStatusRuntime,
	saveServerConnectionRuntime,
	saveSetupConfigurationRuntime,
	setMultiUserModeRuntime,
} from "../lib/runtime-functions";
import { shouldUseClientRuntime } from "../lib/runtime-mode";

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

// Titles, subtitles and hints are i18n keys under setup.<id>.
const BASE_STEPS = [
	{ id: "server" as const, icon: Globe },
	{ id: "apikey" as const, icon: Key },
];

const MULTIUSER_STEP = { id: "multiuser" as const, icon: Users };

const ACCOUNT_STEP = { id: "account" as const, icon: User };

function getSteps(multiUserLocked: boolean, signInWithPassword: boolean) {
	if (multiUserLocked) {
		return [...BASE_STEPS];
	}
	// Profiles list every user on the server, which needs an API key.
	if (signInWithPassword) {
		return [...BASE_STEPS, ACCOUNT_STEP];
	}
	return [...BASE_STEPS, MULTIUSER_STEP, ACCOUNT_STEP];
}

function SetupPage() {
	const { t } = useI18n();
	const navigate = useNavigate();
	const { current, multiUserLocked } = Route.useLoaderData();

	const [step, setStep] = useState(0);
	const [url, setUrl] = useState(current.url);
	const [apiKey, setApiKey] = useState(current.apiKey);
	// Only the native app saves settings on the device, where a password
	// sign-in can stand in for an API key. Decided after mount so the
	// prerendered page and the hydrated one match.
	const [passwordSignInAvailable, setPasswordSignInAvailable] = useState(false);
	useEffect(() => {
		setPasswordSignInAvailable(!multiUserLocked && shouldUseClientRuntime());
	}, [multiUserLocked]);
	const signInWithPassword = passwordSignInAvailable && apiKey.trim().length === 0;

	const steps = getSteps(multiUserLocked, signInWithPassword);
	const [multiUserEnabled, setMultiUserEnabled] = useState<boolean | null>(
		multiUserLocked ? true : null,
	);
	const [userId, setUserId] = useState(current.userId);
	const [username, setUsername] = useState(current.username);
	const [password, setPassword] = useState(current.password);

	const totalSteps = steps.length;
	const current_step = steps[step];
	const Icon = current_step.icon;
	// The multi-user step's strings live under setup.multiUser.
	const stepKey = current_step.id === "multiuser" ? "multiUser" : current_step.id;
	const stepTitle = t(`setup.${stepKey}.title`);
	const hint =
		current_step.id === "apikey" && passwordSignInAvailable
			? t("setup.apikey.passwordHint")
			: current_step.id === "account" && signInWithPassword
				? t("setup.account.passwordHint")
				: t(`setup.${stepKey}.hint`);
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
		if (step === 1) return passwordSignInAvailable || apiKey.trim().length > 0;
		if (current_step.id === "multiuser") return multiUserEnabled !== null;
		if (signInWithPassword) return username.trim().length > 0;
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
			<div className="setup-wordmark">
				<AuroraMark width={34} height={25} />
				{t("brand.wordmark")} {t("brand.suffix")}
			</div>

			<div className="setup-flow">
				<div className="setup-progress-meta">
					<span className="setup-step-label">
						{t("setup.stepOf", { step: step + 1, total: totalSteps })}
					</span>
					<span className="setup-step-label">{stepTitle}</span>
				</div>
				<div className="setup-progress-track">
					<div className="setup-progress-fill" style={{ width: `${progress}%` }} />
				</div>

				<div className="setup-card">
					<div className="setup-step-icon">
						<Icon size={22} />
					</div>

					<h1 className="setup-step-title">{stepTitle}</h1>
					<p className="setup-step-subtitle">{t(`setup.${stepKey}.subtitle`)}</p>

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
									onKeyDown={(e) => {
										if (signInWithPassword && e.key === "Enter" && canAdvance()) handleNext();
									}}
								/>
							</div>
							{signInWithPassword ? null : (
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
							)}
						</>
					)}

					<p className="setup-hint">{hint}</p>

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
								<ArrowLeft size={15} /> {t("setup.back")}
							</button>
						) : null}

						<button
							type="button"
							className="setup-next-btn"
							disabled={!canAdvance() || isPending}
							onClick={handleNext}
						>
							{isPending ? t("setup.saving") : isLastStep ? t("setup.submit") : t("setup.continue")}
							{!isPending && !isLastStep ? <ArrowRight size={15} /> : null}
						</button>
					</div>
				</div>

				{step === 0 ? (
					<Link to="/settings" hash="sources" className="setup-iptv-link">
						<Tv size={15} /> {t("setup.iptvOnly")}
					</Link>
				) : null}
			</div>
		</div>
	);
}
