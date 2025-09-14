#!/bin/bash

echo "🚀 Starting build with version enforcement..."

# Install dependencies first
echo "📦 Installing dependencies..."
pnpm install

# Force install exact TypeScript version if needed
echo "🔧 Ensuring exact TypeScript version..."
CURRENT_TS_VERSION=$(pnpm tsc --version 2>/dev/null | cut -d' ' -f2 || echo "0.0.0")
REQUIRED_TS_VERSION="5.5.4"

if [[ "$CURRENT_TS_VERSION" != "$REQUIRED_TS_VERSION" ]]; then
  echo "⚠️  Current TypeScript version: $CURRENT_TS_VERSION"
  echo "🔄 Installing exact TypeScript version: $REQUIRED_TS_VERSION"
  pnpm add -D typescript@$REQUIRED_TS_VERSION
fi

# Check final versions
echo "📋 Final versions:"
echo "Node.js version: $(node --version)"
echo "TypeScript version: $(pnpm tsc --version)"

# Verify Node.js is at least 22.x (since we can't control exact version on Vercel)
NODE_VERSION=$(node --version | cut -d'v' -f2)
NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)

if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "❌ Error: Node.js version $NODE_VERSION is below required 22.x"
  exit 1
fi

# Verify exact TypeScript version
TS_VERSION=$(pnpm tsc --version | cut -d' ' -f2)
if [[ "$TS_VERSION" != "5.5.4" ]]; then
  echo "❌ Error: TypeScript version $TS_VERSION does not match required 5.5.4"
  exit 1
fi

echo "✅ Version requirements satisfied"
echo "✅ Building with Node.js $NODE_VERSION and TypeScript $TS_VERSION"

# Run the build
pnpm run build