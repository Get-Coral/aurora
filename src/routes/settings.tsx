import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Tv } from 'lucide-react'
import { useState } from 'react'
import { useI18n, supportedLocales } from '../lib/i18n'
import type { Locale } from '../lib/i18n'
import {
  fetchOpenSubtitlesKeyRuntime,
  fetchSetupStatusRuntime,
  saveOpenSubtitlesKeyRuntime,
  saveSettingsRuntime,
} from '../lib/runtime-functions'
import { useTvMode } from '../lib/tv-mode'

export const Route = createFileRoute('/settings')({
  loader: async () => {
    const setupStatus = await fetchSetupStatusRuntime()
    if (!setupStatus?.configured) {
      throw redirect({ to: '/setup' })
    }
    return setupStatus
  },
  component: SettingsPage,
})

const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  nl: 'Nederlands',
}

function SettingsPage() {
  const { t, locale, setLocale } = useI18n()
  const { tvMode, setTvMode } = useTvMode()
  const setupStatus = Route.useLoaderData()

  const [url, setUrl] = useState(setupStatus.current.url)
  const [apiKey, setApiKey] = useState('')
  const [userId, setUserId] = useState(setupStatus.current.userId)
  const [username, setUsername] = useState(setupStatus.current.username)
  const [password, setPassword] = useState('')

  const queryClient = useQueryClient()

  const { data: existingOsKey } = useQuery({
    queryKey: ['opensubtitles-key'],
    queryFn: () => fetchOpenSubtitlesKeyRuntime(),
  })
  const [osApiKey, setOsApiKey] = useState('')

  const saveOsMutation = useMutation({
    mutationFn: () => saveOpenSubtitlesKeyRuntime(osApiKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['opensubtitles-key'] }),
  })

  const saveMutation = useMutation({
    mutationFn: () => saveSettingsRuntime({ url, apiKey, userId, username, password }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['current-user'] }),
  })

  return (
    <main className="library-shell">
      <div className="page-wrap library-head">
        <div className="library-copy">
          <p className="eyebrow">{t('settings.subtitle')}</p>
          <h1 className="library-title">{t('settings.title')}</h1>
        </div>
      </div>

      <div
        className="page-wrap"
        style={{
          display: 'grid',
          gap: '1.5rem',
          paddingTop: '2rem',
          paddingBottom: '4rem',
          maxWidth: '48rem',
          marginInline: 'auto',
        }}
      >
        <section className="overview-card" style={{ padding: '2rem', gap: '1.25rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <p className="eyebrow">{t('settings.jellyfinSection')}</p>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
              {t('settings.jellyfinCopy')}
            </p>
          </div>

          <form
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            onSubmit={(e) => {
              e.preventDefault()
              saveMutation.mutate()
            }}
          >
            <label className="library-select-shell">
              <span>{t('setup.serverUrl')}</span>
              <input
                className="library-select"
                style={{ width: '100%' }}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:8096"
              />
            </label>

            <label className="library-select-shell">
              <span>{t('setup.apiKey')}</span>
              <input
                className="library-select"
                style={{ width: '100%' }}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t('settings.apiKeyPlaceholder')}
              />
            </label>

            <label className="library-select-shell">
              <span>{t('setup.userId')}</span>
              <input
                className="library-select"
                style={{ width: '100%' }}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
            </label>

            <label className="library-select-shell">
              <span>{t('setup.username')}</span>
              <input
                className="library-select"
                style={{ width: '100%' }}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>

            <label className="library-select-shell">
              <span>{t('setup.password')}</span>
              <input
                type="password"
                className="library-select"
                style={{ width: '100%' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('settings.passwordPlaceholder')}
              />
            </label>

            {saveMutation.error ? (
              <p className="detail-empty">
                {saveMutation.error instanceof Error
                  ? saveMutation.error.message
                  : t('settings.errorFallback')}
              </p>
            ) : null}

            {saveMutation.isSuccess ? (
              <p className="eyebrow" style={{ opacity: 0.7 }}>{t('settings.saved')}</p>
            ) : null}

            <button type="submit" className="primary-action" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t('settings.saving') : t('settings.save')}
            </button>
          </form>
        </section>

        <section className="overview-card" style={{ padding: '2rem', gap: '1.25rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <p className="eyebrow">{t('settings.openSubtitlesSection')}</p>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
              {t('settings.openSubtitlesCopy')}
            </p>
          </div>

          <form
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            onSubmit={(e) => { e.preventDefault(); saveOsMutation.mutate() }}
          >
            <label className="library-select-shell">
              <span>{t('settings.openSubtitlesApiKey')}</span>
              <input
                className="library-select"
                style={{ width: '100%' }}
                value={osApiKey}
                onChange={(e) => setOsApiKey(e.target.value)}
                placeholder={existingOsKey ? t('settings.apiKeyPlaceholder') : 'your-api-key'}
              />
            </label>

            {saveOsMutation.isSuccess ? (
              <p className="eyebrow" style={{ opacity: 0.7 }}>{t('settings.saved')}</p>
            ) : null}

            <button type="submit" className="primary-action" disabled={saveOsMutation.isPending || !osApiKey}>
              {saveOsMutation.isPending ? t('settings.saving') : t('settings.save')}
            </button>
          </form>
        </section>

        <section className="overview-card" style={{ padding: '2rem', gap: '1.25rem' }}>
          <p className="eyebrow">{t('settings.appearanceSection')}</p>

          <label className="library-select-shell">
            <span>{t('settings.language')}</span>
            <select
              value={locale}
              className="library-select"
              onChange={(e) => setLocale(e.target.value as Locale)}
              aria-label={t('locale.label')}
            >
              {supportedLocales.map((l) => (
                <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
              ))}
            </select>
          </label>

          <div className="settings-toggle-row settings-toggle-row-tv">
            <div className="settings-toggle-copy">
              <div className="settings-toggle-label">
                <Tv size={16} />
                {t('settings.tvMode')}
              </div>
              <p className="settings-toggle-description">{t('settings.tvModeCopy')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={tvMode}
              className={`toggle-switch${tvMode ? ' toggle-switch-on' : ''}`}
              onClick={() => setTvMode(!tvMode)}
              aria-label={t('settings.tvMode')}
            >
              <span className="toggle-switch-thumb" />
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
