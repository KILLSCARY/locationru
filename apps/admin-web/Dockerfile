FROM node:22-alpine AS build

WORKDIR /workspace

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @resilient-taxi/admin-web build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /workspace

COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/admin-web/node_modules ./apps/admin-web/node_modules
COPY --from=build --chown=node:node /workspace/apps/admin-web/.next ./apps/admin-web/.next
COPY --from=build --chown=node:node /workspace/apps/admin-web/package.json ./apps/admin-web/package.json

USER node

EXPOSE 3000

CMD ["node", "apps/admin-web/node_modules/next/dist/bin/next", "start", "apps/admin-web", "--port", "3000"]
