[Docs](../README.md) > Plugins

# Plugin System

The Luqen dashboard supports a plugin system that extends its capabilities through five plugin types: authentication providers, notification channels, external storage backends, custom scanner rules, and LLM providers. Plugins are discovered from a [remote catalogue](https://github.com/trunten82/luqen-plugins), installed as self-contained tarballs (no npm required), and managed through the dashboard UI, CLI, or REST API.

---

## Overview

- **12 plugins available** across 5 types (auth, notification, storage, scanner, llm)
- **Remote catalogue** hosted at [github.com/trunten82/luqen-plugins](https://github.com/trunten82/luqen-plugins), fetched and cached automatically
- **Tarball-based install** -- plugins bundle their own dependencies, no npm on the server
- **Encrypted secrets** -- config fields marked as `secret` are encrypted with AES-256-GCM at rest
- **Health checks** -- active plugins are checked every 30 seconds with auto-deactivation on repeated failures
- **Admin pages** -- plugins can register custom admin pages in the dashboard sidebar

---

## Available Plugins

| Name | Display Name | Type | Version | Package | Description |
|------|-------------|------|---------|---------|-------------|
| `auth-entra` | Azure Entra ID | auth | 1.1.0 | `@luqen/plugin-auth-entra` | SSO via Azure Entra ID with IdP group-to-team sync |
| `auth-okta` | Okta | auth | 1.0.0 | `@luqen/plugin-auth-okta` | SSO via Okta OIDC with IdP group-to-team sync |
| `auth-google` | Google OAuth | auth | 1.0.0 | `@luqen/plugin-auth-google` | SSO via Google OAuth 2.0 / OIDC with optional Workspace group sync |
| `notify-slack` | Slack Notifications | notification | 1.0.0 | `@luqen/plugin-notify-slack` | Scan results and alerts to Slack channels |
| `notify-teams` | Microsoft Teams | notification | 1.0.0 | `@luqen/plugin-notify-teams` | Scan results and alerts to Microsoft Teams channels |
| `notify-email` | Email Notifications & Reports | notification | 1.0.0 | `@luqen/plugin-notify-email` | Scan notifications and scheduled reports via SMTP |
| `storage-s3` | AWS S3 Storage | storage | 1.0.0 | `@luqen/plugin-storage-s3` | Store reports and scan data in AWS S3 |
| `storage-azure` | Azure Blob Storage | storage | 1.0.0 | `@luqen/plugin-storage-azure` | Store reports and scan data in Azure Blob Storage |
| `llm-anthropic` | Anthropic Claude | llm | 1.0.0 | `@luqen/plugin-llm-anthropic` | LLM extraction using Claude (claude-3-5-haiku / claude-3-5-sonnet) |
| `llm-openai` | OpenAI / ChatGPT | llm | 1.0.0 | `@luqen/plugin-llm-openai` | LLM extraction using GPT-4o or any OpenAI-compatible endpoint |
| `llm-gemini` | Google Gemini | llm | 1.0.0 | `@luqen/plugin-llm-gemini` | LLM extraction using Gemini 1.5 Flash or Pro |
| `llm-ollama` | Ollama (local) | llm | 1.0.0 | `@luqen/plugin-llm-ollama` | LLM extraction using a locally running Ollama instance |

---

## Configuration Reference

### auth-entra (Azure Entra ID)

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `tenantId` | Tenant ID | string | Yes | -- | Azure AD directory (tenant) ID |
| `clientId` | Application (Client) ID | string | Yes | -- | Application ID from Azure app registration |
| `clientSecret` | Client Secret | secret | Yes | -- | Client secret from Azure app registration |
| `redirectUri` | Redirect URI | string | No | `/auth/callback/auth-entra` | OAuth callback URL |
| `groupClaimName` | Group Claim Name | string | No | `groups` | JWT claim containing Entra group IDs |
| `groupMapping` | Group Mapping (JSON) | string | No | `{}` | Maps Entra group IDs to dashboard team names |
| `autoCreateTeams` | Auto-Create Teams | boolean | No | `true` | Auto-create teams not yet in the dashboard |
| `syncMode` | Sync Mode | select | No | `additive` | `additive` or `mirror` -- controls group membership sync behaviour |

### auth-okta (Okta)

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `orgUrl` | Okta Org URL | string | Yes | -- | e.g., `https://dev-123456.okta.com` |
| `clientId` | Client ID | string | Yes | -- | Client ID from Okta app integration |
| `clientSecret` | Client Secret | secret | Yes | -- | Client secret from Okta app integration |
| `redirectUri` | Redirect URI | string | No | `/auth/callback/auth-okta` | OAuth callback URL |
| `groupClaimName` | Group Claim Name | string | No | `groups` | JWT claim containing Okta group names |
| `groupMapping` | Group Mapping (JSON) | string | No | `{}` | Maps Okta group names to dashboard team names |
| `autoCreateTeams` | Auto-Create Teams | boolean | No | `true` | Auto-create teams not yet in the dashboard |
| `syncMode` | Sync Mode | select | No | `additive` | `additive` or `mirror` |

### auth-google (Google OAuth)

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `clientId` | Client ID | string | Yes | -- | OAuth 2.0 client ID from Google Cloud Console |
| `clientSecret` | Client Secret | secret | Yes | -- | OAuth 2.0 client secret |
| `redirectUri` | Redirect URI | string | No | `/auth/callback/auth-google` | OAuth callback URL |
| `hostedDomain` | Hosted Domain | string | No | -- | Restrict login to a Google Workspace domain (e.g., `example.com`) |
| `groupsEnabled` | Enable Groups | boolean | No | `false` | Fetch Workspace group memberships via Admin SDK (requires domain-wide delegation) |

### notify-slack (Slack Notifications)

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `webhookUrl` | Webhook URL | secret | Yes | -- | Slack incoming webhook URL |
| `channel` | Channel | string | No | `#accessibility` | Default Slack channel |
| `username` | Bot Username | string | No | `Luqen Agent` | Display name for the bot |
| `events` | Events to notify | string | No | `scan.complete,scan.failed,violation.found,regulation.changed` | Comma-separated event list |

### notify-teams (Microsoft Teams)

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `webhookUrl` | Webhook URL | secret | Yes | -- | Teams incoming webhook connector URL |
| `events` | Events to notify | string | No | `scan.complete,scan.failed,violation.found,regulation.changed` | Comma-separated event list |

### notify-email (Email Notifications & Reports)

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `host` | SMTP Host | string | Yes | -- | SMTP server hostname |
| `port` | SMTP Port | number | No | `587` | SMTP port |
| `secure` | Use TLS | boolean | No | `true` | Enable TLS encryption |
| `username` | SMTP Username | string | Yes | -- | SMTP authentication username |
| `password` | SMTP Password | secret | Yes | -- | SMTP authentication password |
| `fromAddress` | From Email | string | Yes | -- | Sender email address |
| `fromName` | From Name | string | No | `Luqen` | Sender display name |
| `events` | Events to notify | string | No | `scan.complete,scan.failed` | Comma-separated event list |

**Admin pages:** This plugin registers `/admin/email-reports` for managing scheduled email report delivery (requires `admin.system` permission).

### storage-s3 (AWS S3 Storage)

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `bucket` | S3 Bucket Name | string | Yes | -- | S3 bucket to store reports in |
| `region` | AWS Region | string | No | `us-east-1` | AWS region |
| `accessKeyId` | Access Key ID | secret | Yes | -- | AWS IAM access key ID |
| `secretAccessKey` | Secret Access Key | secret | Yes | -- | AWS IAM secret access key |
| `prefix` | Key Prefix | string | No | `luqen-agent/` | Prefix for all S3 object keys |

### storage-azure (Azure Blob Storage)

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `connectionString` | Connection String | secret | Yes | -- | Azure Storage account connection string |
| `containerName` | Container Name | string | Yes | -- | Blob container name |
| `prefix` | Blob Prefix | string | No | `luqen-agent/` | Prefix for all blob names |

### llm-anthropic (Anthropic Claude)

Used by the compliance source intelligence pipeline to extract regulations from unstructured government pages and community sources.

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `apiKey` | API Key | secret | Yes | -- | Anthropic API key (`ANTHROPIC_API_KEY`) |
| `model` | Model | string | No | `claude-3-5-haiku-20241022` | Model ID to use for extraction |

### llm-openai (OpenAI / ChatGPT)

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `apiKey` | API Key | secret | Yes | -- | OpenAI API key (`OPENAI_API_KEY`) |
| `model` | Model | string | No | `gpt-4o` | Model ID |
| `baseUrl` | Base URL | string | No | `https://api.openai.com/v1` | Override for OpenAI-compatible endpoints (e.g. Azure OpenAI, LM Studio) |

### llm-gemini (Google Gemini)

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `apiKey` | API Key | secret | Yes | -- | Google AI Studio API key (`GEMINI_API_KEY`) |
| `model` | Model | string | No | `gemini-1.5-flash` | Model ID (`gemini-1.5-flash` or `gemini-1.5-pro`) |

### llm-ollama (Local Ollama)

| Key | Label | Type | Required | Default | Description |
|-----|-------|------|----------|---------|-------------|
| `baseUrl` | Ollama Base URL | string | Yes | `http://localhost:11434` | URL of the running Ollama instance |
| `model` | Model | string | Yes | -- | Ollama model name (e.g. `llama3`, `mistral`, `phi3`) |

---

## Plugin Interfaces

Plugins implement type-specific interfaces that extend a common `PluginInstance` base.

### PluginInstance (base)

```typescript
interface PluginInstance {
  readonly manifest: PluginManifest;
  activate(config: Record<string, unknown>): Promise<void>;
  deactivate(): Promise<void>;
  healthCheck(): Promise<boolean>;
}
```

### AuthPlugin

Provides SSO authentication. Extends `PluginInstance` with:

```typescript
authenticate(request: FastifyRequest): Promise<AuthResult>;
getLoginUrl?(): Promise<string>;
handleCallback?(request: FastifyRequest): Promise<AuthResult>;
getUserInfo?(token: string): Promise<UserInfo>;
getLogoutUrl?(returnTo?: string): Promise<string>;
refreshToken?(token: string): Promise<string>;
```

When an auth plugin is active, the login page displays a branded SSO button. Users are matched by email address; if no dashboard user exists, one is auto-created with the `user` role.

### NotificationPlugin

Sends events to external channels. Extends `PluginInstance` with:

```typescript
send(event: LuqenEvent): Promise<void>;
```

Supported events: `scan.complete`, `scan.failed`, `violation.found`, `regulation.changed`.

### StoragePlugin

Provides external report storage. Extends `PluginInstance` with:

```typescript
save(key: string, data: Uint8Array): Promise<void>;
load(key: string): Promise<Uint8Array>;
delete(key: string): Promise<void>;
```

Reports are stored with the key format `<prefix><report-id>.json`.

### ScannerPlugin

Adds custom WCAG rule evaluation. Extends `PluginInstance` with:

```typescript
readonly rules: readonly WcagRule[];
evaluate(page: PageResult): Promise<readonly ScannerIssue[]>;
```

### LLMPlugin

Provides LLM-based extraction for the compliance source intelligence pipeline. Extends `PluginInstance` with:

```typescript
extract(prompt: string, content: string): Promise<LLMExtractionResult>;
```

Used by the compliance service for `government` and `generic` source categories. When no LLM plugin is active, those source categories are skipped and only the `w3c-policy` and `wcag-upstream` structured parsers run.

---

## How to Develop a New Plugin

### Step 1: Scaffold the plugin

Create a new directory under `packages/plugins/<name>/` in the Luqen monorepo:

```
packages/plugins/my-plugin/
  src/
    index.ts          # Default export implementing plugin interface
  manifest.json       # Plugin metadata and config schema
  package.json        # npm package metadata
  tsconfig.json       # TypeScript config (extend from root)
```

### Step 2: Write the manifest

Create `manifest.json` with the plugin's name, type, version, description, and configuration fields:

```json
{
  "name": "my-plugin",
  "displayName": "My Plugin",
  "type": "notification",
  "version": "1.0.0",
  "description": "Does something useful",
  "configSchema": [
    {
      "key": "apiKey",
      "label": "API Key",
      "type": "secret",
      "required": true,
      "description": "Your API key"
    }
  ],
  "autoDeactivateOnFailure": true
}
```

Config field types: `string`, `secret`, `number`, `boolean`, `select` (with `options` array).

### Step 3: Implement the interface

Export a default class implementing the appropriate interface. Example for a notification plugin:

```typescript
import type { NotificationPlugin, PluginManifest, LuqenEvent } from '@luqen/dashboard';
import manifest from '../manifest.json';

export default class MyPlugin implements NotificationPlugin {
  readonly manifest = manifest as PluginManifest;
  private apiKey = '';

  async activate(config: Record<string, unknown>): Promise<void> {
    this.apiKey = config.apiKey as string;
  }

  async deactivate(): Promise<void> {
    this.apiKey = '';
  }

  async healthCheck(): Promise<boolean> {
    // Verify connectivity to external service
    return true;
  }

  async send(event: LuqenEvent): Promise<void> {
    // Send the event to your channel
  }
}
```

### Step 4: Add admin pages (optional)

If your plugin needs custom admin pages, add an `adminPages` array to the manifest:

```json
{
  "adminPages": [
    {
      "path": "/admin/my-page",
      "title": "My Page",
      "icon": "gear",
      "permission": "admin.system"
    }
  ]
}
```

Register the route handler in your `activate()` method using the Fastify instance.

### Step 5: Write tests

Write unit tests for your plugin. Test the `activate`, `deactivate`, `healthCheck`, and type-specific methods (`send`, `authenticate`, `save`/`load`/`delete`, etc.).

### Step 6: Build the tarball

```bash
./scripts/build-plugin-tarball.sh packages/plugins/my-plugin
```

This compiles TypeScript, bundles production dependencies, and creates a `.tgz` tarball with a SHA-256 checksum.

### Step 7: Publish to the catalogue

1. Create a GitHub release on [trunten82/luqen-plugins](https://github.com/trunten82/luqen-plugins) tagged `my-plugin-v1.0.0`.
2. Attach the `.tgz` tarball as a release asset.
3. Add the entry to `catalogue.json` with the download URL and checksum.
4. Commit and push.

For the full manifest schema, lifecycle details, and admin pages reference, see [Plugin Development Guide](../reference/plugin-development.md).

---

## Build and Publish Workflow

```
1. Develop plugin in packages/plugins/<name>/
          |
2. npx tsc (compile TypeScript)
          |
3. ./scripts/build-plugin-tarball.sh packages/plugins/<name>/
   Output: luqen-plugin-<name>-<version>.tgz + SHA-256 checksum
          |
4. Create GitHub release on trunten82/luqen-plugins
   Tag: <name>-v<version>
   Attach: .tgz tarball
          |
5. Update catalogue.json with version, downloadUrl, checksum
          |
6. Commit and push catalogue.json
          |
7. Dashboards pick up new version within cache TTL (default: 1 hour)
```

---

## Troubleshooting

### Plugin fails to install

- **Check network connectivity** -- the dashboard needs to reach GitHub to download tarballs. For air-gapped setups, use `DASHBOARD_CATALOGUE_URL` to point to an internal mirror.
- **Check disk space** -- plugins are extracted to `pluginsDir` (default: `./plugins/`).
- **Check permissions** -- the dashboard process needs write access to `pluginsDir`.

### Plugin fails to activate

- **Check configuration** -- all required fields must be set before activation. Open the plugin settings and verify.
- **Check health check** -- activation runs a health check. If it fails, the plugin enters `error` status. Check the error message in the UI.
- **Check logs** -- the dashboard logs include plugin activation errors with stack traces.

### Plugin becomes unhealthy

- Active plugins are health-checked every 30 seconds. After 3 consecutive failures:
  - If `autoDeactivateOnFailure` is `true` in the manifest, the plugin is automatically deactivated.
  - Otherwise, the plugin is marked `unhealthy` but remains loaded.
- **Common causes:** expired credentials, network issues, external service outage.
- **Fix:** update the configuration (e.g., rotate credentials), then deactivate and re-activate.

### Secret values not accepted

- Secret fields are encrypted with AES-256-GCM using a per-installation salt. If you restore a database backup to a different installation, encrypted secrets cannot be decrypted. Re-enter secret values after restoring.

### Catalogue not updating

- The dashboard caches `catalogue.json` for 1 hour by default. To force a refresh, restart the dashboard or set `DASHBOARD_CATALOGUE_CACHE_TTL=0` temporarily.
- Verify the `DASHBOARD_CATALOGUE_URL` points to the correct URL.

---

*See also: [Plugin Configuration Guide](../reference/plugin-guide.md) | [Plugin Development Guide](../reference/plugin-development.md) | [Dashboard Config](../reference/dashboard-config.md)*
