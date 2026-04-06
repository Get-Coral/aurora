FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
ENV AURORA_DISABLE_SPA_PRERENDER=true
COPY . .
RUN pnpm build

FROM base AS prod-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV AURORA_DATA_DIR=/data
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server.mjs ./server.mjs

VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "server.mjs"]
