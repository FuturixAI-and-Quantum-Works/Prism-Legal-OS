# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY packages/protocol/package.json ./packages/protocol/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=@prism/backend --workspace=@prism/protocol

COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY packages/protocol/src ./packages/protocol/src
COPY packages/protocol/tsconfig.json ./packages/protocol/tsconfig.json

RUN npm run build --workspace=@prism/protocol \
    && npm run build --workspace=@prism/backend \
    && node -e "const fs=require('node:fs');const path='packages/protocol/package.json';const manifest=JSON.parse(fs.readFileSync(path,'utf8'));manifest.exports={'.':'./dist/index.js'};fs.writeFileSync(path,JSON.stringify(manifest))"

FROM node:${NODE_VERSION}-bookworm-slim AS production-dependencies

WORKDIR /app
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY packages/protocol/package.json ./packages/protocol/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace=@prism/backend --workspace=@prism/protocol

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        chromium \
        fonts-dejavu-core \
        fonts-liberation \
        fonts-noto-core \
        libreoffice-writer \
        procps \
        tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8003 \
    HOME=/home/node \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/backend ./backend
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --chown=node:node backend/drizzle ./backend/drizzle
COPY --chown=node:node backend/data/seed-packs ./backend/data/seed-packs
COPY --chown=node:node LICENSE ./LICENSE
COPY --chown=node:node docs/template-license.md docs/template-provenance.json ./docs/
COPY --from=build --chown=node:node /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build --chown=node:node /app/packages/protocol/dist ./packages/protocol/dist

RUN mkdir -p /app/data /app/secrets && chown node:node /app/data /app/secrets

WORKDIR /app/backend
USER node
EXPOSE 8003
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
