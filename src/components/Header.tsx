import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	ChevronDown,
	LayoutDashboard,
	LogOut,
	Menu,
	Search,
	Settings,
	User,
	Users,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { useMultiUserMode } from "../lib/multi-user-mode";
import {
	clearActiveUserRuntime,
	fetchAuthStatusRuntime,
	fetchCurrentProfileRuntime,
	fetchIptvStatusRuntime,
	fetchSetupStatusRuntime,
	fetchUsernameRuntime,
	logoutRuntime,
} from "../lib/runtime-functions";
import { useTvMode } from "../lib/tv-mode";
import { AuroraMark } from "./AuroraMark";
import { SearchPanel } from "./SearchPanel";

export default function Header() {
	const { t } = useI18n();
	const { tvMode } = useTvMode();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const multiUser = useMultiUserMode();

	const { data: profile } = useQuery({
		queryKey: ["current-profile", multiUser.activeUserId],
		queryFn: () => fetchCurrentProfileRuntime(),
	});
	const { data: username = "" } = useQuery({
		queryKey: ["current-user", multiUser.activeUserId],
		queryFn: () => fetchUsernameRuntime(),
	});
	const { data: authStatus } = useQuery({
		queryKey: ["auth-status"],
		queryFn: () => fetchAuthStatusRuntime(),
	});
	const { data: setupStatus } = useQuery({
		queryKey: ["setup-status"],
		queryFn: () => fetchSetupStatusRuntime(),
		staleTime: 60_000,
	});
	const { data: iptvStatus } = useQuery({
		queryKey: ["iptv-status"],
		queryFn: () => fetchIptvStatusRuntime(),
		staleTime: 60_000,
	});
	const hasJellyfin = setupStatus?.configured ?? true;
	const hasIptv = Boolean(iptvStatus?.enabled && iptvStatus.sources > 0);
	const loginRequired = authStatus?.required ?? false;
	const canAdminister = authStatus?.isAdmin ?? true;
	const [searchOpen, setSearchOpen] = useState(false);
	const [navOpen, setNavOpen] = useState(false);
	const [profileOpen, setProfileOpen] = useState(false);
	const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
	const [loggingOut, setLoggingOut] = useState(false);
	const headerRef = useRef<HTMLElement>(null);

	// On a TV the header slides away once the page scrolls, so rows and the
	// guide get the whole screen; it comes back at the top or when the remote
	// moves into it.
	const [tucked, setTucked] = useState(false);
	useEffect(() => {
		if (!tvMode) {
			setTucked(false);
			return;
		}
		const update = () => setTucked(window.scrollY > 48);
		update();
		window.addEventListener("scroll", update, { passive: true });
		return () => window.removeEventListener("scroll", update);
	}, [tvMode]);

	useEffect(() => {
		if (!pathname) return;
		setSearchOpen(false);
		setNavOpen(false);
		setProfileOpen(false);
	}, [pathname]);

	useEffect(() => {
		function handlePointerDown(event: MouseEvent | TouchEvent) {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (headerRef.current?.contains(target)) return;
			setSearchOpen(false);
			setNavOpen(false);
			setProfileOpen(false);
		}

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("touchstart", handlePointerDown);

		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("touchstart", handlePointerDown);
		};
	}, []);

	function toggleSearch() {
		setSearchOpen((current) => {
			const next = !current;
			if (next) {
				setNavOpen(false);
				setProfileOpen(false);
			}
			return next;
		});
	}

	function closeSearch() {
		setSearchOpen(false);
	}

	function toggleNav() {
		setNavOpen((current) => {
			const next = !current;
			if (next) {
				setSearchOpen(false);
				setProfileOpen(false);
			}
			return next;
		});
	}

	function toggleProfileMenu() {
		setProfileOpen((current) => {
			const next = !current;
			if (next) {
				setSearchOpen(false);
				setNavOpen(false);
			}
			return next;
		});
	}

	async function handleLogout() {
		if (!multiUser.multiUserMode && !loginRequired) return;
		setLoggingOut(true);
		try {
			if (loginRequired) await logoutRuntime();
			if (multiUser.multiUserMode) await clearActiveUserRuntime();
			setProfileOpen(false);
			window.location.assign(loginRequired ? "/login" : "/profiles");
		} finally {
			setLoggingOut(false);
		}
	}

	return (
		<header
			ref={headerRef}
			className={tucked ? "app-header app-header-tucked" : "app-header"}
			data-tv-last-resort={tucked ? "true" : undefined}
			// One row for the remote: coming up into it lands on the current page.
			data-tv-row
		>
			<nav
				className={
					searchOpen || navOpen
						? "page-wrap header-bar header-bar-expanded"
						: "page-wrap header-bar"
				}
			>
				<div className="header-top-row">
					<Link to="/" className="brand-mark" data-tv-focusable="true">
						<span className="brand-glyph">
							<AuroraMark width={30} height={22} />
						</span>
						<span>
							{t("brand.wordmark")} <em>{t("brand.suffix")}</em>
						</span>
					</Link>

					<div className="header-actions">
						<button
							type="button"
							onClick={toggleNav}
							className={
								navOpen
									? "icon-button mobile-nav-toggle mobile-nav-toggle-active"
									: "icon-button mobile-nav-toggle"
							}
							aria-label={t("nav.openBrowse")}
							aria-expanded={navOpen}
						>
							{navOpen ? <X size={18} /> : <Menu size={18} />}
						</button>

						<button
							type="button"
							onClick={toggleSearch}
							className={searchOpen ? "icon-button icon-button-active" : "icon-button"}
							aria-label={searchOpen ? t("search.close") : t("search.open")}
							data-tv-focusable="true"
						>
							{searchOpen ? <X size={18} /> : <Search size={20} />}
						</button>

						<div className="header-profile-menu-shell">
							<button
								type="button"
								onClick={toggleProfileMenu}
								className={
									profileOpen
										? "header-profile-trigger header-profile-trigger-open"
										: "header-profile-trigger"
								}
								aria-label={t("header.profileMenu")}
								aria-expanded={profileOpen}
								data-tv-focusable="true"
							>
								{profile?.imageUrl && failedAvatar !== profile.imageUrl ? (
									<img
										src={profile.imageUrl}
										alt={profile.name || username || t("header.profileFallback")}
										className="header-profile-avatar-image"
										// An account without a picture has no image to load: show
										// the initials instead of a broken image.
										onError={() => setFailedAvatar(profile.imageUrl ?? null)}
									/>
								) : (
									<span className="header-profile-avatar">
										{username ? username.slice(0, 2).toUpperCase() : <User size={16} />}
									</span>
								)}
								<ChevronDown size={14} className="header-profile-caret" />
							</button>

							{profileOpen ? (
								<div className="header-profile-dropdown">
									<p className="header-profile-name">{username || t("header.profileFallback")}</p>
									<div className="header-profile-links">
										<Link
											to="/profile"
											className="header-profile-link"
											aria-label={t("header.profile")}
											data-tv-focusable="true"
										>
											<Users size={15} />
											{t("header.profile")}
										</Link>
										<Link
											to="/settings"
											className="header-profile-link"
											aria-label={t("nav.settings")}
											data-tv-focusable="true"
										>
											<Settings size={15} />
											{t("nav.settings")}
										</Link>
										{canAdminister ? (
											<Link
												to="/admin"
												className="header-profile-link"
												aria-label={t("header.dashboard")}
												data-tv-focusable="true"
											>
												<LayoutDashboard size={15} />
												{t("header.dashboard")}
											</Link>
										) : null}
										{multiUser.multiUserMode ? (
											<Link
												to="/profiles"
												className="header-profile-link"
												aria-label={t("profiles.switchProfile")}
												data-tv-focusable="true"
											>
												<Users size={15} />
												{t("profiles.switchProfile")}
											</Link>
										) : null}
										{multiUser.multiUserMode || loginRequired ? (
											<button
												type="button"
												className="header-profile-link header-profile-link-danger"
												onClick={handleLogout}
												disabled={loggingOut}
											>
												<LogOut size={15} />
												{loggingOut ? t("header.loggingOut") : t("header.logout")}
											</button>
										) : null}
									</div>
								</div>
							) : null}
						</div>
					</div>
				</div>

				<div className={navOpen ? "header-nav header-nav-open" : "header-nav"}>
					<Link
						to="/"
						// Every page sits under "/", so only an exact match is Home.
						activeOptions={{ exact: true }}
						className="nav-pill"
						activeProps={{ className: "nav-pill nav-pill-active" }}
						data-tv-focusable="true"
					>
						{t("nav.home")}
					</Link>
					{hasJellyfin ? (
						<>
							<Link
								to="/library/movies"
								search={{
									sort: "DateCreated",
									order: "Descending",
									ratings: "",
									decade: "",
									minScore: 0,
									watchStatus: undefined,
								}}
								className="nav-pill"
								activeProps={{ className: "nav-pill nav-pill-active" }}
								data-tv-focusable="true"
							>
								{t("nav.movies")}
							</Link>
							<Link
								to="/library/series"
								search={{
									sort: "DateCreated",
									order: "Descending",
									ratings: "",
									decade: "",
									minScore: 0,
									watchStatus: undefined,
								}}
								className="nav-pill"
								activeProps={{ className: "nav-pill nav-pill-active" }}
								data-tv-focusable="true"
							>
								{t("nav.series")}
							</Link>
							{!tvMode ? (
								<Link
									to="/collections"
									className="nav-pill"
									activeProps={{ className: "nav-pill nav-pill-active" }}
									data-tv-focusable="true"
								>
									{t("nav.collections")}
								</Link>
							) : null}
						</>
					) : null}
					<Link
						to="/my-list"
						className="nav-pill"
						activeProps={{ className: "nav-pill nav-pill-active" }}
						data-tv-focusable="true"
					>
						{t("nav.myList")}
					</Link>
					{hasIptv ? (
						<Link
							to="/iptv"
							search={{ tab: "live" }}
							className="nav-pill"
							activeProps={{ className: "nav-pill nav-pill-active" }}
							data-tv-focusable="true"
						>
							{t("nav.liveTv")}
						</Link>
					) : null}
				</div>

				<div
					className={searchOpen ? "header-search-row header-search-row-open" : "header-search-row"}
				>
					{searchOpen ? <SearchPanel onClose={closeSearch} /> : null}
				</div>
			</nav>
		</header>
	);
}
