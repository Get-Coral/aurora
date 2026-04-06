import { createFileRoute, Link } from '@tanstack/react-router'
import { WifiOff } from 'lucide-react'
import { useI18n } from '../lib/i18n'

export const Route = createFileRoute('/offline')({
  component: OfflinePage,
})

function OfflinePage() {
  const { t } = useI18n()

  return (
    <main className="offline-shell">
      <section className="offline-card">
        <div className="offline-icon-shell">
          <WifiOff size={26} />
        </div>
        <p className="eyebrow">{t('pwa.offlineEyebrow')}</p>
        <h1 className="offline-title">{t('pwa.offlineTitle')}</h1>
        <p className="offline-copy">{t('pwa.offlineCopy')}</p>

        <div className="offline-actions">
          <button type="button" className="primary-action" onClick={() => window.location.reload()}>
            {t('pwa.retryAction')}
          </button>
          <Link to="/" className="secondary-action">
            {t('error.notFound.cta')}
          </Link>
        </div>
      </section>
    </main>
  )
}