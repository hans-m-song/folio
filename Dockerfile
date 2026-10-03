FROM node:24-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY tsconfig.json vite.config.ts ./
COPY ops/build-database-tools.mjs ./ops/build-database-tools.mjs
RUN pnpm run build && pnpm run build:database

FROM node:24-alpine AS runtime
ENV NODE_ENV=production NITRO_HOST=0.0.0.0 NITRO_PORT=3000
WORKDIR /app
COPY --from=build /app/.output ./
COPY migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "server/index.mjs"]
