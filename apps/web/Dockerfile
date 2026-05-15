FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY apps/web/package.json ./
RUN pnpm install --frozen-lockfile

COPY apps/web ./
RUN pnpm build

FROM nginx:alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
