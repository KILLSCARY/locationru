# syntax=docker/dockerfile:1

# Multi-stage build for the Resilient Taxi admin web app (Next.js).
#
# Stages:
#   deps    - full monorepo install (turbo needs the whole workspace graph
#             available even though admin-web itself has no internal
#             workspace dependencies today).
#   build   - `next build` with output: 'standalone' (see next.config.mjs),
#             which produces a self-contained server bundle plus its own
#             pruned node_modules under .next/standalone.
#   runtime - minimal final image: the standalone server + .next/static,
#             non-root, healthcheck. No devDependencies, no full
#             node_modules, no .env.

FROM node:22-alpine AS deps
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @resilient-taxi/admin-web... build

FROM node:22-alpine AS runtime

ARG BUILD_DATE
ARG VCS_REF
ARG VERSION=0.1.0

LABEL org.opencontainers.image.title="Resilient Taxi Admin Web" \
  org.opencontainers.image.description="Resilient Taxi admin console (Next.js)" \
  org.opencontainers.image.created="$BUILD_DATE" \
  org.opencontainers.image.revision="$VCS_REF" \
  org.opencontainers.image.version="$VERSION" \
  org.opencontainers.image.source="https://github.com/killscary/locationru"

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/admin-web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/admin-web/.next/static ./apps/admin-web/.next/static

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/admin-web/server.js"]
