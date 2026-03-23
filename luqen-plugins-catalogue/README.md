# Luqen Plugin Catalogue

The official plugin catalogue for [Luqen](https://github.com/trunten82/luqen), an enterprise accessibility platform. This repository serves as the central registry that the Luqen dashboard uses to discover, download, and install plugins.

---

## How It Works

```
┌─────────────────────┐       HTTPS        ┌──────────────────────────────┐
│   Luqen Dashboard   │ ─────────────────> │  github.com/trunten82/       │
│                     │   GET catalogue.json│  luqen-plugins               │
│  Admin > Plugins    │ <───────────────── │                              │
│  (Plugin Catalogue) │   JSON response    │  releases/                   │
│                     │                     │    auth-entra-v1.1.0/        │
│  "Install" click    │ ─────────────────> │      luqen-plugin-auth-      │
│                     │   GET .tgz tarball  │      entra-1.1.0.tgz        │
│  Extract to         │ <───────────────── │                              │
│  pluginsDir/<name>/ │   Binary download   │  catalogue.json              │
└─────────────────────┘                     └──────────────────────────────┘
```

1. The dashboard fetches `catalogue.json` from this repository (via GitHub releases or raw URL) to populate the **Plugin Catalogue** tab at **Admin > Plugins**.
2. The response is cached locally for 1 hour (configurable via `catalogueCacheTtl`). When GitHub is unreachable, the dashboard falls back to the last cached copy.
3. When a user clicks **Install**, the dashboard downloads the `.tgz` tarball from the `downloadUrl` in the catalogue entry.
4. The SHA-256 `checksum` is verified after download to ensure integrity.
5. The tarball is extracted into `<pluginsDir>/<name>/` on the dashboard server. No npm is required -- tarballs include bundled production dependencies.

---

## Available Plugins

| Name | Display Name | Type | Version | Description |
|------|-------------|------|---------|-------------|
| `auth-entra` | Azure Entra ID | auth | 1.1.0 | Single sign-on via Azure Entra ID (formerly Azure AD) with IdP group-to-team sync |
| `auth-okta` | Okta | auth | 1.0.0 | Single sign-on via Okta OIDC with IdP group-to-team sync |
| `auth-google` | Google Workspace | auth | 1.0.0 | Single sign-on via Google OAuth 2.0 / OpenID Connect with optional Workspace group sync |
| `notify-slack` | Slack Notifications | notification | 1.0.0 | Send scan results and alerts to Slack channels via incoming webhooks |
| `notify-teams` | Microsoft Teams | notification | 1.0.0 | Send scan results and alerts to Microsoft Teams channels via webhook connectors |
| `notify-email` | Email Notifications & Reports | notification | 1.0.0 | Send scan notifications and scheduled reports via SMTP with PDF/Excel attachments |
| `storage-s3` | AWS S3 Storage | storage | 1.0.0 | Store reports and scan data in AWS S3 (native AWS4 signing) |
| `storage-azure` | Azure Blob Storage | storage | 1.0.0 | Store reports and scan data in Azure Blob Storage (native SharedKey auth) |

---

## Installing a Plugin

### From the Dashboard UI

1. Go to **Admin > Plugins** and open the **Plugin Catalogue** tab.
2. Find the plugin you want and click **Install**.
3. After installation, click **Configure** to enter settings (API keys, URLs, etc.).
4. Click **Save**, then **Activate**.

### From the CLI

```bash
# List available plugins from the catalogue
luqen-dashboard plugin list

# Install by name (not by npm package name)
luqen-dashboard plugin install auth-entra

# Configure
luqen-dashboard plugin configure auth-entra \
  --set tenantId=YOUR_TENANT_ID \
  --set clientId=YOUR_CLIENT_ID \
  --set clientSecret=YOUR_SECRET

# Activate
luqen-dashboard plugin activate auth-entra

# Deactivate
luqen-dashboard plugin deactivate auth-entra

# Remove
luqen-dashboard plugin remove auth-entra
```

### From the REST API

```bash
# List catalogue
GET /api/v1/plugins/registry

# Install
POST /api/v1/plugins/install
{ "name": "auth-entra" }

# Configure
PUT /api/v1/plugins/auth-entra/config
{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }

# Activate / deactivate
POST /api/v1/plugins/auth-entra/activate
POST /api/v1/plugins/auth-entra/deactivate

# Remove
DELETE /api/v1/plugins/auth-entra

# Health check
GET /api/v1/plugins/auth-entra/health
```

---

## Catalogue Format

The `catalogue.json` file is the machine-readable registry. It contains metadata, download URLs, and checksums for all published plugins.

### Schema

```json
{
  "version": 1,
  "updatedAt": "2026-03-23T15:00:00Z",
  "plugins": [
    {
      "name": "auth-entra",
      "displayName": "Azure Entra ID",
      "type": "auth",
      "version": "1.1.0",
      "description": "Single sign-on via Azure Entra ID (formerly Azure AD)",
      "packageName": "@luqen/plugin-auth-entra",
      "icon": "entra",
      "downloadUrl": "https://github.com/trunten82/luqen-plugins/releases/download/auth-entra-v1.1.0/luqen-plugin-auth-entra-1.1.0.tgz",
      "checksum": "sha256:f36ca227a416c59ce75f7072cdc34b569a39b59df5fc74cdcacd028a4fb73c87"
    }
  ]
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | number | Yes | Schema version (currently `1`) |
| `updatedAt` | string | Yes | ISO 8601 timestamp of last update |
| `plugins` | array | Yes | Array of plugin entries |
| `plugins[].name` | string | Yes | Unique slug identifier (used in install commands) |
| `plugins[].displayName` | string | Yes | Human-readable name shown in the UI |
| `plugins[].type` | string | Yes | One of: `auth`, `notification`, `storage`, `scanner` |
| `plugins[].version` | string | Yes | SemVer version string |
| `plugins[].description` | string | Yes | Short description |
| `plugins[].packageName` | string | Yes | Full npm-style package name (e.g., `@luqen/plugin-auth-entra`) |
| `plugins[].icon` | string | No | Icon identifier for the dashboard UI |
| `plugins[].downloadUrl` | string | Yes | Direct URL to the `.tgz` tarball on GitHub releases |
| `plugins[].checksum` | string | Yes | `sha256:<hex>` checksum for integrity verification |
| `plugins[].adminPages` | array | No | Admin pages registered by the plugin (see notify-email for an example) |

---

## Plugin Tarball Format

Each `.tgz` tarball contains a `package/` prefix directory with:

```
package/
  dist/           # Compiled TypeScript output
  manifest.json   # Plugin manifest (type, configSchema, adminPages)
  package.json    # Package metadata
  node_modules/   # Bundled production dependencies (if any)
```

Tarballs are self-contained -- the dashboard does not need npm or network access beyond the initial download.

---

## Publishing a New Plugin Version

### 1. Build the tarball

In the main [Luqen repo](https://github.com/trunten82/luqen), use the build script:

```bash
./scripts/build-plugin-tarball.sh packages/plugins/auth-entra
```

This compiles TypeScript, bundles production dependencies into `node_modules/`, creates the `.tgz` tarball, and prints the SHA-256 checksum.

### 2. Create a GitHub release

Create a release on this repository (`trunten82/luqen-plugins`) with:

- **Tag:** `{name}-v{version}` (e.g., `auth-entra-v1.1.0`)
- **Release title:** `auth-entra v1.1.0`
- **Asset:** Attach the `.tgz` tarball file

### 3. Update catalogue.json

Add or update the plugin entry in `catalogue.json`:

```json
{
  "name": "auth-entra",
  "displayName": "Azure Entra ID",
  "type": "auth",
  "version": "1.1.0",
  "description": "Single sign-on via Azure Entra ID (formerly Azure AD)",
  "packageName": "@luqen/plugin-auth-entra",
  "icon": "entra",
  "downloadUrl": "https://github.com/trunten82/luqen-plugins/releases/download/auth-entra-v1.1.0/luqen-plugin-auth-entra-1.1.0.tgz",
  "checksum": "sha256:<checksum-from-build-script>"
}
```

### 4. Commit and push

Commit the updated `catalogue.json` to the `main` branch. Dashboards will pick up the new version within the cache TTL (default: 1 hour).

---

## Developing a New Plugin

For full plugin development documentation -- manifest schema, plugin interfaces, lifecycle hooks, admin pages, and testing -- see the [Plugin Development Guide](https://github.com/trunten82/luqen/blob/master/docs/reference/plugin-development.md) in the main Luqen repo.

Key steps:

1. Create a new directory under `packages/plugins/<name>/` in the Luqen monorepo.
2. Add `manifest.json` with name, type, configSchema, and version.
3. Implement the appropriate interface (`AuthPlugin`, `NotificationPlugin`, `StoragePlugin`, or `ScannerPlugin`).
4. Write tests.
5. Build the tarball with `scripts/build-plugin-tarball.sh`.
6. Publish to this catalogue (see above).

---

## Configuration

The dashboard uses two configuration options for the plugin catalogue:

| Config Key | Environment Variable | Default | Description |
|------------|---------------------|---------|-------------|
| `catalogueUrl` | `DASHBOARD_CATALOGUE_URL` | `https://raw.githubusercontent.com/trunten82/luqen-plugins/main/catalogue.json` | URL to fetch `catalogue.json` from |
| `catalogueCacheTtl` | `DASHBOARD_CATALOGUE_CACHE_TTL` | `3600000` (1 hour) | How long to cache the catalogue locally, in milliseconds |

---

## Self-Hosting / Air-Gapped Setup

For environments that cannot reach GitHub (air-gapped networks, corporate firewalls), you can host the plugin catalogue internally:

1. **Mirror the catalogue:** Copy `catalogue.json` and all `.tgz` tarballs to an internal web server, S3 bucket, or artifact repository.
2. **Update download URLs:** Edit the `downloadUrl` fields in your mirrored `catalogue.json` to point to your internal server.
3. **Configure the dashboard:** Set the `DASHBOARD_CATALOGUE_URL` environment variable (or `catalogueUrl` config) to your internal catalogue URL:

```bash
export DASHBOARD_CATALOGUE_URL=https://internal.example.com/luqen-plugins/catalogue.json
```

The dashboard will fetch the catalogue and download tarballs from your internal mirror instead of GitHub. No other changes are needed -- the install, configure, and activate flow works identically.

---

## License

MIT -- see [LICENSE](../LICENSE) in the main Luqen repo.
