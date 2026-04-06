import { useEffect } from 'react'
import { getClientPlaybackContext } from '../lib/platform'
import { installTvSpatialNavigation } from '../lib/tv-spatial-navigation'

const IS_DEV = import.meta.env.DEV

export function AppBootstrap() {
  useEffect(() => {
    const root = document.documentElement
    const platform = getClientPlaybackContext()

    root.dataset.platform = platform.platform
    root.classList.toggle('touch-platform', navigator.maxTouchPoints > 0)
  }, [])

  useEffect(() => installTvSpatialNavigation(), [])

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    if (IS_DEV) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister()
        })
      })

      if ('caches' in window) {
        void caches.keys().then((cacheNames) => {
          cacheNames.forEach((cacheName) => {
            void caches.delete(cacheName)
          })
        })
      }

      return
    }

    let cancelled = false

    function emitUpdateReady(registration: ServiceWorkerRegistration) {
      window.dispatchEvent(new CustomEvent('aurora:pwa-update-ready', {
        detail: { registration },
      }))
    }

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        if (cancelled) return

        if (registration.waiting) {
          emitUpdateReady(registration)
        }

        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing
          if (!installingWorker) return

          installingWorker.addEventListener('statechange', () => {
            if (
              installingWorker.state === 'installed'
              && navigator.serviceWorker.controller
            ) {
              emitUpdateReady(registration)
            }
          })
        })
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to register Aurora service worker.', error)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return null
}