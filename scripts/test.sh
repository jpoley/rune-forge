#!/bin/bash
# Run all tests

set -e

echo "🧪 Running Rune Forge tests..."

# Run simulation tests
echo "📦 Testing simulation package..."
cd packages/simulation
bun test

echo ""
echo "✅ All tests passed!"
