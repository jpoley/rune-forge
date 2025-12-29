#!/bin/bash
# Production build script

set -e

echo "🔨 Building Rune Forge for production..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf packages/*/dist

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Build packages in order
echo "📦 Building simulation package..."
pnpm run build:simulation

echo "📦 Building server package..."
pnpm run build:server

echo "📦 Building client package..."
pnpm run build:client

echo ""
echo "✅ Build complete!"
echo ""
echo "To run in production mode:"
echo "  cd packages/server && pnpm start"
echo ""
echo "Or use Docker:"
echo "  pnpm run docker:build"
echo "  pnpm run docker:run"
