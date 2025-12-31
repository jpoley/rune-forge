#!/bin/bash
# Development script - runs both server and client in parallel

set -e

echo "🎮 Starting Rune Forge development environment..."

# Kill any existing processes on our ports
SERVER_PORT=${PORT:-41204}
CLIENT_PORT=5173

for port in $SERVER_PORT $CLIENT_PORT; do
  if lsof -ti:$port >/dev/null 2>&1; then
    echo "🧹 Cleaning up existing process on port $port..."
    lsof -ti:$port | xargs kill -9 2>/dev/null || true
  fi
done
sleep 1

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  pnpm install
fi

# Build simulation package first
echo "🔨 Building simulation package..."
pnpm run build:simulation

# Start both server and client in parallel
echo "🚀 Starting development servers..."
echo "   Server: http://localhost:41204"
echo "   Client: http://localhost:5173 (with proxy to server)"

# Run both in parallel
pnpm run dev:server &
SERVER_PID=$!

cd packages/client && pnpm run dev &
CLIENT_PID=$!

# Handle cleanup on exit
cleanup() {
  echo ""
  echo "🛑 Shutting down..."
  kill $SERVER_PID 2>/dev/null || true
  kill $CLIENT_PID 2>/dev/null || true
  exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for both processes
wait
