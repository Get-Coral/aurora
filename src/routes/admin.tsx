import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
	Activity,
	ArrowLeft,
	BookOpen,
	Film,
	Folders,
	HardDrive,
	Library,
	Music,
	Pause,
	Play,
	Plus,
	RefreshCw,
	Server,
	Settings,
	Shield,
	Tv,
	UserCheck,
	UserMinus,
	UserPlus,
	Users,
	X,
} from "lucide-react";
import { useState } from "react";
import {
	createAdminUserRuntime,
	deleteAdminUserRuntime,
	fetchAdminLibrariesRuntime,
	fetchAdminOverviewRuntime,
	fetchAdminSessionsRuntime,
	fetchAdminUsersRuntime,
	fetchSetupStatusRuntime,
	fetchUserPolicyRuntime,
	scanAdminLibraryRuntime,
	scanAllAdminLibrariesRuntime,
	toggleAdminUserRuntime,
	updateUserParentalPolicyRuntime,
} from "../lib/runtime-functions";
import { useTvMode } from "../lib/tv-mode";

export const Route = createFileRoute("/admin")({
	loader: async () => {
		const setupStatus = await fetchSetupStatusRuntime();
		if (!setupStatus?.configured) {
			throw redirect({ to: "/setup" });
		}
		return setupStatus;
	},
	component: AdminPage,
});

function formatTicks(ticks: number): string {
	const s = Math.floor(ticks / 10_000_000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
	return `${m}:${String(sec).padStart(2, "0")}`;
}

function timeAgo(iso: string): string {
	const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

const COLLECTION_ICONS: Record<string, React.FC<{ size?: number }>> = {
	movies: Film,
	tvshows: Tv,
	music: Music,
	books: BookOpen,
	boxsets: Folders,
	mixed: Library,
};

function LibraryTypeIcon({ type, size = 18 }: { type: string; size?: number }) {
	const Icon = COLLECTION_ICONS[type.toLowerCase()] ?? HardDrive;
	return <Icon size={size} />;
}

function AdminPage() {
	const { tvMode } = useTvMode();
	const queryClient = useQueryClient();

	const { data: overview, isLoading: overviewLoading } = useQuery({
		queryKey: ["admin-overview"],
		queryFn: () => fetchAdminOverviewRuntime(),
		staleTime: 60_000,
	});

	const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
		queryKey: ["admin-sessions"],
		queryFn: () => fetchAdminSessionsRuntime(),
		refetchInterval: 15_000,
		staleTime: 10_000,
	});

	const { data: users = [], isLoading: usersLoading } = useQuery({
		queryKey: ["admin-users"],
		queryFn: () => fetchAdminUsersRuntime(),
		enabled: !tvMode,
		staleTime: 30_000,
	});

	const { data: libraries = [], isLoading: librariesLoading } = useQuery({
		queryKey: ["admin-libraries"],
		queryFn: () => fetchAdminLibrariesRuntime(),
		enabled: !tvMode,
		staleTime: 60_000,
	});

	const { systemInfo, counts } = overview ?? {};

	const stats = [
		{ label: "Movies", value: counts?.MovieCount, Icon: Film },
		{ label: "Series", value: counts?.SeriesCount, Icon: Tv },
		{ label: "Episodes", value: counts?.EpisodeCount, Icon: Tv },
		{ label: "Songs", value: counts?.SongCount, Icon: Music },
		{ label: "Books", value: counts?.BookCount, Icon: BookOpen },
	].filter((s) => s.value != null && s.value > 0);

	const nowPlaying = sessions.filter((s) => s.nowPlaying !== null);
	const idle = sessions.filter((s) => s.nowPlaying === null);

	return (
		<main className="library-shell">
			<div className="page-wrap library-head">
				<div className="library-copy">
					<Link to="/" className="library-backlink">
						<ArrowLeft size={16} /> Back to Aurora
					</Link>
					<p className="eyebrow">Dashboard</p>
					<h1 className="library-title">
						{overviewLoading ? "Admin" : (systemInfo?.ServerName ?? "Admin")}
					</h1>
					{systemInfo ? (
						<p className="admin-server-meta">
							<Server size={13} />
							<span>v{systemInfo.Version}</span>
							{systemInfo.OperatingSystem ? <span>{systemInfo.OperatingSystem}</span> : null}
							{systemInfo.HasUpdateAvailable ? (
								<span className="admin-update-pill">Update available</span>
							) : null}
						</p>
					) : null}
				</div>
			</div>

			{stats.length > 0 ? (
				<div className="page-wrap admin-stats-row">
					{stats.map(({ label, value, Icon }) => (
						<div key={label} className="admin-stat-card">
							<Icon size={17} />
							<div className="admin-stat-body">
								<span className="admin-stat-value">{value?.toLocaleString()}</span>
								<span className="admin-stat-label">{label}</span>
							</div>
						</div>
					))}
				</div>
			) : null}

			<div className="page-wrap admin-grid">
				{/* Left: Now Watching */}
				<section className="admin-section">
					<header className="admin-section-head">
						<Activity size={15} />
						<h2>Now watching</h2>
						{nowPlaying.length > 0 ? (
							<span className="admin-count-badge">{nowPlaying.length}</span>
						) : null}
					</header>

					{sessionsLoading ? (
						<p className="admin-empty-note">Loading…</p>
					) : nowPlaying.length === 0 ? (
						<div className="admin-empty-card">
							<p>Nothing playing right now.</p>
						</div>
					) : (
						<div className="admin-session-list">
							{nowPlaying.map((s) => {
								const item = s.nowPlaying!;
								const progress =
									item.runTimeTicks && s.positionTicks
										? (s.positionTicks / item.runTimeTicks) * 100
										: 0;
								return (
									<div key={s.id} className="admin-session-card">
										<div className="admin-session-thumb">
											{item.imageUrl ? (
												<img src={item.imageUrl} alt={item.name} />
											) : (
												<div className="admin-session-thumb-fallback">
													{item.type === "Episode" ? <Tv size={20} /> : <Film size={20} />}
												</div>
											)}
											<div className={`admin-status-dot${s.isPaused ? " paused" : " playing"}`}>
												{s.isPaused ? (
													<Pause size={8} fill="currentColor" strokeWidth={0} />
												) : (
													<Play size={8} fill="currentColor" strokeWidth={0} />
												)}
											</div>
										</div>

										<div className="admin-session-info">
											<p className="admin-session-title">
												{item.seriesName ? (
													<>
														<span className="admin-session-series">{item.seriesName}</span>
														{" · "}
													</>
												) : null}
												{item.name}
											</p>
											<p className="admin-session-user">
												{[s.userName, s.client, s.deviceName].filter(Boolean).join(" · ")}
											</p>
											{item.runTimeTicks ? (
												<div className="admin-progress-row">
													<div className="admin-progress-track">
														<div
															className="admin-progress-fill"
															style={{ width: `${progress}%` }}
														/>
													</div>
													<span className="admin-progress-time">
														{formatTicks(s.positionTicks)} / {formatTicks(item.runTimeTicks)}
													</span>
												</div>
											) : null}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</section>

				{/* Right: Connected Devices + Quick Links */}
				<div className="admin-right-col">
					<section className="admin-section">
						<header className="admin-section-head">
							<Users size={15} />
							<h2>Connected devices</h2>
							{idle.length > 0 ? <span className="admin-count-badge">{idle.length}</span> : null}
						</header>

						{idle.length === 0 ? (
							<div className="admin-empty-card">
								<p>No other connected devices.</p>
							</div>
						) : (
							<div className="admin-idle-list">
								{idle.map((s) => (
									<div key={s.id} className="admin-idle-row">
										<div className="admin-idle-avatar">
											{(s.userName ?? "?").slice(0, 2).toUpperCase()}
										</div>
										<div className="admin-idle-copy">
											<span className="admin-idle-name">{s.userName ?? "Unknown"}</span>
											<span className="admin-idle-meta">
												{[s.client, s.deviceName].filter(Boolean).join(" · ")}
											</span>
										</div>
										{s.lastActivityDate ? (
											<span className="admin-idle-time">{timeAgo(s.lastActivityDate)}</span>
										) : null}
									</div>
								))}
							</div>
						)}
					</section>

					<section className="admin-section admin-links-section">
						<header className="admin-section-head">
							<Server size={15} />
							<h2>Quick links</h2>
						</header>
						<div className="admin-quick-links">
							<Link to="/settings" className="admin-quick-link">
								<Settings size={16} />
								<span>Settings</span>
							</Link>
							<Link to="/history" className="admin-quick-link">
								<Activity size={16} />
								<span>Watch history</span>
							</Link>
							<Link to="/collections" className="admin-quick-link">
								<Film size={16} />
								<span>Collections</span>
							</Link>
						</div>
					</section>
				</div>
			</div>

			{/* User Manager — non-TV only */}
			{!tvMode ? (
				<div className="page-wrap admin-wide-section">
					<UserManager
						users={users}
						isLoading={usersLoading}
						onRefresh={() => void queryClient.invalidateQueries({ queryKey: ["admin-users"] })}
					/>
				</div>
			) : null}

			{/* Library Manager — non-TV only */}
			{!tvMode ? (
				<div className="page-wrap admin-wide-section">
					<LibraryManager
						libraries={libraries}
						isLoading={librariesLoading}
						onRefresh={() => void queryClient.invalidateQueries({ queryKey: ["admin-libraries"] })}
					/>
				</div>
			) : null}
		</main>
	);
}

// ── User Manager ──────────────────────────────────────────────────────────────

type AdminUser = {
	id: string;
	name: string;
	isAdmin: boolean;
	isDisabled: boolean;
	lastLoginDate: string | null;
	hasPolicy: boolean;
};

function UserManager({
	users,
	isLoading,
	onRefresh,
}: {
	users: AdminUser[];
	isLoading: boolean;
	onRefresh: () => void;
}) {
	const queryClient = useQueryClient();
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [showAddForm, setShowAddForm] = useState(false);
	const [newName, setNewName] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

	const toggleMutation = useMutation({
		mutationFn: (vars: { userId: string; disabled: boolean }) =>
			toggleAdminUserRuntime({ data: vars }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
	});

	const deleteMutation = useMutation({
		mutationFn: (userId: string) => deleteAdminUserRuntime({ data: { userId } }),
		onSuccess: () => {
			setConfirmDelete(null);
			queryClient.invalidateQueries({ queryKey: ["admin-users"] });
		},
	});

	const createMutation = useMutation({
		mutationFn: () =>
			createAdminUserRuntime({ data: { name: newName.trim(), password: newPassword } }),
		onSuccess: () => {
			setShowAddForm(false);
			setNewName("");
			setNewPassword("");
			queryClient.invalidateQueries({ queryKey: ["admin-users"] });
		},
	});

	return (
		<section className="admin-section admin-section-full">
			<header className="admin-section-head">
				<Users size={15} />
				<h2>User manager</h2>
				<span className="admin-count-badge">{users.length}</span>
				<div className="admin-section-actions">
					<button type="button" className="admin-icon-action" onClick={onRefresh} title="Refresh">
						<RefreshCw size={14} />
					</button>
					<button type="button" className="admin-add-btn" onClick={() => setShowAddForm((v) => !v)}>
						<Plus size={14} />
						Add user
					</button>
				</div>
			</header>

			{showAddForm ? (
				<div className="admin-add-form">
					<input
						className="admin-add-input"
						placeholder="Username"
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						autoFocus
					/>
					<input
						className="admin-add-input"
						type="password"
						placeholder="Password"
						value={newPassword}
						onChange={(e) => setNewPassword(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && newName.trim()) createMutation.mutate();
						}}
					/>
					<button
						type="button"
						className="admin-add-btn"
						disabled={!newName.trim() || createMutation.isPending}
						onClick={() => createMutation.mutate()}
					>
						<UserPlus size={14} />
						{createMutation.isPending ? "Creating…" : "Create"}
					</button>
					<button
						type="button"
						className="admin-icon-action"
						onClick={() => {
							setShowAddForm(false);
							setNewName("");
							setNewPassword("");
						}}
					>
						<X size={14} />
					</button>
					{createMutation.error ? (
						<span className="admin-inline-error">
							{createMutation.error instanceof Error ? createMutation.error.message : "Failed"}
						</span>
					) : null}
				</div>
			) : null}

			{isLoading ? (
				<p className="admin-empty-note">Loading…</p>
			) : users.length === 0 ? (
				<div className="admin-empty-card">
					<p>No users found.</p>
				</div>
			) : (
				<div className="admin-user-list">
					{users.map((u) => (
						<div key={u.id} className={`admin-user-row${u.isDisabled ? " disabled" : ""}`}>
							<div className="admin-idle-avatar">{u.name.slice(0, 2).toUpperCase()}</div>
							<div className="admin-user-copy">
								<span className="admin-user-name">{u.name}</span>
								<span className="admin-user-meta">
									{u.lastLoginDate ? `Last login ${timeAgo(u.lastLoginDate)}` : "Never logged in"}
								</span>
							</div>
							<div className="admin-user-badges">
								{u.isAdmin ? (
									<span className="admin-badge admin-badge-admin">
										<Shield size={10} /> Admin
									</span>
								) : null}
								{u.isDisabled ? (
									<span className="admin-badge admin-badge-disabled">Disabled</span>
								) : null}
							</div>

							{confirmDelete === u.id ? (
								<div className="admin-confirm-delete">
									<span>Delete {u.name}?</span>
									<button
										type="button"
										className="admin-danger-btn"
										disabled={deleteMutation.isPending}
										onClick={() => deleteMutation.mutate(u.id)}
									>
										{deleteMutation.isPending ? "…" : "Yes, delete"}
									</button>
									<button
										type="button"
										className="admin-icon-action"
										onClick={() => setConfirmDelete(null)}
									>
										<X size={13} />
									</button>
								</div>
							) : (
								<div className="admin-user-actions">
									<button
										type="button"
										className="admin-user-expand-btn"
										onClick={() => setExpandedUserId(expandedUserId === u.id ? null : u.id)}
									>
										{expandedUserId === u.id ? "Close" : "Controls"}
									</button>
									<button
										type="button"
										className="admin-icon-action"
										title={u.isDisabled ? "Enable user" : "Disable user"}
										disabled={toggleMutation.isPending}
										onClick={() => toggleMutation.mutate({ userId: u.id, disabled: !u.isDisabled })}
									>
										{u.isDisabled ? <UserCheck size={15} /> : <UserMinus size={15} />}
									</button>
									<button
										type="button"
										className="admin-icon-action admin-icon-action-danger"
										title="Delete user"
										onClick={() => setConfirmDelete(u.id)}
									>
										<X size={14} />
									</button>
								</div>
							)}

							{expandedUserId === u.id ? (
								<ParentalControlsPanel userId={u.id} onClose={() => setExpandedUserId(null)} />
							) : null}
						</div>
					))}
				</div>
			)}
		</section>
	);
}

// ── Parental Controls Panel ───────────────────────────────────────────────────

type ParentalPolicy = {
	MaxActiveSessions: number;
	EnableRemoteAccess: boolean;
	MaxParentalRating: number;
	BlockedTags: string;
	EnableContentDeletion: boolean;
	EnableLiveTvAccess: boolean;
};

const RATING_OPTIONS = [
	{ label: "All content", value: 0 },
	{ label: "G", value: 1 },
	{ label: "PG", value: 7 },
	{ label: "PG-13", value: 10 },
	{ label: "R", value: 13 },
	{ label: "NC-17 / Adults only", value: 18 },
];

function ParentalControlsPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
	const queryClient = useQueryClient();

	const { data: rawPolicy, isLoading } = useQuery({
		queryKey: ["user-policy", userId],
		queryFn: () => fetchUserPolicyRuntime(userId),
	});

	const [policy, setPolicy] = useState<ParentalPolicy | null>(null);

	if (!policy && rawPolicy) {
		setPolicy({
			MaxActiveSessions: rawPolicy.MaxActiveSessions,
			EnableRemoteAccess: rawPolicy.EnableRemoteAccess,
			MaxParentalRating: rawPolicy.MaxParentalRating,
			BlockedTags: rawPolicy.BlockedTags.join(", "),
			EnableContentDeletion: rawPolicy.EnableContentDeletion,
			EnableLiveTvAccess: rawPolicy.EnableLiveTvAccess,
		});
	}

	const saveMutation = useMutation({
		mutationFn: () =>
			updateUserParentalPolicyRuntime({
				userId,
				policy: {
					MaxActiveSessions: policy!.MaxActiveSessions,
					EnableRemoteAccess: policy!.EnableRemoteAccess,
					MaxParentalRating: policy!.MaxParentalRating,
					BlockedTags: policy!.BlockedTags.split(",")
						.map((t) => t.trim())
						.filter(Boolean),
					EnableContentDeletion: policy!.EnableContentDeletion,
					EnableLiveTvAccess: policy!.EnableLiveTvAccess,
				},
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["user-policy", userId] });
			onClose();
		},
	});

	function set<K extends keyof ParentalPolicy>(key: K, value: ParentalPolicy[K]) {
		setPolicy((p) => (p ? { ...p, [key]: value } : p));
	}

	if (isLoading || !policy) {
		return (
			<div className="parental-panel">
				<p style={{ color: "var(--ink-faint)", fontSize: "0.875rem" }}>Loading controls\u2026</p>
			</div>
		);
	}

	return (
		<div className="parental-panel">
			<div className="parental-panel-group">
				<p className="parental-panel-group-title">Access</p>
				<div className="parental-field">
					<span className="parental-field-label">Max simultaneous streams (0 = unlimited)</span>
					<input
						type="number"
						min={0}
						className="parental-field-input"
						value={policy.MaxActiveSessions}
						onChange={(e) => set("MaxActiveSessions", Number(e.target.value))}
					/>
				</div>
				<div className="parental-field">
					<span className="parental-field-label">Allow remote access</span>
					<button
						type="button"
						role="switch"
						aria-checked={policy.EnableRemoteAccess}
						className={`toggle-switch${policy.EnableRemoteAccess ? " toggle-switch-on" : ""}`}
						onClick={() => set("EnableRemoteAccess", !policy.EnableRemoteAccess)}
					>
						<span className="toggle-switch-thumb" />
					</button>
				</div>
			</div>

			<div className="parental-panel-group">
				<p className="parental-panel-group-title">Content</p>
				<div className="parental-field">
					<span className="parental-field-label">Max age rating</span>
					<select
						className="parental-field-select"
						value={policy.MaxParentalRating}
						onChange={(e) => set("MaxParentalRating", Number(e.target.value))}
					>
						{RATING_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
				</div>
				<div className="parental-field">
					<span className="parental-field-label">Blocked tags (comma-separated)</span>
					<input
						type="text"
						className="parental-field-tags"
						value={policy.BlockedTags}
						onChange={(e) => set("BlockedTags", e.target.value)}
						placeholder="horror, violence"
					/>
				</div>
			</div>

			<div className="parental-panel-group">
				<p className="parental-panel-group-title">Management</p>
				<div className="parental-field">
					<span className="parental-field-label">Allow content deletion</span>
					<button
						type="button"
						role="switch"
						aria-checked={policy.EnableContentDeletion}
						className={`toggle-switch${policy.EnableContentDeletion ? " toggle-switch-on" : ""}`}
						onClick={() => set("EnableContentDeletion", !policy.EnableContentDeletion)}
					>
						<span className="toggle-switch-thumb" />
					</button>
				</div>
				<div className="parental-field">
					<span className="parental-field-label">Allow Live TV access</span>
					<button
						type="button"
						role="switch"
						aria-checked={policy.EnableLiveTvAccess}
						className={`toggle-switch${policy.EnableLiveTvAccess ? " toggle-switch-on" : ""}`}
						onClick={() => set("EnableLiveTvAccess", !policy.EnableLiveTvAccess)}
					>
						<span className="toggle-switch-thumb" />
					</button>
				</div>
			</div>

			{saveMutation.error ? (
				<p className="admin-inline-error">
					{saveMutation.error instanceof Error ? saveMutation.error.message : "Save failed"}
				</p>
			) : null}

			<div className="parental-panel-actions">
				<button type="button" className="parental-cancel-btn" onClick={onClose}>
					Cancel
				</button>
				<button
					type="button"
					className="parental-save-btn"
					disabled={saveMutation.isPending}
					onClick={() => saveMutation.mutate()}
				>
					{saveMutation.isPending ? "Saving\u2026" : "Save controls"}
				</button>
			</div>
		</div>
	);
}

// ── Library Manager ───────────────────────────────────────────────────────────

type AdminLibrary = {
	itemId: string;
	name: string;
	collectionType: string;
	locations: string[];
};

function LibraryManager({
	libraries,
	isLoading,
	onRefresh,
}: {
	libraries: AdminLibrary[];
	isLoading: boolean;
	onRefresh: () => void;
}) {
	const [scanningAll, setScanningAll] = useState(false);
	const [scanningId, setScanningId] = useState<string | null>(null);
	const [scanDoneId, setScanDoneId] = useState<string | null>(null);

	async function handleScanAll() {
		setScanningAll(true);
		try {
			await scanAllAdminLibrariesRuntime();
			setScanDoneId("all");
			setTimeout(() => setScanDoneId(null), 3000);
		} finally {
			setScanningAll(false);
		}
	}

	async function handleScanOne(itemId: string) {
		setScanningId(itemId);
		try {
			await scanAdminLibraryRuntime({ data: { itemId } });
			setScanDoneId(itemId);
			setTimeout(() => setScanDoneId(null), 3000);
		} finally {
			setScanningId(null);
		}
	}

	return (
		<section className="admin-section admin-section-full">
			<header className="admin-section-head">
				<Library size={15} />
				<h2>Library manager</h2>
				<span className="admin-count-badge">{libraries.length}</span>
				<div className="admin-section-actions">
					<button type="button" className="admin-icon-action" onClick={onRefresh} title="Refresh">
						<RefreshCw size={14} />
					</button>
					<button
						type="button"
						className="admin-add-btn"
						disabled={scanningAll}
						onClick={() => void handleScanAll()}
					>
						<RefreshCw size={14} className={scanningAll ? "spin" : ""} />
						{scanDoneId === "all"
							? "Scan queued!"
							: scanningAll
								? "Scanning…"
								: "Scan all libraries"}
					</button>
				</div>
			</header>

			{isLoading ? (
				<p className="admin-empty-note">Loading…</p>
			) : libraries.length === 0 ? (
				<div className="admin-empty-card">
					<p>No libraries found.</p>
				</div>
			) : (
				<div className="admin-library-grid">
					{libraries.map((lib) => (
						<div key={lib.itemId} className="admin-library-card">
							<div className="admin-library-icon">
								<LibraryTypeIcon type={lib.collectionType} size={22} />
							</div>
							<div className="admin-library-info">
								<span className="admin-library-name">{lib.name}</span>
								<span className="admin-library-type">{lib.collectionType}</span>
								{lib.locations.length > 0 ? (
									<span className="admin-library-path" title={lib.locations.join("\n")}>
										{lib.locations[0]}
										{lib.locations.length > 1 ? ` +${lib.locations.length - 1} more` : ""}
									</span>
								) : null}
							</div>
							<button
								type="button"
								className="admin-scan-btn"
								disabled={scanningId === lib.itemId}
								onClick={() => void handleScanOne(lib.itemId)}
								title="Scan this library"
							>
								<RefreshCw size={13} className={scanningId === lib.itemId ? "spin" : ""} />
								{scanDoneId === lib.itemId
									? "Queued!"
									: scanningId === lib.itemId
										? "Scanning…"
										: "Scan"}
							</button>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
