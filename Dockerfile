# syntax=docker/dockerfile:1
# Self-hosted production image (docs/VPS_MIGRATION.md). Built by
# .github/workflows/deploy-vps.yml; Vercel does not use this file.
#
# NEXT_PUBLIC_* values are inlined into the browser bundle by `next build`, so
# they are build arguments, not runtime settings: changing one needs a rebuild.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
ARG APP_BUILD_ID=local
ARG NEXT_PUBLIC_CONTACT_EMAIL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_ADS_ORIGIN
ARG NEXT_PUBLIC_GA_ID
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
# APP_ENV stands in for Vercel's VERCEL_ENV (MetaPixel.tsx). Set at build time
# too, because statically rendered pages read it while they are built.
ENV APP_ENV=production \
    APP_BUILD_ID=$APP_BUILD_ID \
    NEXT_TELEMETRY_DISABLED=1
# Like Vercel's build, this one needs the database: some pages are rendered
# from data at build time, and check-schema-sync refuses a build whose schema
# the database lacks. The URLs arrive as build secrets (never baked into a
# layer); deploy-vps.yml passes them. Without them the schema check skips and
# the data-backed pages fail the build.
RUN --mount=type=secret,id=database_url --mount=type=secret,id=database_url_unpooled \
    if [ -s /run/secrets/database_url ]; then \
      export DATABASE_URL="$(cat /run/secrets/database_url)" \
             DATABASE_URL_UNPOOLED="$(cat /run/secrets/database_url_unpooled)"; \
    fi; \
    npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
ARG APP_BUILD_ID=local
ENV NODE_ENV=production \
    APP_ENV=production \
    APP_BUILD_ID=$APP_BUILD_ID \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Next writes its image and data caches under .next/cache at runtime.
RUN mkdir -p .next/cache && chown -R node:node .next
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
