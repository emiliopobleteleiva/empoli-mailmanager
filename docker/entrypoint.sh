#!/bin/sh
set -eu

CONFIG="${WRANGLER_CONFIG:-dist/server/wrangler.json}"
STATE_DIR="${STATE_DIR:-/app/.wrangler/state}"
WORKER_URL="http://127.0.0.1:8787"

mkdir -p "$STATE_DIR"

echo "[arpoli] Aplicando migraciones D1 locales..."
CI=1 node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
  d1 migrations apply DB --local --config "$CONFIG" --persist-to "$STATE_DIR"

echo "[arpoli] Iniciando Worker con Wrangler/Miniflare..."
set -- --config "$CONFIG" --local --persist-to "$STATE_DIR" \
  --ip 127.0.0.1 --port 8787 --inspector-port 0

# Las claves se pasan como bindings del Worker, igual que los secretos de
# Cloudflare. Si no están definidas, la app deshabilita o limita esa función.
if [ -n "${OPENAI_API_KEY:-}" ]; then
  set -- "$@" --var "OPENAI_API_KEY:${OPENAI_API_KEY}"
fi
if [ -n "${AUTHORIZED_PEOPLE:-}" ]; then
  set -- "$@" --var "AUTHORIZED_PEOPLE:${AUTHORIZED_PEOPLE}"
fi
if [ -n "${MAIL_PILOT_SENDER:-}" ]; then
  set -- "$@" --var "MAIL_PILOT_SENDER:${MAIL_PILOT_SENDER}"
fi
if [ -n "${MAIL_PILOT_RECIPIENT:-}" ]; then
  set -- "$@" --var "MAIL_PILOT_RECIPIENT:${MAIL_PILOT_RECIPIENT}"
fi
if [ -n "${MCP_OWNER_EMAIL:-}" ]; then
  set -- "$@" --var "MCP_OWNER_EMAIL:${MCP_OWNER_EMAIL}"
fi
if [ -n "${MS_TENANT_ID:-}" ]; then
  set -- "$@" --var "MS_TENANT_ID:${MS_TENANT_ID}"
fi
if [ -n "${MS_CLIENT_ID:-}" ]; then
  set -- "$@" --var "MS_CLIENT_ID:${MS_CLIENT_ID}"
fi
if [ -n "${MS_CLIENT_SECRET:-}" ]; then
  set -- "$@" --var "MS_CLIENT_SECRET:${MS_CLIENT_SECRET}"
fi

node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev "$@" &
WRANGLER_PID=$!

stop_worker() {
  kill -TERM "$WRANGLER_PID" 2>/dev/null || true
}
trap stop_worker EXIT
trap 'exit 0' INT TERM

attempts=0
until node -e 'fetch("http://127.0.0.1:8787/").then((r) => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))' >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 120 ]; then
    echo "[arpoli] El Worker no respondió en 120 s." >&2
    exit 1
  fi
  sleep 1
done

echo "[arpoli] Worker listo en ${WORKER_URL}"
echo "[arpoli] Interfaz en http://localhost:${PORT:-3000} (usuario local: ${DEMO_USER_EMAIL:-ana.torres@example.com})"

node docker/auth-proxy.mjs &
wait $!
