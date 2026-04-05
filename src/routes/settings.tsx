import { useMutation } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useI18n, supportedLocales } from '../lib/i18n'
import type { Locale } from '../lib/i18n'
import { fetchSetupStatus, saveSettings } from '../server/functions'

export const Route = createFileRoute('/settings')({
  loader: async () => {
    const setupStatus = await fetchSetupStatus()
    if (!setupStatus.configured) {
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
  const setupStatus = Route.useLoaderData()

  const [url, setUrl] = useState(setupStatus.current.url)
  const [apiKey, setApiKey] = useState('')
  const [userId, setUserId] = useState(setupStatus.current.userId)
  const [username, setUsername] = useState(setupStatus.current.username)
  const [password, setPassword] = useState('')

  const saveMutation = useMutation({
    mutationFn: () => saveSettings({ data: { url, apiKey, userId, username, password } }),
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
        </section>
      </div>
    </main>
  )
}
