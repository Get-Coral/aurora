import { useMutation } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import {
  fetchSetupStatus,
  saveSetupConfiguration,
} from '../server/functions'

export const Route = createFileRoute('/setup')({
  loader: async () => {
    const setupStatus = await fetchSetupStatus()

    if (setupStatus.configured) {
      throw redirect({ to: '/' })
    }

    return setupStatus
  },
  component: SetupPage,
})

function SetupPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const setupStatus = Route.useLoaderData()
  const [url, setUrl] = useState(setupStatus.current.url)
  const [apiKey, setApiKey] = useState('')
  const [userId, setUserId] = useState(setupStatus.current.userId)
  const [username, setUsername] = useState(setupStatus.current.username)
  const [password, setPassword] = useState('')

  const setupMutation = useMutation({
    mutationFn: async () =>
      saveSetupConfiguration({
        data: { url, apiKey, userId, username, password },
      }),
    onSuccess: async () => {
      await navigate({ to: '/' })
    },
  })

  return (
    <main className="library-shell">
      <div className="page-wrap library-head">
        <div className="library-copy">
          <p className="eyebrow">{t('setup.subtitle')}</p>
          <h1 className="library-title">{t('setup.title')}</h1>
          <p className="library-summary">{t('setup.copy')}</p>
        </div>
      </div>

      <div
        className="page-wrap"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 18rem',
          gap: '1.5rem',
          alignItems: 'start',
          paddingTop: '2rem',
          paddingBottom: '4rem',
        }}
      >
        <form
          className="overview-card"
          style={{ padding: '2rem', gap: '1.25rem' }}
          onSubmit={(event) => {
            event.preventDefault()
            setupMutation.mutate()
          }}
        >
          <label className="library-select-shell">
            <span>{t('setup.serverUrl')}</span>
            <input
              className="library-select"
              style={{ width: '100%' }}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://localhost:8096"
            />
          </label>

          <label className="library-select-shell">
            <span>{t('setup.apiKey')}</span>
            <input
              className="library-select"
              style={{ width: '100%' }}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>

          <label className="library-select-shell">
            <span>{t('setup.userId')}</span>
            <input
              className="library-select"
              style={{ width: '100%' }}
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
          </label>

          <label className="library-select-shell">
            <span>{t('setup.username')}</span>
            <input
              className="library-select"
              style={{ width: '100%' }}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="library-select-shell">
            <span>{t('setup.password')}</span>
            <input
              type="password"
              className="library-select"
              style={{ width: '100%' }}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <p className="eyebrow" style={{ opacity: 0.6 }}>
            {t('setup.passwordHint')}
          </p>

          {setupMutation.error ? (
            <p className="detail-empty">
              {setupMutation.error instanceof Error
                ? setupMutation.error.message
                : t('setup.errorFallback')}
            </p>
          ) : null}

          <button type="submit" className="primary-action" disabled={setupMutation.isPending}>
            {setupMutation.isPending ? t('setup.saving') : t('setup.submit')}
          </button>
        </form>

        <aside className="overview-card" style={{ padding: '1.6rem', gap: '0.55rem' }}>
          <p className="eyebrow">{t('setup.helpTitle')}</p>
          <strong style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.95rem', lineHeight: 1.6, color: 'var(--ink-muted)' }}>
            {t('setup.helpCopy')}
          </strong>
        </aside>
      </div>
    </main>
  )
}
