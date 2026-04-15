import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { getClientPlaybackContext } from "../lib/platform";
import { installTvSpatialNavigation } from "../lib/tv-spatial-navigation";

const IS_DEV = import.meta.env.DEV;

export function AppBootstrap() {
	const router = useRouter();

	useEffect(() => {
		const root = document.documentElement;
		const platform = getClientPlaybackContext();

		root.dataset.platform = platform.platform;
		root.classList.toggle("touch-platform", navigator.maxTouchPoints > 0);
	}, []);

	useEffect(() => installTvSpatialNavigation(), []);

	useEffect(() => {
		const platform = getClientPlaybackContext().platform;

		if (platform !== "android" && platform !== "android-tv") {
			return;
		}

		let disposed = false;
		let removeListener: (() => Promise<void>) | undefined;

		async function setupBackHandler() {
			const { App } = await import("@capacitor/app");

			if (disposed) {
				return;
			}

			const handle = await App.addListener("backButton", async ({ canGoBack }) => {
				if (document.fullscreenElement) {
					await document.exitFullscreen();
					return;
				}

				const closeTarget = document.querySelector<HTMLElement>("[data-aurora-overlay-close]");
				if (closeTarget) {
					closeTarget.click();
					return;
				}

				if (canGoBack || window.history.length > 1) {
					window.history.back();
					return;
				}

				if (window.location.pathname !== "/" && window.location.pathname !== "/setup") {
					await router.navigate({ to: "/" });
					return;
				}

				await App.exitApp();
			});

			removeListener = () => handle.remove();
		}

		void setupBackHandler().catch((error) => {
			console.error("Failed to install Android back handler.", error);
		});

		return () => {
			disposed = true;
			if (removeListener) {
				void removeListener();
			}
		};
	}, [router]);

	useEffect(() => {
		if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
			return;
		}

		if (IS_DEV) {
			void navigator.serviceWorker.getRegistrations().then((registrations) => {
				registrations.forEach((registration) => {
					void registration.unregister();
				});
			});

			if ("caches" in window) {
				void caches.keys().then((cacheNames) => {
					cacheNames.forEach((cacheName) => {
						void caches.delete(cacheName);
					});
				});
			}

			return;
		}

		let cancelled = false;

		function emitUpdateReady(registration: ServiceWorkerRegistration) {
			window.dispatchEvent(
				new CustomEvent("aurora:pwa-update-ready", {
					detail: { registration },
				}),
			);
		}

		void navigator.serviceWorker
			.register("/sw.js", { scope: "/" })
			.then((registration) => {
				if (cancelled) return;

				if (registration.waiting) {
					emitUpdateReady(registration);
				}

				registration.addEventListener("updatefound", () => {
					const installingWorker = registration.installing;
					if (!installingWorker) return;

					installingWorker.addEventListener("statechange", () => {
						if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
							emitUpdateReady(registration);
						}
					});
				});
			})
			.catch((error) => {
				if (!cancelled) {
					console.error("Failed to register Aurora service worker.", error);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	return null;
}
