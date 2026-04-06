import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Activity, ArrowLeft, BookOpen, Film, Music, Pause, Play, Server, Settings, Tv, Users } from 'lucide-react'
import { fetchAdminOverview, fetchAdminSessions } from '../server/functions'
import { fetchSetupStatusRuntime } from '../lib/runtime-functions'

export const Route = createFileRoute('/admin')({
  loader: async () => {
    const setupStatus = await fetchSetupStatusRuntime()
    if (!setupStatus?.configured) {
      throw redirect({ to: '/setup' })
    }
    return setupStatus
  },
  component: AdminPage,
})

function formatTicks(ticks: number): string {
  const s = Math.floor(ticks / 10_000_000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function AdminPage() {
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => fetchAdminOverview(),
    staleTime: 60_000,
  })

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['admin-sessions'],
    queryFn: () => fetchAdminSessions(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  })

  const { systemInfo, counts } = overview ?? {}

  const stats = [
    { label: 'Movies', value: counts?.MovieCount, Icon: Film },
    { label: 'Series', value: counts?.SeriesCount, Icon: Tv },
    { label: 'Episodes', value: counts?.EpisodeCount, Icon: Tv },
    { label: 'Songs', value: counts?.SongCount, Icon: Music },
    { label: 'Books', value: counts?.BookCount, Icon: BookOpen },
  ].filter((s) => s.value != null && s.value > 0)

  const nowPlaying = sessions.filter((s) => s.nowPlaying !== null)
  const idle = sessions.filter((s) => s.nowPlaying === null)

  return (
    <main className="library-shell">
      <div className="page-wrap library-head">
        <div className="library-copy">
          <Link to="/" className="library-backlink">
            <ArrowLeft size={16} /> Back to Aurora
          </Link>
          <p className="eyebrow">Dashboard</p>
          <h1 className="library-title">
            {overviewLoading ? 'Admin' : (systemInfo?.ServerName ?? 'Admin')}
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
                const item = s.nowPlaying!
                const progress = item.runTimeTicks && s.positionTicks
                  ? (s.positionTicks / item.runTimeTicks) * 100
                  : 0
                return (
                  <div key={s.id} className="admin-session-card">
                    <div className="admin-session-thumb">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} />
                      ) : (
                        <div className="admin-session-thumb-fallback">
                          {item.type === 'Episode' ? <Tv size={20} /> : <Film size={20} />}
                        </div>
                      )}
                      <div className={`admin-status-dot${s.isPaused ? ' paused' : ' playing'}`}>
                        {s.isPaused
                          ? <Pause size={8} fill="currentColor" strokeWidth={0} />
                          : <Play size={8} fill="currentColor" strokeWidth={0} />}
                      </div>
                    </div>

                    <div className="admin-session-info">
                      <p className="admin-session-title">
                        {item.seriesName ? (
                          <><span className="admin-session-series">{item.seriesName}</span>{' · '}</>
                        ) : null}
                        {item.name}
                      </p>
                      <p className="admin-session-user">
                        {[s.userName, s.client, s.deviceName].filter(Boolean).join(' · ')}
                      </p>
                      {item.runTimeTicks ? (
                        <div className="admin-progress-row">
                          <div className="admin-progress-track">
                            <div className="admin-progress-fill" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="admin-progress-time">
                            {formatTicks(s.positionTicks)} / {formatTicks(item.runTimeTicks)}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
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
              <div className="admin-empty-card"><p>No other connected devices.</p></div>
            ) : (
              <div className="admin-idle-list">
                {idle.map((s) => (
                  <div key={s.id} className="admin-idle-row">
                    <div className="admin-idle-avatar">
                      {(s.userName ?? '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="admin-idle-copy">
                      <span className="admin-idle-name">{s.userName ?? 'Unknown'}</span>
                      <span className="admin-idle-meta">
                        {[s.client, s.deviceName].filter(Boolean).join(' · ')}
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
    </main>
  )
}
