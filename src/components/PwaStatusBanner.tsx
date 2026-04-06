import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Download, RefreshCw, Smartphone, WifiOff } from 'lucide-react'
import { localeMessages, supportedLocales } from '../lib/i18n/messages'
import type { Locale } from '../lib/i18n'
import { getClientPlaybackContext } from '../lib/platform'

type PwaUpdateDetail = {
  registration: ServiceWorkerRegistration
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const CONNECTIVITY_CHECK_PATH = '/healthz'
const CONNECTIVITY_RETRY_MS = 30_000
const IS_DEV = import.meta.env.DEV

export function PwaStatusBanner() {
  if (IS_DEV) return null

  const [isOffline, setIsOffline] = useState(false)
  const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false)
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosInstallHint, setShowIosInstallHint] = useState(false)
  const [dismissedInstallHint, setDismissedInstallHint] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const platform = useMemo(() => getClientPlaybackContext().platform, [])
  const locale = useMemo<Locale>(() => {
    if (typeof document !== 'undefined') {
      const lang = document.documentElement.lang.toLowerCase()
      const matched = supportedLocales.find((candidate) => lang.startsWith(candidate))
      if (matched) return matched
    }

    if (typeof navigator !== 'undefined') {
      const browserLocale = navigator.language.toLowerCase()
      const matched = supportedLocales.find((candidate) => browserLocale.startsWith(candidate))
      if (matched) return matched
    }

    return 'en'
  }, [])
  const dictionary = localeMessages[locale] ?? localeMessages.en

  function t(key: string) {
    const entry = dictionary[key] ?? localeMessages.en[key] ?? key
    return typeof entry === 'function' ? entry(undefined) : entry
  }

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    function syncStandaloneMode() {
      const standalone = window.matchMedia('(display-mode: standalone)').matches
        || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
      setIsStandalone(standalone)
      setShowIosInstallHint(platform === 'ios' && !standalone)
      if (standalone) {
        setInstallPromptEvent(null)
      }
    }

    async function syncConnectivity() {
      if (typeof window === 'undefined') return

      if (!navigator.onLine) {
        if (!cancelled) setIsOffline(true)
        return
      }

      try {
        const response = await fetch(`${CONNECTIVITY_CHECK_PATH}?t=${Date.now()}`, {
          method: 'HEAD',
          cache: 'no-store',
        })

        if (!cancelled) {
          setIsOffline(!response.ok && response.status !== 204)
        }
      } catch {
        if (!cancelled) setIsOffline(true)
      }
    }

    function handleOnline() {
      void syncConnectivity()
    }

    function handleOffline() {
      setIsOffline(true)
    }

    function handleUpdateReady(event: Event) {
      const customEvent = event as CustomEvent<PwaUpdateDetail>
      setUpdateRegistration(customEvent.detail.registration)
      setIsApplyingUpdate(false)
    }

    function handleControllerChange() {
      window.location.reload()
    }

    function handleBeforeInstallPrompt(event: Event) {
      if (platform !== 'android') return

      const promptEvent = event as BeforeInstallPromptEvent
      promptEvent.preventDefault()
      setInstallPromptEvent(promptEvent)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('aurora:pwa-update-ready', handleUpdateReady as EventListener)
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
    navigator.serviceWorker?.addEventListener('controllerchange', handleControllerChange)
    syncStandaloneMode()
    void syncConnectivity()
    intervalId = setInterval(() => {
      void syncConnectivity()
    }, CONNECTIVITY_RETRY_MS)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('aurora:pwa-update-ready', handleUpdateReady as EventListener)
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
      navigator.serviceWorker?.removeEventListener('controllerchange', handleControllerChange)
    }
  }, [platform])

  function dismissUpdate() {
    setUpdateRegistration(null)
    setIsApplyingUpdate(false)
  }

  function applyUpdate() {
    if (!updateRegistration?.waiting) {
      window.location.reload()
      return
    }

    setIsApplyingUpdate(true)
    updateRegistration.waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  async function promptInstall() {
    if (!installPromptEvent) return

    await installPromptEvent.prompt()
    const choice = await installPromptEvent.userChoice.catch(() => null)

    if (choice?.outcome === 'accepted') {
      setInstallPromptEvent(null)
      setDismissedInstallHint(true)
    }
  }

  function dismissInstallHint() {
    setDismissedInstallHint(true)
    setInstallPromptEvent(null)
    setShowIosInstallHint(false)
  }

  const showAndroidInstallPrompt = platform === 'android' && !isStandalone && !dismissedInstallHint && installPromptEvent != null
  const showIosHint = platform === 'ios' && !isStandalone && !dismissedInstallHint && showIosInstallHint

  if (!isOffline && !updateRegistration && !showAndroidInstallPrompt && !showIosHint) return null

  return (
    <div className="pwa-status-stack" aria-live="polite">
      {showAndroidInstallPrompt ? (
        <div className="pwa-status-card pwa-status-card-install">
          <div className="pwa-status-icon-shell pwa-status-icon-shell-install">
            <Download size={16} />
          </div>
          <div className="pwa-status-copy">
            <strong>{t('pwa.installBannerTitle')}</strong>
            <p>{t('pwa.installBannerCopy')}</p>
          </div>
          <button type="button" className="pwa-status-action" onClick={() => void promptInstall()}>
            {t('pwa.installAction')}
          </button>
          <button type="button" className="pwa-status-dismiss" onClick={dismissInstallHint} aria-label={t('pwa.dismiss')}>
            {t('pwa.dismiss')}
          </button>
        </div>
      ) : null}

      {showIosHint ? (
        <div className="pwa-status-card pwa-status-card-install">
          <div className="pwa-status-icon-shell pwa-status-icon-shell-install">
            <Smartphone size={16} />
          </div>
          <div className="pwa-status-copy">
            <strong>{t('pwa.iosInstallTitle')}</strong>
            <p>{t('pwa.iosInstallCopy')}</p>
          </div>
          <button type="button" className="pwa-status-dismiss" onClick={dismissInstallHint} aria-label={t('pwa.dismiss')}>
            {t('pwa.dismiss')}
          </button>
        </div>
      ) : null}

      {isOffline ? (
        <div className="pwa-status-card">
          <div className="pwa-status-icon-shell">
            <WifiOff size={16} />
          </div>
          <div className="pwa-status-copy">
            <strong>{t('pwa.offlineBannerTitle')}</strong>
            <p>{t('pwa.offlineBannerCopy')}</p>
          </div>
          <Link to="/offline" className="pwa-status-action">
            {t('pwa.offlineAction')}
          </Link>
        </div>
      ) : null}

      {updateRegistration ? (
        <div className="pwa-status-card pwa-status-card-accent">
          <div className="pwa-status-icon-shell pwa-status-icon-shell-accent">
            <RefreshCw size={16} className={isApplyingUpdate ? 'pwa-status-spin' : undefined} />
          </div>
          <div className="pwa-status-copy">
            <strong>{t('pwa.updateBannerTitle')}</strong>
            <p>{t('pwa.updateBannerCopy')}</p>
          </div>
          <button type="button" className="pwa-status-action" onClick={applyUpdate} disabled={isApplyingUpdate}>
            {isApplyingUpdate ? t('pwa.updateApplying') : t('pwa.updateAction')}
          </button>
          <button type="button" className="pwa-status-dismiss" onClick={dismissUpdate} aria-label={t('pwa.dismiss')}>
            {t('pwa.dismiss')}
          </button>
        </div>
      ) : null}
    </div>
  )
}