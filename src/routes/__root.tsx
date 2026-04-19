import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	redirect,
	Scripts,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import { AppBootstrap } from "../components/AppBootstrap";
import { ErrorPage } from "../components/ErrorPage";
import Footer from "../components/Footer";
import Header from "../components/Header";
import { PwaStatusBanner } from "../components/PwaStatusBanner";
import { I18nProvider } from "../lib/i18n";
import appCss from "../styles.css?url";

interface MyRouterContext {
	queryClient: QueryClient;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

const TV_MODE_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('aurora-tv-mode');var ua=(navigator.userAgent||'').toLowerCase();var touch=navigator.maxTouchPoints||0;var isIos=/iphone|ipad|ipod/.test(ua)||(ua.indexOf('macintosh')!==-1&&touch>1);var isTv=/(android tv|googletv|google tv|afts|aftt|aftm|bravia|smarttv|hbbtv)/.test(ua);var enabled=stored==='1'||(stored!=='0'&&isTv&&!isIos);var platform=isIos?'ios':(isTv?'android-tv':(/android/.test(ua)?'android':'other'));document.documentElement.dataset.platform=platform;if(enabled){document.documentElement.classList.add('tv-mode');}}catch(e){}})();`;

const SKIP_PROFILE_GUARD = ["/setup", "/profiles"];

export const Route = createRootRouteWithContext<MyRouterContext>()({
	beforeLoad: async ({ location }) => {
		if (SKIP_PROFILE_GUARD.some((p) => location.pathname.startsWith(p))) return;

		const { fetchMultiUserSettingsRuntime, fetchSetupStatusRuntime } = await import(
			"../lib/runtime-functions"
		);
		const multiUser = await fetchMultiUserSettingsRuntime();
		if (multiUser.multiUserMode && !multiUser.activeUserId) {
			const setup = await fetchSetupStatusRuntime();
			if (setup.configured) {
				throw redirect({ to: "/profiles" });
			}
		}
	},
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{
				name: "description",
				content:
					"Aurora brings a TV-friendly Jellyfin experience to the web, mobile, and living room screens.",
			},
			{
				name: "theme-color",
				content: "#050816",
			},
			{
				name: "mobile-web-app-capable",
				content: "yes",
			},
			{
				name: "apple-mobile-web-app-capable",
				content: "yes",
			},
			{
				name: "apple-mobile-web-app-status-bar-style",
				content: "black-translucent",
			},
			{
				name: "apple-mobile-web-app-title",
				content: "Aurora",
			},
			{
				title: "Aurora for Jellyfin",
			},
		],
		links: [
			{
				rel: "manifest",
				href: "/manifest.json",
			},
			{
				rel: "icon",
				href: "/favicon.ico",
			},
			{
				rel: "apple-touch-icon",
				href: "/logo192.png",
			},
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
	notFoundComponent: NotFoundPage,
	errorComponent: RootErrorPage,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const hideHeader = pathname === "/setup" || pathname === "/profiles";

	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
				<script dangerouslySetInnerHTML={{ __html: TV_MODE_INIT_SCRIPT }} />
				<HeadContent />
			</head>
			<body className="font-sans antialiased wrap-anywhere selection:bg-[rgba(79,184,178,0.24)]">
				<I18nProvider>
					<AppBootstrap />
					<PwaStatusBanner />
					{hideHeader ? null : <Header />}
					{children}
					<Footer />
					<Scripts />
				</I18nProvider>
			</body>
		</html>
	);
}

function NotFoundPage() {
	return (
		<I18nProvider>
			<ErrorPage variant="not-found" />
		</I18nProvider>
	);
}

function RootErrorPage({ error, reset }: { error: Error; reset: () => void }) {
	const router = useRouter();

	function handleRetry() {
		reset();
		void router.invalidate();
	}

	return (
		<I18nProvider>
			<ErrorPage variant="error" error={error} onRetry={handleRetry} />
		</I18nProvider>
	);
}
