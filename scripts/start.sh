#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
# .env is local configuration, not a downloaded file. Use shell-compatible values.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
export PATH="$ROOT/bin:$PATH"
export AGY_BRIDGE_NODE="${AGY_BRIDGE_NODE:-$(command -v node)}"
export AGY_BRIDGE_MAX_PROCS="${AGY_BRIDGE_MAX_PROCS:-2}"
export AGY_BRIDGE_IDLE_MS="${AGY_BRIDGE_IDLE_MS:-120000}"
export AGY_BRIDGE_START_TIMEOUT_MS="${AGY_BRIDGE_START_TIMEOUT_MS:-30000}"
export AGY_BRIDGE_TURN_TIMEOUT_MS="${AGY_BRIDGE_TURN_TIMEOUT_MS:-180000}"
export AGY_BRIDGE_STATE_FILE="${AGY_BRIDGE_STATE_FILE:-$ROOT/state/sessions.json}"
export AGY_CLI_DISABLE_AUTO_UPDATE="${AGY_CLI_DISABLE_AUTO_UPDATE:-true}"
mkdir -p "$(dirname -- "$AGY_BRIDGE_STATE_FILE")"
exec "$AGY_BRIDGE_NODE" "$ROOT/server.mjs"
