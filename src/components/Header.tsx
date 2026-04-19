import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, LayoutDashboard, LogOut, Menu, Search, Settings, Sparkles, Users, X } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import type { MediaItem } from "../lib/media";
import { clearActiveUserRuntime } from "../lib/runtime-functions";
import { useMultiUserMode } from "../lib/multi-user-mode";
import { fetchSearchRuntime, fetchUsernameRuntime } from "../lib/runtime-functions";
import { useTvMode } from "../lib/tv-mode";

export default function Header() {
	const { t } = useI18n();
	const { tvMode } = useTvMode();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const multiUser = useMultiUserMode();

	const { data: username = "" } = useQuery({
		queryKey: ["current-user", multiUser.activeUserId],
		queryFn: () => fetchUsernameRuntime(),
	});
	const [searchOpen, setSearchOpen] = useState(false);
	const [navOpen, setNavOpen] = useState(false);
	const [profileOpen, setProfileOpen] = useState(false);
	const [loggingOut, setLoggingOut] = useState(false);
	const [query, setQuery] = useState("");
	const headerRef = useRef<HTMLElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const deferredQuery = useDeferredValue(query.trim());

	const { data: results = [], isFetching } = useQuery({
		queryKey: ["search", deferredQuery],
		queryFn: () => fetchSearchRuntime({ data: { query: deferredQuery } }),
		enabled: deferredQuery.length > 1,
	});

	useEffect(() => {
		if (searchOpen) inputRef.current?.focus();
	}, [searchOpen]);

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

	function selectItem(item: MediaItem) {
		window.dispatchEvent(new CustomEvent("aurora:select-media", { detail: item }));
		setSearchOpen(false);
		setQuery("");
	}

	function toggleSearch() {
		setSearchOpen((current) => {
			const next = !current;
			if (next) {
				setNavOpen(false);
				setProfileOpen(false);
			}
			if (!next) setQuery("");
			return next;
		});
	}

	function closeSearch() {
		setSearchOpen(false);
		setQuery("");
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
		if (!multiUser.multiUserMode) return;
		setLoggingOut(true);
		try {
			await clearActiveUserRuntime();
			setProfileOpen(false);
			window.location.assign("/profiles");
		} finally {
			setLoggingOut(false);
		}
	}

	return (
		<header ref={headerRef} className="app-header">
			<nav className="page-wrap header-bar">
				<div className="header-top-row">
					<Link to="/" className="brand-mark" data-tv-focusable="true">
						<span className="brand-glyph">
							<Sparkles size={15} />
						</span>
						<span>
							{t("brand.wordmark")} <em>{t("brand.forJellyfin")}</em>
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

						<Link
							to="/settings"
							className="icon-button"
							aria-label={t("nav.settings")}
							data-tv-focusable="true"
						>
							<Settings size={20} />
						</Link>

						<div className="header-profile-menu-shell">
							<button
								type="button"
								onClick={toggleProfileMenu}
								className={profileOpen ? "header-profile-trigger header-profile-trigger-open" : "header-profile-trigger"}
								aria-label={t("header.profileMenu")}
								aria-expanded={profileOpen}
								data-tv-focusable="true"
							>
								<span className="header-profile-avatar">
									{username.slice(0, 2).toUpperCase() || "??"}
								</span>
								<ChevronDown size={14} className="header-profile-caret" />
							</button>

							{profileOpen ? (
								<div className="header-profile-dropdown">
									<p className="header-profile-name">{username || t("header.profileFallback")}</p>
									<div className="header-profile-links">
										<Link
											to="/settings"
											className="header-profile-link"
											aria-label={t("nav.settings")}
											data-tv-focusable="true"
										>
											<Settings size={15} />
											{t("nav.settings")}
										</Link>
										<Link
											to="/admin"
											className="header-profile-link"
											aria-label={t("header.dashboard")}
											data-tv-focusable="true"
										>
											<LayoutDashboard size={15} />
											{t("header.dashboard")}
										</Link>
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
										{multiUser.multiUserMode ? (
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
						className="nav-pill"
						activeProps={{ className: "nav-pill nav-pill-active" }}
						data-tv-focusable="true"
					>
						{t("nav.home")}
					</Link>
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
					<Link
						to="/my-list"
						className="nav-pill"
						activeProps={{ className: "nav-pill nav-pill-active" }}
						data-tv-focusable="true"
					>
						{t("nav.myList")}
					</Link>
				</div>

				<div
					className={searchOpen ? "header-search-row header-search-row-open" : "header-search-row"}
				>
					{searchOpen ? (
						<div className="search-shell">
							<input
								ref={inputRef}
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={(e) => e.key === "Escape" && closeSearch()}
								placeholder={t("search.placeholder")}
								className="search-input"
							/>
							<button
								type="button"
								className="icon-button"
								onClick={closeSearch}
								aria-label={t("search.close")}
							>
								<X size={16} />
							</button>

							{deferredQuery.length > 1 ? (
								<div className="search-results">
									{isFetching ? <p className="search-state">{t("search.searching")}</p> : null}
									{!isFetching && results.length === 0 ? (
										<p className="search-state">{t("search.empty")}</p>
									) : null}
									{results.map((item) => (
										<button
											key={item.id}
											type="button"
											className="search-result"
											onClick={() => selectItem(item)}
										>
											<div className="search-result-copy">
												<strong>{item.title}</strong>
												<span>
													{[
														item.type === "series" ? t("search.series") : t("search.movie"),
														item.year,
													]
														.filter(Boolean)
														.join(" • ")}
												</span>
											</div>
										</button>
									))}
								</div>
							) : null}
						</div>
					) : null}
				</div>
			</nav>
		</header>
	);
}
