import { Bug } from 'lucide-react'
import { useI18n } from '../lib/i18n'

export default function Footer() {
  const { t } = useI18n()

  return (
    <footer className="site-footer">
      <div className="page-wrap site-footer-inner">
        <p className="site-footer-copy">
          {t('footer.builtWith')} <span aria-hidden="true">❤️</span> {t('footer.by')}{' '}
          <a
            href="https://github.com/ElianCodes"
            target="_blank"
            rel="noreferrer"
          >
            ElianCodes
          </a>
        </p>

        <div className="site-footer-links">
          <a
            className="site-footer-bug-link"
            href="https://github.com/ElianCodes/aurora-ui/issues/new?template=bug_report.md"
            target="_blank"
            rel="noreferrer"
            title={t('footer.reportBug')}
          >
            <Bug size={14} />
            {t('footer.reportBug')}
          </a>

          <a
            className="site-footer-link"
            href="https://github.com/ElianCodes/aurora-ui"
            target="_blank"
            rel="noreferrer"
          >
            {t('footer.contribute')}
          </a>
        </div>
      </div>
    </footer>
  )
}
