# Luqen Plugin Catalogue

This repository hosts the plugin catalogue for [Luqen](https://github.com/trunten82/luqen). The catalogue provides a central registry of available plugins with download URLs pointing to GitHub release assets.

## Structure

- `catalogue.json` - Machine-readable plugin catalogue containing metadata, download URLs, and checksums for all published plugins.

## How It Works

1. The Luqen dashboard fetches `catalogue.json` to display available plugins in the admin UI.
2. When a user installs a plugin, the dashboard downloads the tarball from the `downloadUrl` in the catalogue entry.
3. The `checksum` field (SHA-256) is verified after download to ensure integrity.

## Plugin Tarball Format

Each plugin tarball contains a `package/` prefix with:

- `dist/` - Compiled plugin code
- `manifest.json` - Plugin manifest (capabilities, config schema)
- `package.json` - Package metadata

## Publishing a Plugin

1. Build the tarball using `scripts/build-plugin-tarball.sh` in the main Luqen repo.
2. Create a GitHub release tagged `{name}-v{version}` (e.g., `auth-entra-v1.0.0`).
3. Attach the `.tgz` tarball as a release asset.
4. Update `catalogue.json` with the new version and checksum.
