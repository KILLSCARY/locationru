# syntax=docker/dockerfile:1

# Multi-stage build for the Resilient Taxi API.
#
# Stages:
#   deps    - full monorepo install (needed to build every workspace package)
#   build   - compiles @resilient-taxi/config and @resilient-taxi/api; also
#             the base the `migrate` compose service builds from, since
#             `prisma migrate deploy` needs the Prisma CLI (a devDependency)
#             plus prisma/schema.prisma and prisma/migrations/ — none of
#             which belong in the runtime image.
#   deploy  - `pnpm deploy` prunes apps/api down to a self-contained
#             directory with only production dependencies (built workspace
#             deps included), so devDependencies never reach the final image.
#   runtime - minimal final image: pruned deploy output, non-root, healthcheck.

FROM node:22-alpine AS deps
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @resilient-taxi/api... build

FROM build AS deploy
RUN pnpm --filter @resilient-taxi/api deploy --prod --legacy /prod/api

FROM node:22-alpine AS runtime

ARG BUILD_DATE
ARG VCS_REF
ARG VERSION=0.1.0

LABEL org.opencontainers.image.title="Resilient Taxi API" \
  org.opencontainers.image.description="Resilient Taxi backend API (NestJS)" \
  org.opencontainers.image.created="$BUILD_DATE" \
  org.opencontainers.image.revision="$VCS_REF" \
  org.opencontainers.image.version="$VERSION" \
  org.opencontainers.image.source="https://github.com/killscary/locationru"

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deploy --chown=node:node /prod/api/dist ./dist
COPY --from=deploy --chown=node:node /prod/api/node_modules ./node_modules
COPY --from=deploy --chown=node:node /prod/api/package.json ./package.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
