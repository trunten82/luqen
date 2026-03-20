#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGES=(core compliance dashboard monitor)

echo "==> Running tests..."
cd "$ROOT" && npm run test

echo ""
echo "==> Building all packages..."
cd "$ROOT" && npm run build

echo ""
echo "==> Pack dry-run for each package..."
for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "--- @pally-agent/$pkg ---"
  cd "$ROOT/packages/$pkg" && npm pack --dry-run
done

echo ""
echo "============================================"
echo "  Dry-run complete. Review the output above."
echo ""
echo "  To publish all packages, run:"
echo "    for pkg in ${PACKAGES[*]}; do"
echo "      cd packages/\$pkg && npm publish && cd ../.."
echo "    done"
echo "============================================"
