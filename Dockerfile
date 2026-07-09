ARG NODE_IMAGE=ca7kangnvcl9wf.xuanyuan.run/library/node:20-alpine

FROM ${NODE_IMAGE} AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/types/package.json ./packages/types/
COPY packages/core/package.json ./packages/core/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/types ./packages/types
COPY packages/core ./packages/core
COPY apps/api ./apps/api
COPY apps/web ./apps/web

RUN pnpm --filter @wecom-platform/types build
RUN pnpm --filter @wecom-platform/core build
RUN pnpm --filter @wecom-platform/api build
RUN pnpm --filter @wecom-platform/web build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV WEB_DIST_DIR=/app/apps/web/dist

RUN apk add --no-cache git
RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/types/package.json ./packages/types/
COPY packages/core/package.json ./packages/core/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
