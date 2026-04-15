import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface ErrorPageProps {
	variant?: "not-found" | "error";
	error?: Error | null;
	onRetry?: () => void;
}

export function ErrorPage({ variant = "error", error: _error, onRetry }: ErrorPageProps) {
	const { t } = useI18n();

	const isNotFound = variant === "not-found";
	const eyebrow = isNotFound ? t("error.notFound.eyebrow") : t("error.generic.eyebrow");
	const title = isNotFound ? t("error.notFound.title") : t("error.generic.title");
	const copy = isNotFound ? t("error.notFound.copy") : t("error.generic.copy");
	const cta = isNotFound ? t("error.notFound.cta") : t("error.generic.cta");

	return (
		<main className="error-shell">
			<div className="error-glow" aria-hidden="true" />

			<div className="error-content">
				<div className="error-glyph">
					<Sparkles size={28} />
				</div>

				<p className="eyebrow">{eyebrow}</p>

				<h1 className="error-title">{title}</h1>

				<p className="error-copy">{copy}</p>

				<div className="error-actions">
					<Link to="/" className="primary-action">
						{cta}
					</Link>
					{!isNotFound && onRetry ? (
						<button type="button" className="secondary-action" onClick={onRetry}>
							{t("error.generic.retry")}
						</button>
					) : null}
				</div>
			</div>
		</main>
	);
}
