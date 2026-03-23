#!/bin/bash
set -euo pipefail

# build-plugin-tarball.sh
# Builds a plugin tarball suitable for distribution via the luqen plugin catalogue.
#
# Usage:
#   ./scripts/build-plugin-tarball.sh <plugin-directory>
#
# Example:
#   ./scripts/build-plugin-tarball.sh packages/plugins/auth-entra
#
# Output:
#   - Creates a .tgz tarball in the plugin directory
#   - Prints the tarball path and SHA-256 checksum
#
# The tarball contains a package/ prefix with:
#   - dist/          (compiled TypeScript output)
#   - manifest.json  (plugin manifest)
#   - package.json   (npm package metadata)

usage() {
  echo "Usage: $0 <plugin-directory>"
  echo ""
  echo "  plugin-directory  Path to the plugin package (e.g., packages/plugins/auth-entra)"
  echo ""
  echo "Example:"
  echo "  $0 packages/plugins/auth-entra"
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage
fi

PLUGIN_DIR="$1"

if [[ ! -d "$PLUGIN_DIR" ]]; then
  echo "Error: Directory '$PLUGIN_DIR' does not exist." >&2
  exit 1
fi

if [[ ! -f "$PLUGIN_DIR/package.json" ]]; then
  echo "Error: No package.json found in '$PLUGIN_DIR'." >&2
  exit 1
fi

# Extract plugin name and version from package.json
PACKAGE_NAME=$(node -e "const p = require('./${PLUGIN_DIR}/package.json'); console.log(p.name.replace('@luqen/plugin-', ''))")
PACKAGE_VERSION=$(node -e "const p = require('./${PLUGIN_DIR}/package.json'); console.log(p.version)")

echo "Building plugin: ${PACKAGE_NAME} v${PACKAGE_VERSION}"
echo "Directory: ${PLUGIN_DIR}"
echo ""

# Step 1: Compile TypeScript
echo "--- Compiling TypeScript ---"
(cd "$PLUGIN_DIR" && npx tsc)
echo "Compilation complete."
echo ""

# Step 2: Create staging directory with package/ prefix
STAGING_DIR=$(mktemp -d)
PACKAGE_DIR="${STAGING_DIR}/package"
mkdir -p "$PACKAGE_DIR"

# Copy required files into package/
if [[ -d "$PLUGIN_DIR/dist" ]]; then
  cp -r "$PLUGIN_DIR/dist" "$PACKAGE_DIR/dist"
else
  echo "Error: No dist/ directory found after compilation." >&2
  rm -rf "$STAGING_DIR"
  exit 1
fi

cp "$PLUGIN_DIR/package.json" "$PACKAGE_DIR/package.json"

if [[ -f "$PLUGIN_DIR/manifest.json" ]]; then
  cp "$PLUGIN_DIR/manifest.json" "$PACKAGE_DIR/manifest.json"
else
  echo "Warning: No manifest.json found in '$PLUGIN_DIR'. Skipping." >&2
fi

# Step 3: Create tarball
TARBALL_NAME="luqen-plugin-${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz"
TARBALL_PATH="${PLUGIN_DIR}/${TARBALL_NAME}"

tar -czf "$TARBALL_PATH" -C "$STAGING_DIR" package

# Clean up staging directory
rm -rf "$STAGING_DIR"

# Step 4: Compute SHA-256 checksum
CHECKSUM=$(sha256sum "$TARBALL_PATH" | awk '{ print $1 }')

echo "--- Build Complete ---"
echo "Tarball: ${TARBALL_PATH}"
echo "Checksum: sha256:${CHECKSUM}"
