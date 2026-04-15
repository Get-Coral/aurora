export type ClientPlatform = 'ios' | 'android' | 'android-tv' | 'other'

export interface ClientPlaybackContext {
  platform: ClientPlatform
  prefersSafeVideo: boolean
  prefersTvMode: boolean
}

interface DetectClientPlaybackContextOptions {
  userAgent?: string
  maxTouchPoints?: number
}

const DEFAULT_CONTEXT: ClientPlaybackContext = {
  platform: 'other',
  prefersSafeVideo: false,
  prefersTvMode: false,
}

function matchesAny(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate))
}

export function detectClientPlaybackContext(
  options: DetectClientPlaybackContextOptions = {},
): ClientPlaybackContext {
  const userAgent = options.userAgent?.toLowerCase() ?? ''
  const maxTouchPoints = options.maxTouchPoints ?? 0

  if (!userAgent) return DEFAULT_CONTEXT

  const isIos = matchesAny(userAgent, ['iphone', 'ipad', 'ipod'])
    || (userAgent.includes('macintosh') && maxTouchPoints > 1)
  const isAndroid = !isIos && userAgent.includes('android')
  const isAndroidTv = matchesAny(userAgent, [
    'android tv',
    'googletv',
    'google tv',
    'afts',
    'aftt',
    'aftm',
    'bravia',
    'smarttv',
    'hbbtv',
  ])
  // Desktop Safari: has "safari" in UA but not "chrome"/"chromium".
  // Safari does not support VP8/VP9/AV1/Opus/FLAC, so we must force
  // transcoding to H.264/AAC to prevent direct-play failures.
  const isDesktopSafari = !isIos
    && userAgent.includes('safari')
    && !userAgent.includes('chrome')
    && !userAgent.includes('chromium')

  if (isIos || isDesktopSafari) {
    return {
      platform: isIos ? 'ios' : 'other',
      prefersSafeVideo: true,
      prefersTvMode: false,
    }
  }

  if (isAndroidTv) {
    return {
      platform: 'android-tv',
      prefersSafeVideo: true,
      prefersTvMode: true,
    }
  }

  if (isAndroid) {
    return {
      platform: 'android',
      prefersSafeVideo: false,
      prefersTvMode: false,
    }
  }

  return DEFAULT_CONTEXT
}

export function getClientPlaybackContext(): ClientPlaybackContext {
  if (typeof navigator === 'undefined') return DEFAULT_CONTEXT

  return detectClientPlaybackContext({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  })
}