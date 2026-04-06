# Aurora UI

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-ElianCodes-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/ElianCodes)

Aurora UI is a premium Jellyfin frontend built with TanStack Start and React. It keeps Jellyfin as the source of truth while layering on a more cinematic home experience, richer detail views, embedded playback, favorites, genre browsing, and translation-ready UI foundations.

## Highlights

- Jellyfin-powered home screen with featured, continue watching, favorites, and recommendation rails
- Embedded playback with progress sync back to Jellyfin
- Rich title detail views with cast, related titles, and series episode context
- Movie and series library pages with genre browsing, sorting, and pagination
- `My List` / favorites workflow backed by Jellyfin favorites
- Translation-ready UI with locale files contributors can extend
- Local-first onboarding backed by SQLite so self-hosting does not require an external database

## Stack

- [TanStack Start](https://tanstack.com/start)
- React 19
- TanStack Router + TanStack Query
- Tailwind CSS v4
- Jellyfin API

## Getting Started

Install dependencies:

```bash
pnpm install
```

Create your local env file if you want to skip the in-app setup flow during development:

```bash
cp .env.example .env
```

Fill in the Jellyfin settings in `.env`:

```bash
JELLYFIN_URL=http://localhost:8096
JELLYFIN_API_KEY=your_api_key_here
JELLYFIN_USER_ID=your_user_id_here
JELLYFIN_USERNAME=your_username_here
JELLYFIN_PASSWORD=your_password_here
```

Start the app:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

If you do not provide Jellyfin env vars, Aurora will open a local onboarding screen at `/setup` and store the connection details in a local SQLite file under `./data/aurora.sqlite`.

## Scripts

```bash
pnpm dev
pnpm build
pnpm start
pnpm preview
pnpm test
```

## CI

GitHub Actions workflows are included for:

- CI on pushes and pull requests: install, test, build, and Docker build validation
- Docker publish to GitHub Container Registry on `main`, version tags, or manual dispatch

Workflow files:

- [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
- [`.github/workflows/docker-publish.yml`](./.github/workflows/docker-publish.yml)

## Local Storage

Aurora stores local app configuration in SQLite.

- Default database path: `./data/aurora.sqlite`
- Override with: `AURORA_DATA_DIR=/path/to/data`
- Main use today: persisted Jellyfin connection details for onboarding and self-hosted installs

This keeps Aurora simple to deploy on a VM or home server because there is no external database requirement.

## Jellyfin Notes

Aurora uses Jellyfin as the system of record.

- API key access is enough for browsing, favorites, and most library features
- Username/password are used to create a real Jellyfin playback session so Aurora can sync progress and watched state more reliably
- `JELLYFIN_USER_ID` must be the actual Jellyfin user UUID, not the app name
- If you use the onboarding flow, Aurora stores these values in local SQLite instead of requiring env vars

## Translations

Translations live in dedicated locale files so contributors can add languages without touching the runtime logic.

Files:

- [`src/lib/i18n/messages/en.ts`](./src/lib/i18n/messages/en.ts)
- [`src/lib/i18n/messages/nl.ts`](./src/lib/i18n/messages/nl.ts)
- [`src/lib/i18n/messages/index.ts`](./src/lib/i18n/messages/index.ts)

To add a new language:

1. Copy `src/lib/i18n/messages/en.ts` to a new file such as `fr.ts`
2. Translate the strings
3. Export and register the file in `src/lib/i18n/messages/index.ts`
4. Add the locale to the language picker if you want it selectable in the UI

## Docker

Aurora ships with a production Dockerfile and can be deployed to a VM with Docker or Docker Compose.

Build locally:

```bash
docker build -t aurora-ui .
```

Run locally with the onboarding flow:

```bash
docker run --rm -p 3000:3000 \
  -v aurora-data:/data \
  ghcr.io/eliancodes/aurora-ui:latest
```

Then open [http://localhost:3000](http://localhost:3000) and complete the Jellyfin onboarding form once. Aurora will persist the connection in `/data/aurora.sqlite`.

If you prefer skipping onboarding, you can still pass the Jellyfin env vars directly:

```bash
docker run --rm -p 3000:3000 \
  -v aurora-data:/data \
  -e JELLYFIN_URL=http://your-jellyfin:8096 \
  -e JELLYFIN_API_KEY=your_api_key \
  -e JELLYFIN_USER_ID=your_user_id \
  -e JELLYFIN_USERNAME=your_username \
  -e JELLYFIN_PASSWORD=your_password \
  ghcr.io/eliancodes/aurora-ui:latest
```

The container listens on port `3000` and stores local config in `/data`.

## Capacitor Wrappers

Aurora now supports a real local Capacitor build for Android and iOS.

How it works:

- Capacitor uses the built local web bundle from `dist/client`.
- TanStack Start SPA mode now emits a real `dist/client/index.html`, which Capacitor requires.
- `pnpm cap:sync`, `pnpm cap:copy`, and `pnpm cap:run:*` build Aurora first and then sync the native projects.
- In native-shell mode, Aurora stores Jellyfin and OpenSubtitles settings in device-local storage instead of relying on the Node server.

The Capacitor config lives in [`capacitor.config.ts`](./capacitor.config.ts).

### Native Setup

Sync the latest web assets into Android and iOS:

```bash
pnpm cap:sync
```

Open the native projects:

```bash
pnpm cap:open:android
pnpm cap:open:ios
```

Run directly to a connected device or emulator:

```bash
pnpm cap:run:android
pnpm cap:run:ios
```

### First Launch

On first launch in the native app:

1. Open the `/setup` flow.
2. Enter the Jellyfin server URL, API key, user ID, username, and password.
3. Optionally add your OpenSubtitles API key in settings.

Aurora stores that configuration on the device.

### What Works Locally

- Setup and settings
- Home feeds
- Movie and series library browsing
- Search
- My List and favorites toggles
- History
- Media details and episode browsing
- Basic local playback bootstrapping
- OpenSubtitles search and download using the stored API key

### Current Limits

- The admin screen is still server-oriented.
- Native playback works locally, but full Jellyfin playback-session and progress sync is still less complete than the hosted server build.
- If you want the native shell to target a hosted Aurora deployment instead, you can still set `AURORA_APP_URL` before syncing.

Example hosted override:

```bash
AURORA_APP_URL=https://your-aurora-domain.example pnpm cap:sync
```

### Packaging Notes

- Android packaging happens from Android Studio after opening the generated project.
- iOS packaging happens from Xcode after opening the generated project.
- Google TV should be treated as an Android TV target using the same Capacitor Android project once the TV UX is finalized.

Published images go to:

- `ghcr.io/<owner>/<repo>`

For this repository, that will be:

- `ghcr.io/eliancodes/aurora-ui`

## Contributing

Issues and pull requests are welcome.

If you want to contribute:

1. Fork the repo
2. Create a branch
3. Make your changes
4. Run `pnpm build`
5. Open a pull request

## Sponsoring

If Aurora helps you or you want to support ongoing work, you can sponsor the project here:

- [GitHub Sponsors: ElianCodes](https://github.com/sponsors/ElianCodes)

## License

Aurora UI is released under the [MIT License](./LICENSE).
