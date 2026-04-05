# Contributing to Aurora UI

Thanks for your interest in contributing! Here is everything you need to get started.

## Prerequisites

- Node.js 22+
- pnpm 10+
- A running Jellyfin instance (or use the onboarding flow with a test server)

## Local setup

```bash
pnpm install
cp .env.example .env  # fill in your Jellyfin details, or skip and use the /setup flow
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build |
| `pnpm start` | Run the production build locally |
| `pnpm test` | Run tests |

## Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm build` and `pnpm test` — both must pass
4. Open a pull request against `main`

## Adding a translation

Aurora's strings live in `src/lib/i18n/messages/`. To add a new language:

1. Copy `en.ts` to a new file (e.g. `fr.ts`)
2. Translate the strings
3. Export and register it in `src/lib/i18n/messages/index.ts`
4. Add the locale to the language picker if you want it selectable in the UI

## Code style

Aurora uses [Biome](https://biomejs.dev/) for formatting and linting. Your editor will pick it up automatically if you have the Biome extension installed. CI will fail on lint errors.

## Reporting bugs / requesting features

Use the GitHub issue templates — they keep reports consistent and actionable.

## Questions

Open a GitHub Discussion or drop an issue with the `question` label.
