# syntax=docker/dockerfile:1
#
# Arpoli Mailmanager no es una app Next.js "normal": está pensada para
# Cloudflare Workers (workerd) y se sirve con vinext + Wrangler. Por eso el
# contenedor compila el Worker y lo ejecuta con Wrangler/Miniflare en modo
# local; no usa `next start`.

FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=arpoli-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --store-dir /pnpm/store

COPY . .

# Compila el Worker y apunta las migraciones D1 al directorio drizzle/ del repo.
RUN pnpm run build \
 && node -e 'const fs=require("node:fs");const p="dist/server/wrangler.json";const c=JSON.parse(fs.readFileSync(p,"utf8"));for(const d of c.d1_databases??[])d.migrations_dir="/app/drizzle";fs.writeFileSync(p,JSON.stringify(c));' \
 && chmod +x docker/entrypoint.sh \
 && mkdir -p .wrangler/state .wrangler/config .sites-runtime \
 && chown -R node:node /app

ENV NODE_ENV=production \
    HOME=/app \
    XDG_CONFIG_HOME=/app/.wrangler/config \
    WRANGLER_SEND_METRICS=false \
    CLOUDFLARE_CF_FETCH_ENABLED=false \
    STATE_DIR=/app/.wrangler/state \
    PORT=3000 \
    DEMO_USER_EMAIL=ana.torres@example.com \
    DEMO_USER_NAME="Ana Torres"

USER node
EXPOSE 3000
VOLUME ["/app/.wrangler/state"]

ENTRYPOINT ["/app/docker/entrypoint.sh"]
