[Docs](../README.md) > [Reference](./) > Plugin Development

# Plugin Development Guide

How to build plugins for the Pally Agent dashboard.

---

## Plugin Types

| Type | Interface | Purpose |
|------|-----------|---------|
| `auth` | `AuthPlugin` | SSO authentication providers (e.g., Entra ID, Okta, Google) |
| `notification` | `NotificationPlugin` | Send scan events to channels (e.g., Slack, Teams) |
| `storage` | `StoragePlugin` | External report storage (e.g., S3, Azure Blob) |
| `scanner` | `ScannerPlugin` | Custom WCAG rule evaluation |

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
| `type` | `string` | Yes | One of: `auth`, `notification`, `storage`, `scanner` |
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
| `type` | `string` | Yes | One of: `string`, `secret`, `number`, `boolean`, `select` |
| `required` | `boolean` | No | Whether the field must be set before activation |
| `default` | `any` | No | Default value |
| `options` | `string[]` | No | Valid options (only for `select` type) |
| `description` | `string` | No | Help text shown in the UI |

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
send(event: PallyEvent): Promise<void>;
```

Events: `scan.complete`, `scan.failed`, `violation.found`, `regulation.changed`.

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

1. **Discover** -- The plugin registry (`plugin-registry.json`) lists available plugins with their package names and metadata.

2. **Install** -- `npm install --save-exact --prefix <pluginsDir> <packageName>` downloads the package. The manifest is read and a database record is created with status `inactive`.

3. **Configure** -- Key-value pairs are saved to the plugin's config. Secret fields are encrypted with AES-256-GCM using the dashboard's `sessionSecret` as the encryption key.

4. **Activate** -- The plugin module is loaded via dynamic `import()`. The `activate(config)` method is called with decrypted configuration. On success, status becomes `active`. On failure, status becomes `error` with a message.

5. **Health check** -- Active plugins are health-checked every 30 seconds. After 3 consecutive failures:
   - If `autoDeactivateOnFailure` is `true`, the plugin is deactivated.
   - Otherwise, it is marked `unhealthy`.

6. **Deactivate** -- The `deactivate()` method is called and the instance is removed from memory. Status returns to `inactive`.

7. **Remove** -- Deactivates the plugin if active, deletes the database record, and removes the package files from `pluginsDir/node_modules/`.

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

## Registry Entry Format

To add a plugin to the built-in registry, add an entry to `packages/dashboard/plugin-registry.json`:

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "type": "notification",
  "version": "1.0.0",
  "description": "Does something useful",
  "packageName": "@pally-agent/plugin-my-plugin",
  "icon": "custom"
}
```

---

*See also: [CLI reference](cli-reference.md) | [API reference](api-reference.md) | [Dashboard config](dashboard-config.md)*
