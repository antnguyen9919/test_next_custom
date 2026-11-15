# syntax=docker/dockerfile:1
# Build context: repo root (reuses the root lockfile for hono).
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY services/api ./services/api
# One self-contained file: hono + ws are inlined, no node_modules needed at runtime.
# (bufferutil/utf-8-validate/msgpackr-extract are optional native speedups.)
RUN pnpm exec esbuild services/api/index.ts --bundle --platform=node --format=cjs \
    --target=node20 --external:bufferutil --external:utf-8-validate --external:msgpackr-extract --outfile=/out/api.js

FROM node:24-slim
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build /out/api.js ./api.js
USER node
EXPOSE 4000
CMD ["node", "api.js"]
