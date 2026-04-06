export interface ClientJellyfinSettings {
  url: string
  apiKey: string
  userId: string
  username: string
  password: string
}

type SettingsSource = 'local-storage' | 'missing'

const JELLYFIN_SETTINGS_KEY = 'aurora.client.jellyfin-settings'
const OPEN_SUBTITLES_KEY = 'aurora.client.opensubtitles-api-key'

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(key, JSON.stringify(value))
}

function normalizeSettings(settings: Partial<ClientJellyfinSettings>): Partial<ClientJellyfinSettings> {
  return {
    url: settings.url?.trim(),
    apiKey: settings.apiKey?.trim(),
    userId: settings.userId?.trim(),
    username: settings.username?.trim(),
    password: settings.password?.trim(),
  }
}

function areSettingsComplete(settings: Partial<ClientJellyfinSettings>): settings is ClientJellyfinSettings {
  return Boolean(
    settings.url
      && settings.apiKey
      && settings.userId
      && settings.username
      && settings.password,
  )
}

export function getStoredClientJellyfinSettings(): Partial<ClientJellyfinSettings> {
  return normalizeSettings(readJson<Partial<ClientJellyfinSettings>>(JELLYFIN_SETTINGS_KEY) ?? {})
}

export function getEffectiveClientJellyfinSettings(): ClientJellyfinSettings | null {
  const stored = getStoredClientJellyfinSettings()
  return areSettingsComplete(stored) ? stored : null
}

export function getClientJellyfinSettingsSource(): SettingsSource {
  return getEffectiveClientJellyfinSettings() ? 'local-storage' : 'missing'
}

export function getClientConfigurationSummary() {
  const stored = getStoredClientJellyfinSettings()
  const effective = getEffectiveClientJellyfinSettings()

  return {
    configured: Boolean(effective),
    source: getClientJellyfinSettingsSource(),
    current: {
      url: stored.url ?? effective?.url ?? '',
      userId: stored.userId ?? effective?.userId ?? '',
      username: stored.username ?? effective?.username ?? '',
      hasApiKey: Boolean(stored.apiKey ?? effective?.apiKey),
      hasPassword: Boolean(stored.password ?? effective?.password),
    },
  }
}

export function saveClientJellyfinSettings(settings: ClientJellyfinSettings) {
  writeJson(JELLYFIN_SETTINGS_KEY, normalizeSettings(settings))
}

export function getClientOpenSubtitlesApiKey() {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage.getItem(OPEN_SUBTITLES_KEY)
  } catch {
    return null
  }
}

export function saveClientOpenSubtitlesApiKey(apiKey: string) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(OPEN_SUBTITLES_KEY, apiKey.trim())
}

export async function validateClientJellyfinSettings(settings: ClientJellyfinSettings) {
  const normalized = normalizeSettings(settings)

  if (!areSettingsComplete(normalized)) {
    throw new Error('Every Jellyfin field is required.')
  }

  const baseUrl = normalized.url.replace(/\/+$/, '')
  const authHeader =
    'MediaBrowser Client="Aurora", Device="Aurora Local", DeviceId="aurora-ui-local", Version="1.0.0"'

  const userUrl = new URL(`${baseUrl}/Users/${normalized.userId}`)
  userUrl.searchParams.set('api_key', normalized.apiKey)

  const userResponse = await fetch(userUrl.toString(), { cache: 'no-store' })

  if (!userResponse.ok) {
    throw new Error('Jellyfin rejected the server URL, API key, or user id.')
  }

  const authResponse = await fetch(`${baseUrl}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': authHeader,
    },
    body: JSON.stringify({
      Username: normalized.username,
      Pw: normalized.password,
    }),
  })

  if (!authResponse.ok) {
    throw new Error('Jellyfin rejected the username or password.')
  }

  return {
    ...normalized,
    url: baseUrl,
  }
}