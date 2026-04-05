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

Create your local env file:

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

## Jellyfin Notes

Aurora uses Jellyfin as the system of record.

- API key access is enough for browsing, favorites, and most library features
- Username/password are used to create a real Jellyfin playback session so Aurora can sync progress and watched state more reliably
- `JELLYFIN_USER_ID` must be the actual Jellyfin user UUID, not the app name

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

Run locally:

```bash
docker run --rm -p 3000:3000 \
  -e JELLYFIN_URL=http://your-jellyfin:8096 \
  -e JELLYFIN_API_KEY=your_api_key \
  -e JELLYFIN_USER_ID=your_user_id \
  -e JELLYFIN_USERNAME=your_username \
  -e JELLYFIN_PASSWORD=your_password \
  ghcr.io/eliancodes/aurora-ui:latest
```

The container listens on port `3000`.

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
