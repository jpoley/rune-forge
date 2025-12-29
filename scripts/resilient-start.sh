#!/bin/bash
# Resilient startup script for Rune Forge
# Kills existing process on port and auto-restarts on failure

PORT=${PORT:-41204}
MAX_RETRIES=${MAX_RETRIES:-0}  # 0 = infinite
RETRY_DELAY=${RETRY_DELAY:-2}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

retry_count=0

log() {
  echo "[$(date '+%H:%M:%S')] $1"
}

kill_port() {
  local port=$1
  local pids=$(lsof -ti tcp:"$port" 2>/dev/null)

  if [ -n "$pids" ]; then
    log "🔪 Killing process(es) on port $port: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

cleanup() {
  log "🛑 Shutting down..."
  kill_port "$PORT"
  exit 0
}

trap cleanup SIGINT SIGTERM

cd "$PROJECT_ROOT"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  log "📦 Installing dependencies..."
  pnpm install
fi

# Build simulation once at startup
log "🔨 Building simulation package..."
pnpm run build:simulation

log "🚀 Starting Rune Forge on port $PORT (resilient mode)"

while true; do
  # Kill any existing process on the port
  kill_port "$PORT"

  log "▶️  Starting server (attempt $((retry_count + 1)))..."

  # Start the server with custom port
  PORT="$PORT" pnpm run dev:server
  exit_code=$?

  if [ $exit_code -eq 0 ]; then
    log "✅ Server exited cleanly"
    break
  fi

  retry_count=$((retry_count + 1))

  if [ "$MAX_RETRIES" -gt 0 ] && [ "$retry_count" -ge "$MAX_RETRIES" ]; then
    log "❌ Max retries ($MAX_RETRIES) reached. Exiting."
    exit 1
  fi

  log "⚠️  Server crashed (exit code: $exit_code). Restarting in ${RETRY_DELAY}s..."
  sleep "$RETRY_DELAY"
done
