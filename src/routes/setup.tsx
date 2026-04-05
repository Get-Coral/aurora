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
        data: {
          url,
          apiKey,
          userId,
          username,
          password,
        },
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

      <div className="page-wrap" style={{ display: 'grid', gap: '1.5rem', paddingBottom: '4rem' }}>
        <form
          className="dialog-panel"
          style={{ position: 'relative', inset: 'auto', width: '100%', maxWidth: '56rem', margin: '0 auto' }}
          onSubmit={(event) => {
            event.preventDefault()
            setupMutation.mutate()
          }}
        >
          <div className="dialog-body" style={{ gridTemplateColumns: '1.4fr .8fr' }}>
            <div className="dialog-copy" style={{ gap: '1rem' }}>
              <label className="library-select-shell">
                <span>{t('setup.serverUrl')}</span>
                <input
                  className="search-input"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="http://localhost:8096"
                />
              </label>

              <label className="library-select-shell">
                <span>{t('setup.apiKey')}</span>
                <input
                  className="search-input"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>

              <label className="library-select-shell">
                <span>{t('setup.userId')}</span>
                <input
                  className="search-input"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                />
              </label>

              <label className="library-select-shell">
                <span>{t('setup.username')}</span>
                <input
                  className="search-input"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>

              <label className="library-select-shell">
                <span>{t('setup.password')}</span>
                <input
                  type="password"
                  className="search-input"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>

              <p className="eyebrow" style={{ opacity: 0.8 }}>
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
            </div>

            <aside className="orbit-card" style={{ alignSelf: 'start' }}>
              <span>{t('setup.helpTitle')}</span>
              <strong>{t('setup.helpCopy')}</strong>
            </aside>
          </div>
        </form>
      </div>
    </main>
  )
}
