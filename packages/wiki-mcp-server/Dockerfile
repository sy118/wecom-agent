FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git
RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/wiki-mcp-server/package.json ./packages/wiki-mcp-server/

RUN pnpm install --filter @wecom-platform/wiki-mcp-server --frozen-lockfile

COPY packages/wiki-mcp-server ./packages/wiki-mcp-server

RUN pnpm --filter @wecom-platform/wiki-mcp-server build

WORKDIR /app/packages/wiki-mcp-server

EXPOSE 3001

CMD ["node", "dist/index.js"]
