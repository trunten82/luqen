[Docs](../README.md) > [Reference](./) > Plugin Development

# Plugin Development Guide

How to build plugins for the Luqen dashboard.

---

## Plugin Types

| Type | Interface | Purpose |
|------|-----------|---------|
| `auth` | `AuthPlugin` | SSO authentication providers (e.g., Entra ID, Okta, Google) |
| `notification` | `NotificationPlugin` | Send scan events to channels (e.g., Slack, Teams) |
| `storage` | `StoragePlugin` | External report storage (e.g., S3, Azure Blob) |
| `scanner` | `ScannerPlugin` | Custom WCAG rule evaluation |
| `llm` | `LLMPlugin` | LLM-based extraction for the compliance source intelligence pipeline |

---

## Plugin Manifest

Every plugin package must include a `manifest.json` at its root.

### Schema

```json
{
  "name": "notify-slack",
  "displayName": "Slack Notifications",
  "type": "notification",
  "version": "1.0.0",
  "description": "Send scan results and alerts to Slack channels",
  "icon": "slack",
  "configSchema": [
    {
      "key": "webhookUrl",
      "label": "Webhook URL",
      "type": "secret",
      "required": true,
      "description": "Slack incoming webhook URL"
    },
    {
      "key": "channel",
      "label": "Channel",
      "type": "string",
      "required": false,
      "default": "#accessibility",
      "description": "Default Slack channel"
    }
  ],
  "autoDeactivateOnFailure": true
}
```

### Manifest Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique slug identifier |
| `displayName` | `string` | Yes | Human-readable name shown in the UI |
| `type` | `string` | Yes | One of: `auth`, `notification`, `storage`, `scanner`, `llm` |
| `version` | `string` | Yes | SemVer version string |
| `description` | `string` | Yes | Short description |
| `icon` | `string` | No | Icon identifier for the dashboard UI |
| `configSchema` | `ConfigField[]` | Yes | Array of configuration field definitions |
| `autoDeactivateOnFailure` | `boolean` | No | If `true`, the plugin is auto-deactivated after 3 consecutive health check failures (default: `false`, marked `unhealthy` instead) |

---

## Config Schema Field Types

Each entry in `configSchema` defines one configuration field.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `key` | `string` | Yes | Config key (used in `config` object) |
| `label` | `string` | Yes | Display label in the UI |
| `type` | `string` | Yes | One of: `string`, `secret`, `number`, `boolean`, `select`, `dynamic-select` |
| `required` | `boolean` | No | Whether the field must be set before activation |
| `default` | `any` | No | Default value |
| `options` | `string[]` | No | Valid options (only for `select` type) |
| `dependsOn` | `string[]` | No | Config fields that must be set before options can be fetched (only for `dynamic-select` type) |
| `description` | `string` | No | Help text shown in the UI |

Fields with `type: "dynamic-select"` render a dropdown with a refresh button in the UI. The options are fetched at runtime by calling the plugin's `getConfigOptions(fieldKey, currentConfig)` method via `GET /admin/plugins/:id/config-options?field=<key>`. The `dependsOn` array specifies which other config fields must be configured before the options endpoint can be called (e.g., an API key must be set before querying available models).

Fields with `type: "secret"` are encrypted with AES-256-GCM before being stored in the database. They are masked in API responses and the UI.

---

## Plugin Instance Interface

The plugin's default export must implement `PluginInstance`:

```typescript
interface PluginInstance {
  readonly manifest: PluginManifest;
  activate(config: Record<string, unknown>): Promise<void>;
  deactivate(): Promise<void>;
  healthCheck(): Promise<boolean>;
}
```

### Type-specific interfaces

**AuthPlugin** extends `PluginInstance`:

```typescript
authenticate(request: FastifyRequest): Promise<AuthResult>;
getLoginUrl?(): Promise<string>;
handleCallback?(request: FastifyRequest): Promise<AuthResult>;
getUserInfo?(token: string): Promise<UserInfo>;
getLogoutUrl?(returnTo?: string): Promise<string>;
refreshToken?(token: string): Promise<string>;
```

**NotificationPlugin** extends `PluginInstance`:

```typescript
send(event: LuqenEvent): Promise<void>;
```

Events: `scan.complete`, `scan.failed`, `violation.found`, `regulation.changed`.

**Available notification plugins:**

| Package | Purpose |
|---------|---------|
| `@luqen/plugin-notify-slack` | Slack channel notifications |
| `@luqen/plugin-notify-email` | Email notifications and scheduled report delivery with PDF/CSV attachments |

**StoragePlugin** extends `PluginInstance`:

```typescript
save(key: string, data: Uint8Array): Promise<void>;
load(key: string): Promise<Uint8Array>;
delete(key: string): Promise<void>;
```

**ScannerPlugin** extends `PluginInstance`:

```typescript
readonly rules: readonly WcagRule[];
evaluate(page: PageResult): Promise<readonly ScannerIssue[]>;
```

**LLMPlugin** extends `PluginInstance`:

```typescript
extract(prompt: string, content: string): Promise<LLMExtractionResult>;
getConfigOptions?(fieldKey: string, currentConfig: Record<string, unknown>): Promise<Array<{ value: string; label: string }>>;
```

Used by the compliance source intelligence pipeline for `government` and `generic` source categories. The optional `getConfigOptions` method supports `dynamic-select` config fields (e.g., fetching available models from the provider API).

---

## Plugin Lifecycle

```
discover  -->  install  -->  configure  -->  activate  -->  health check
                                                |                |
                                                |          (periodic, every 30s)
                                                |                |
                                          deactivate  <--  3 failures
                                                |          (if autoDeactivateOnFailure)
                                                v
                                             remove
```

1. **Discover** -- The remote plugin catalogue (`catalogue.json`) is fetched from [github.com/trunten82/luqen-plugins](https://github.com/trunten82/luqen-plugins) GitHub releases. The catalogue is cached locally for 1 hour (configurable via `catalogueCacheTtl`) with a local fallback when GitHub is unreachable.

2. **Install** -- The plugin tarball is downloaded from GitHub releases and extracted into `<pluginsDir>/<name>/`. The manifest is read and a database record is created with status `inactive`. No npm is involved.

3. **Configure** -- Key-value pairs are saved to the plugin's config. Secret fields are encrypted with AES-256-GCM using a key derived from the dashboard's `sessionSecret` combined with a per-installation encryption salt.

4. **Activate** -- The plugin module is loaded via dynamic `import()`. The `activate(config)` method is called with decrypted configuration. On success, status becomes `active`. On failure, status becomes `error` with a message.

5. **Health check** -- Active plugins are health-checked every 30 seconds. After 3 consecutive failures:
   - If `autoDeactivateOnFailure` is `true`, the plugin is deactivated.
   - Otherwise, it is marked `unhealthy`.

6. **Deactivate** -- The `deactivate()` method is called and the instance is removed from memory. Status returns to `inactive`.

7. **Remove** -- Deactivates the plugin if active, deletes the database record, and removes the package files from `pluginsDir/<name>/`.

---

## Admin Pages System

Plugins can register custom admin pages that appear in the dashboard sidebar when the plugin is active. Declare them in the `adminPages` array of the manifest:

```json
{
  "adminPages": [
    {
      "path": "/admin/email-reports",
      "title": "Email Reports",
      "icon": "envelope",
      "permission": "admin.system"
    }
  ]
}
```

### Admin page fields

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `path` | `string` | Yes | Route path for the admin page (must start with `/admin/`) |
| `title` | `string` | Yes | Display title in the sidebar |
| `icon` | `string` | No | Icon identifier (uses the dashboard's icon set) |
| `permission` | `string` | Yes | Required permission to access the page (e.g., `admin.system`) |

When a plugin with `adminPages` is activated, the dashboard dynamically registers the routes and adds sidebar entries. When the plugin is deactivated, the pages are removed.

The plugin is responsible for providing the route handler and view templates. Register handlers in the `activate()` method using the Fastify instance passed to the plugin.

> For a user-facing guide to all available plugins and their configuration, see [Plugin Configuration Guide](plugin-guide.md).

---

## Plugin Statuses

| Status | Meaning |
|--------|---------|
| `inactive` | Installed but not running |
| `active` | Running and healthy |
| `error` | Activation failed (check `error` field for details) |
| `unhealthy` | Health check failed 3+ times |
| `install-failed` | Package installation failed |

---

## Developing Storage Adapter Plugins

Storage adapter plugins replace the dashboard's internal database engine. Unlike regular plugins (auth, notification, storage), a storage adapter plugin implements the `StorageAdapter` interface which provides the full data access layer for the dashboard.

### StorageAdapter interface shape

```typescript
interface StorageAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  migrate(): Promise<void>;
  healthCheck(): Promise<boolean>;
  readonly name: string;

  // 14 domain repositories
  readonly scans: ScanRepository;
  readonly users: UserRepository;
  readonly organizations: OrgRepository;
  readonly schedules: ScheduleRepository;
  readonly assignments: AssignmentRepository;
  readonly repos: RepoRepository;
  readonly roles: RoleRepository;
  readonly teams: TeamRepository;
  readonly email: EmailRepository;
  readonly audit: AuditRepository;
  readonly plugins: PluginRepository;
  readonly apiKeys: ApiKeyRepository;
  readonly pageHashes: PageHashRepository;
  readonly manualTests: ManualTestRepository;
}
```

Each repository defines standard CRUD operations for its domain (e.g., `ScanRepository` has `create`, `findById`, `findAll`, `delete`, `updateStatus`, etc.). Repository interfaces are defined in `packages/dashboard/src/db/interfaces/`.

### Implementation guidelines

1. **Implement all 14 repositories** — the dashboard requires every repository to function.
2. **`connect()`** — establish a connection pool or client session to your database.
3. **`disconnect()`** — clean up connections gracefully on shutdown.
4. **`migrate()`** — apply schema migrations for your database engine. The dashboard calls this on startup.
5. **`healthCheck()`** — return `true` if the database is reachable and responsive.
6. **Match SQLite semantics** — the SQLite implementation in `packages/dashboard/src/db/sqlite/` is the reference. Ensure your adapter returns the same data shapes and handles the same edge cases.

### Planned packages

| Package | Backend |
|---------|---------|
| `@luqen/plugin-storage-postgres` | PostgreSQL |
| `@luqen/plugin-storage-mongodb` | MongoDB |

These are not yet available. The `resolveStorageAdapter()` factory in `packages/dashboard/src/db/factory.ts` will select the appropriate adapter based on configuration.

---

## Building Plugin Tarballs

Plugins are distributed as self-contained `.tgz` tarballs that include compiled code and all production dependencies. Use the build script in the main Luqen repo:

```bash
./scripts/build-plugin-tarball.sh packages/plugins/auth-entra
```

The script performs these steps:

1. **Compile TypeScript** -- runs `npx tsc` in the plugin directory to produce `dist/`.
2. **Stage files** -- copies `dist/`, `manifest.json`, and `package.json` into a `package/` prefix directory.
3. **Bundle dependencies** -- if the plugin's `package.json` has production `dependencies`, runs `npm install --omit=dev --ignore-scripts` inside the staging directory. The resulting `node_modules/` is included in the tarball so the dashboard does not need npm at install time.
4. **Create tarball** -- produces `luqen-plugin-<name>-<version>.tgz` in the plugin directory.
5. **Print checksum** -- outputs the SHA-256 checksum for use in `catalogue.json`.

Example output:

```
Tarball: packages/plugins/auth-entra/luqen-plugin-auth-entra-1.1.0.tgz
Size: 48K
Checksum: sha256:f36ca227a416c59ce75f7072cdc34b569a39b59df5fc74cdcacd028a4fb73c87
```

The tarball is fully self-contained -- no npm install is needed on the dashboard server. The dashboard extracts it directly into `<pluginsDir>/<name>/`.

---

## Publishing to the Plugin Catalogue

Plugins are distributed via the remote plugin catalogue at [github.com/trunten82/luqen-plugins](https://github.com/trunten82/luqen-plugins). To publish a new plugin version:

1. **Build the tarball** using `scripts/build-plugin-tarball.sh` (see above).
2. **Create a GitHub release** on the `luqen-plugins` repository tagged `{name}-v{version}` (e.g., `auth-entra-v1.1.0`).
3. **Attach the `.tgz` tarball** as a release asset.
4. **Update `catalogue.json`** in the repository with the new entry or updated version:

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "type": "notification",
  "version": "1.0.0",
  "description": "Does something useful",
  "packageName": "@luqen/plugin-my-plugin",
  "icon": "custom",
  "downloadUrl": "https://github.com/trunten82/luqen-plugins/releases/download/my-plugin-v1.0.0/luqen-plugin-my-plugin-1.0.0.tgz",
  "checksum": "sha256:<checksum-from-build-script>"
}
```

5. **Commit and push** the updated `catalogue.json`.

The dashboard fetches `catalogue.json` from GitHub releases, caches it locally for 1 hour (configurable via `catalogueCacheTtl`), and falls back to a local copy when GitHub is unreachable.

---

*See also: [CLI reference](cli-reference.md) | [API reference](api-reference.md) | [Dashboard config](dashboard-config.md)*
