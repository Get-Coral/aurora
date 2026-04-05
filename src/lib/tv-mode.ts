import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'aurora-tv-mode'

export function getTvMode(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
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
        window.localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // ignore
    }
    setTvModeState(enabled)
    applyTvMode(enabled)
  }, [])

  return { tvMode, setTvMode }
}
