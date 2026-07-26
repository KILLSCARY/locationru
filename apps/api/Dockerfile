FROM node:22-alpine AS build

WORKDIR /workspace

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @resilient-taxi/api build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /workspace

RUN corepack enable

COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json

USER node

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
