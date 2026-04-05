import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface JellyfinSettings {
  url: string
  apiKey: string
  userId: string
  username: string
  password: string
}

type SettingsSource = 'database' | 'env' | 'merged' | 'missing'

function getDataDirectory() {
  return process.env['AURORA_DATA_DIR'] ?? path.join(process.cwd(), 'data')
}

function getDatabasePath() {
  return path.join(getDataDirectory(), 'aurora.sqlite')
}

let database: DatabaseSync | null = null

const CREATE_TABLE_SQL = [
  'CREATE TABLE IF NOT EXISTS app_settings (',
  '  key TEXT PRIMARY KEY,',
  '  value TEXT NOT NULL,',
  '  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP',
  ');',
].join('\n')

function getDatabase() {
  if (database) return database

  fs.mkdirSync(getDataDirectory(), { recursive: true })
  database = new DatabaseSync(getDatabasePath())
  database.exec(CREATE_TABLE_SQL)

  return database
}

function getSetting(key: string) {
  const statement = getDatabase().prepare('SELECT value FROM app_settings WHERE key = ?')
  const row = statement.get(key) as { value?: string } | undefined
  return row?.value
}

const UPSERT_SQL = [
  'INSERT INTO app_settings (key, value, updated_at)',
  'VALUES (?, ?, CURRENT_TIMESTAMP)',
  'ON CONFLICT(key) DO UPDATE SET',
  '  value = excluded.value,',
  '  updated_at = CURRENT_TIMESTAMP',
].join('\n')

function setSetting(key: string, value: string) {
  const statement = getDatabase().prepare(UPSERT_SQL)
  statement.run(key, value)
}

function readEnvSettings(): Partial<JellyfinSettings> {
  return {
    url: process.env['JELLYFIN_URL']?.trim(),
    apiKey: process.env['JELLYFIN_API_KEY']?.trim(),
    userId: process.env['JELLYFIN_USER_ID']?.trim(),
    username: process.env['JELLYFIN_USERNAME']?.trim(),
    password: process.env['JELLYFIN_PASSWORD']?.trim(),
  }
}

export function getStoredJellyfinSettings(): Partial<JellyfinSettings> {
  return {
    url: getSetting('jellyfin.url')?.trim(),
    apiKey: getSetting('jellyfin.apiKey')?.trim(),
    userId: getSetting('jellyfin.userId')?.trim(),
    username: getSetting('jellyfin.username')?.trim(),
    password: getSetting('jellyfin.password')?.trim(),
  }
}

function normalizeSettings(settings: Partial<JellyfinSettings>): Partial<JellyfinSettings> {
  return {
    url: settings.url?.trim(),
    apiKey: settings.apiKey?.trim(),
    userId: settings.userId?.trim(),
    username: settings.username?.trim(),
    password: settings.password?.trim(),
  }
}

function areSettingsComplete(settings: Partial<JellyfinSettings>): settings is JellyfinSettings {
  return Boolean(
    settings.url &&
      settings.apiKey &&
      settings.userId &&
      settings.username &&
      settings.password,
  )
}

export function getEffectiveJellyfinSettings(): JellyfinSettings | null {
  const stored = normalizeSettings(getStoredJellyfinSettings())
  const env = normalizeSettings(readEnvSettings())
  const merged = {
    url: stored.url || env.url,
    apiKey: stored.apiKey || env.apiKey,
    userId: stored.userId || env.userId,
    username: stored.username || env.username,
    password: stored.password || env.password,
  }

  return areSettingsComplete(merged) ? merged : null
}

export function getJellyfinSettingsSource(): SettingsSource {
  const stored = normalizeSettings(getStoredJellyfinSettings())
  const env = normalizeSettings(readEnvSettings())

  const storedComplete = areSettingsComplete(stored)
  const envComplete = areSettingsComplete(env)

  if (storedComplete) return 'database'
  if (envComplete) return 'env'
  if (Object.values({ ...stored, ...env }).some(Boolean)) return 'merged'
  return 'missing'
}

export function isAuroraConfigured() {
  return getEffectiveJellyfinSettings() != null
}

export function getConfigurationSummary() {
  const stored = normalizeSettings(getStoredJellyfinSettings())
  const effective = getEffectiveJellyfinSettings()

  return {
    configured: Boolean(effective),
    source: getJellyfinSettingsSource(),
    current: {
      url: stored.url ?? effective?.url ?? '',
      userId: stored.userId ?? effective?.userId ?? '',
      username: stored.username ?? effective?.username ?? '',
      hasApiKey: Boolean(stored.apiKey ?? effective?.apiKey),
      hasPassword: Boolean(stored.password ?? effective?.password),
    },
  }
}

export function getOpenSubtitlesApiKey(): string | null {
  return getSetting('opensubtitles.apiKey') ?? null
}

export function saveOpenSubtitlesApiKey(apiKey: string) {
  setSetting('opensubtitles.apiKey', apiKey.trim())
}

export function saveJellyfinSettings(settings: JellyfinSettings) {
  setSetting('jellyfin.url', settings.url.trim())
  setSetting('jellyfin.apiKey', settings.apiKey.trim())
  setSetting('jellyfin.userId', settings.userId.trim())
  setSetting('jellyfin.username', settings.username.trim())
  setSetting('jellyfin.password', settings.password.trim())
}

export async function validateJellyfinSettings(settings: JellyfinSettings) {
  const normalized = normalizeSettings(settings)

  if (!areSettingsComplete(normalized)) {
    throw new Error('Every Jellyfin field is required.')
  }

  const baseUrl = normalized.url.replace(/\/+$/, '')
  const authHeader =
    'MediaBrowser Client="Aurora", Device="Aurora Web", DeviceId="aurora-ui-web", Version="1.0.0"'

  const userUrl = new URL(`${baseUrl}/Users/${normalized.userId}`)
  userUrl.searchParams.set('api_key', normalized.apiKey)

  const userResponse = await fetch(userUrl)

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

  return normalized
}
