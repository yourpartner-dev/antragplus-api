#!/bin/bash

echo "🚀 Starting build with version enforcement..."

# Install dependencies first
echo "📦 Installing dependencies..."
pnpm install

# Check final versions
echo "📋 Final versions:"
echo "Node.js version: $(node --version)"

# Get TypeScript version using npx to handle case where it's not globally available
TS_VERSION=$(npx tsc --version 2>/dev/null | cut -d' ' -f2 || echo "not found")
echo "TypeScript version: $TS_VERSION"

# Verify Node.js is at least 22.x (accept any 22.x version)
NODE_VERSION=$(node --version | cut -d'v' -f2)
NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)

if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "❌ Error: Node.js version $NODE_VERSION is below required 22.x"
  exit 1
fi

# Verify TypeScript is available and starts with 5.5
if [[ "$TS_VERSION" == "not found" ]]; then
  echo "❌ Error: TypeScript not found"
  exit 1
fi

if [[ ! "$TS_VERSION" =~ ^5\.5\. ]]; then
  echo "⚠️  Warning: TypeScript version $TS_VERSION may not be 5.5.x as expected"
  echo "📄 Installed TypeScript version from package.json: $(node -p "require('./package.json').devDependencies.typescript" 2>/dev/null || echo 'unknown')"
fi

echo "✅ Version requirements satisfied"
echo "✅ Building with Node.js $NODE_VERSION and TypeScript $TS_VERSION"

# Ensure we have the required build tools
echo "🔧 Installing build dependencies with npm (fallback for registry issues)..."
npm install --no-save typescript@5.5.4 copyfiles

# Verify copyfiles is available
echo "🔍 Verifying copyfiles installation..."
npx copyfiles --version || echo "❌ copyfiles not available"

# Run the build directly in build.sh
echo "🔨 Running TypeScript compilation..."
npx tsc --project tsconfig.prod.json

echo "📁 Copying template files..."
echo "🔍 First, let's see what YAML files exist in src/..."
find src -name "*.yaml" -o -name "*.liquid" || echo "❌ No YAML/liquid files found"
echo "🔍 Running copyfiles with verbose output..."
npx copyfiles "src/**/*.{yaml,liquid}" -u 1 dist --verbose || echo "❌ copyfiles failed"
echo "🔍 Checking what was actually copied to dist/..."
find dist -name "*.yaml" -o -name "*.liquid" || echo "❌ No YAML/liquid files found in dist"
echo "🔍 Checking if dist directory structure exists..."
ls -la dist/helpers/system-data/ || echo "❌ dist/helpers/system-data/ does not exist"

echo "🔍 Logging contents of /var/task/dist/helpers/system-data/collections/..."
ls -la /var/task/dist/helpers/system-data/collections/ || echo "❌ Directory does not exist"

echo "✅ Build completed successfully"