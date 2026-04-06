import type { CapacitorConfig } from '@capacitor/cli'

const serverUrl = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }
).process?.env?.['AURORA_APP_URL']?.trim()

const config: CapacitorConfig = {
  appId: 'com.eliancodes.aurora',
  appName: 'Aurora',
  webDir: 'dist/client',
  ios: {
    contentInset: 'always',
  },
  server: {
    hostname: 'localhost',
    androidScheme: 'http',
    ...(serverUrl
      ? {
          url: serverUrl,
          cleartext: serverUrl.startsWith('http://'),
        }
      : {}),
  },
}

export default config