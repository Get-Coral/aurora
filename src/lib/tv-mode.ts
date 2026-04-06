import { useCallback, useEffect, useState } from 'react'
import { getClientPlaybackContext } from './platform'

const STORAGE_KEY = 'aurora-tv-mode'

export function getTvMode(): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
    return getClientPlaybackContext().prefersTvMode
  } catch {
    return false
  }
}

function applyTvMode(enabled: boolean) {
  document.documentElement.classList.toggle('tv-mode', enabled)
}

export function useTvMode() {
  const [tvMode, setTvModeState] = useState(false)

  // Read from localStorage after hydration. The init script in __root.tsx already
  // applies the class before paint, so there's no visual flash.
  useEffect(() => {
    setTvModeState(getTvMode())
  }, [])

  const setTvMode = useCallback((enabled: boolean) => {
    try {
      if (enabled) {
        window.localStorage.setItem(STORAGE_KEY, '1')
      } else {
        window.localStorage.setItem(STORAGE_KEY, '0')
      }
    } catch {
      // ignore
    }
    setTvModeState(enabled)
    applyTvMode(enabled)
  }, [])

  return { tvMode, setTvMode }
}
