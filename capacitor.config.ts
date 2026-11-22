import type { CapacitorConfig } from '@capacitor/cli'

const serverUrl = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }
).process?.env?.['AURORA_APP_URL']?.trim()

const config: CapacitorConfig = {
  appId: 'dev.getcoral.aurora',
  appName: 'Aurora',
  webDir: 'dist/client',
  android: {
    // `cap run android` builds the Play Store app; the Quest build has its own
    // scripts (android:quest:*).
    flavor: 'standard',
  },
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