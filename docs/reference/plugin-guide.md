[Docs](../README.md) > [Reference](./) > Plugin Guide

# Plugin Configuration Guide

A comprehensive reference for all available luqen plugins — what they do, how to configure them, and when to use each one.

---

## Plugin architecture overview

The luqen dashboard supports a plugin system that extends its capabilities in five areas:

| Plugin type | Purpose | Example |
|-------------|---------|---------|
| **Auth** | SSO authentication providers | Azure Entra ID, Okta, Google |
| **Notification** | Send scan events to external channels | Slack, Microsoft Teams, Email |
| **Storage** | External report storage backends | AWS S3, Azure Blob Storage |
| **Scanner** | Custom WCAG rule evaluation | (custom implementations) |
| **LLM** | LLM-based extraction for compliance source intelligence | Claude, GPT-4o, Gemini, Ollama |
| **Git Host** | Git platform integration for fix PRs | GitHub, GitLab, Azure DevOps |

Plugins are managed from **Admin > Plugins** in the dashboard UI, or via the CLI (`luqen-dashboard plugin install|configure|activate|deactivate|remove`). Plugins are installed by name (e.g., `luqen-dashboard plugin install auth-entra`), not by npm package name.

### Role-based plugin management

Plugin management is split between two roles:

| Capability | Global Admin | Org Admin |
|------------|:------------:|:---------:|
| Browse and install from catalogue | Yes | No |
| Remove installed plugins | Yes | No |
| Configure global default settings | Yes | No |
| Activate / deactivate globally | Yes | No |
| Enforce activation per org | Yes | No |
| View org usage / activation status | Yes | No |
| See installed plugins | Yes | Yes |
| Activate plugin for own org | — | Yes |
| Configure org-specific overrides | — | Yes |
| Deactivate plugin for own org | — | Yes |

**Org-specific configuration** inherits from the global defaults. Only values explicitly overridden by the org admin differ — all other fields fall back to the global configuration. New organisations see all globally installed plugins and can activate them immediately.

### How plugins work

Each plugin is a package with a `manifest.json` that declares its type, configuration fields, and capabilities. The dashboard discovers available plugins from a remote plugin catalogue hosted at [github.com/trunten82/luqen-plugins](https://github.com/trunten82/luqen-plugins). The catalogue is fetched as `catalogue.json` from GitHub releases, cached locally for 1 hour (configurable via `catalogueCacheTtl`), with a local fallback when GitHub is unreachable. Plugins are installed as tarballs downloaded from GitHub releases into the configured `pluginsDir`, and managed through a database-backed state machine.

Configuration values are stored in the dashboard database. Fields marked as `secret` in the manifest are encrypted with AES-256-GCM using a key derived from the dashboard's `sessionSecret` combined with a per-installation encryption salt (generated automatically on first startup). Secret values are masked in the UI and API responses.

### Admin pages system

Plugins can register custom admin pages by including an `adminPages` array in their manifest. Each entry specifies a path, title, icon, and required permission. When the plugin is active, these pages appear in the dashboard sidebar under the admin section. For example, the Email Notifications plugin registers `/admin/email-reports` for managing scheduled email delivery.

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

Admin pages are only visible when the plugin is active and the user has the required permission.

---

## Plugin lifecycle

Every plugin follows the same lifecycle, now with org-scoped activation:

```
discover  -->  install  -->  configure defaults  -->  activate globally
                                                          |
                                                    org admin activates
                                                    for their org
                                                          |
                                                    org admin overrides
                                                    config (optional)
                                                          |
                                                    health check
                                                          |
                                                    (periodic, every 30s)
                                                          |
                                                    deactivate  <--  3 failures
                                                          |     (if autoDeactivateOnFailure)
                                                          v
                                                       remove
```

1. **Discover** — browse available plugins in the Plugin Catalogue tab at **Admin > Plugins**. The catalogue is fetched from [github.com/trunten82/luqen-plugins](https://github.com/trunten82/luqen-plugins).
2. **Install** (global admin) — click **Install** to download the plugin tarball from GitHub releases. Status becomes `inactive`.
3. **Activate globally** (global admin) — click **Activate**. Status becomes `active` immediately. If the plugin requires configuration, a "Needs config" hint appears but the plugin stays active (enabled).
4. **Configure** (global admin) — click **Configure** to expand the inline settings form. Fill in the required fields and click **Save**. Saving config on an active plugin automatically starts (or restarts) the plugin code. These become the global defaults.
5. **Org deployment** (global admin) — expand "Deploy to organizations" to activate the plugin for specific orgs. Org copies inherit the global configuration.
6. **Org config override** (org admin, optional) — org admins can override specific configuration values for their org. Non-overridden fields fall back to the global defaults.
7. **Health check** — active plugins are checked every 30 seconds. After 3 consecutive failures, the plugin is either auto-deactivated (if `autoDeactivateOnFailure` is set) or marked `unhealthy`.
8. **Remove** (global admin) — removes the plugin globally, including all org-specific copies. The plugin reappears in the catalogue for reinstallation.
8. **Deactivate** — global admins can deactivate globally; org admins can deactivate for their org only. Configuration is preserved.
9. **Remove** (global admin only) — click **Remove** to deactivate across all orgs, delete the database record, and remove the package files.

### Plugin statuses

| Status | Meaning |
|--------|---------|
| `inactive` | Installed but not running |
| `active` | Running and healthy |
| `error` | Activation failed (check error details in the UI) |
| `unhealthy` | Health check failed 3+ times |
| `install-failed` | Package installation failed |

---

## Available plugins

Twelve plugins are available in the catalogue.

### Azure Entra ID (`auth-entra`)

**Package:** `@luqen/plugin-auth-entra`
**Type:** Auth
**Description:** Single sign-on via Azure Entra ID (formerly Azure AD)

**When to use:** You want your team to log in to the dashboard with their Microsoft 365 / Azure AD credentials via OIDC. Enables enterprise SSO — users authenticate through Microsoft's login page instead of managing separate dashboard passwords.

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| Tenant ID | `tenantId` | string | Yes | — | Your Azure AD directory (tenant) ID |
| Application (Client) ID | `clientId` | string | Yes | — | The application ID from your Azure app registration |
| Client Secret | `clientSecret` | secret | Yes | — | The client secret value from your Azure app registration |
| Redirect URI | `redirectUri` | string | No | `/auth/callback/auth-entra` | The OAuth callback URL — must match the redirect URI registered in Azure |

#### Setup steps

1. Register an application in Azure Portal (see [Enterprise SSO guide](../paths/enterprise-sso.md) for full Azure setup)
2. Go to **Admin > Plugins** and install **Azure Entra ID**
3. Enter your Tenant ID, Client ID, and Client Secret
4. Click **Save**, then **Activate**
5. A **Sign in with Azure Entra ID** button appears on the login page

#### Usage notes

- Users authenticated via SSO are matched by email address. If no dashboard user exists, one is auto-created with the `user` role.
- Admins can promote SSO users from the user management page.
- Use HTTPS for the redirect URI in production.
- IdP group claims can be mapped to dashboard teams (v0.20.0+) — see [Enterprise SSO > IdP Group Mapping](../paths/enterprise-sso.md#idp-group-mapping).

---

### Slack Notifications (`notify-slack`)

**Package:** `@luqen/plugin-notify-slack`
**Type:** Notification
**Description:** Send scan results and alerts to Slack channels

**When to use:** Your team uses Slack and you want real-time notifications when scans complete, fail, or detect new violations. Messages are sent via Slack incoming webhooks.

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| Webhook URL | `webhookUrl` | secret | Yes | — | Slack incoming webhook URL (create at api.slack.com) |
| Channel | `channel` | string | No | `#accessibility` | Default Slack channel to post to |
| Bot Username | `username` | string | No | `Luqen` | Display name for the bot in Slack |
| Events to notify | `events` | string | No | `scan.complete,scan.failed,violation.found,regulation.changed` | Comma-separated list of events that trigger notifications |

#### Setup steps

1. Create a Slack incoming webhook at [api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks)
2. Go to **Admin > Plugins** and install **Slack Notifications**
3. Paste the webhook URL, optionally set the channel and bot name
4. Click **Save**, then **Activate**

#### Usage notes

- Each notification includes a summary with error/warning/notice counts and a link to the full report in the dashboard.
- To send to multiple channels, install the plugin multiple times with different webhook URLs (each Slack webhook targets a specific channel).
- Available events: `scan.complete`, `scan.failed`, `violation.found`, `regulation.changed`.

---

### Microsoft Teams (`notify-teams`)

**Package:** `@luqen/plugin-notify-teams`
**Type:** Notification
**Description:** Send scan results and alerts to Microsoft Teams channels

**When to use:** Your team uses Microsoft Teams and you want channel notifications for scan events. Messages are sent via Teams incoming webhook connectors.

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| Webhook URL | `webhookUrl` | secret | Yes | — | Teams incoming webhook connector URL |
| Events to notify | `events` | string | No | `scan.complete,scan.failed,violation.found,regulation.changed` | Comma-separated list of events that trigger notifications |

#### Setup steps

1. In Microsoft Teams, go to the target channel > **Connectors** > **Incoming Webhook** > **Configure**
2. Name the webhook (e.g., "Luqen") and copy the generated URL
3. Go to **Admin > Plugins** and install **Microsoft Teams**
4. Paste the webhook URL and select which events to subscribe to
5. Click **Save**, then **Activate**

#### Usage notes

- Notifications use Adaptive Cards format for rich rendering in Teams.
- Available events: `scan.complete`, `scan.failed`, `violation.found`, `regulation.changed`.

---

### Email Notifications & Reports (`notify-email`)

**Package:** `@luqen/plugin-notify-email`
**Type:** Notification
**Description:** Send scan notifications and scheduled reports via email (SMTP)

**When to use:** You need email-based alerts when scans complete or fail, and/or you want to deliver scheduled accessibility reports (PDF/Excel) to stakeholders by email.

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| SMTP Host | `host` | string | Yes | — | SMTP server hostname (e.g., `smtp.office365.com`) |
| SMTP Port | `port` | number | No | `587` | SMTP port (587 for STARTTLS, 465 for implicit TLS) |
| Use TLS | `secure` | boolean | No | `true` | Enable TLS encryption |
| SMTP Username | `username` | string | Yes | — | SMTP authentication username |
| SMTP Password | `password` | secret | Yes | — | SMTP authentication password |
| From Email | `fromAddress` | string | Yes | — | Sender email address for outgoing messages |
| From Name | `fromName` | string | No | `Luqen` | Display name for the sender |
| Events to notify | `events` | string | No | `scan.complete,scan.failed` | Comma-separated list of events that trigger email notifications |

#### Admin pages

This plugin registers an admin page:

| Page | Path | Description |
|------|------|-------------|
| Email Reports | `/admin/email-reports` | Create and manage scheduled email report delivery |

#### Setup steps

1. Go to **Admin > Plugins** and install **Email Notifications & Reports**
2. Enter your SMTP server details (host, port, TLS, credentials, from address)
3. Click **Save**, then **Activate** — a health check verifies SMTP connectivity
4. For event notifications, configure which events to subscribe to
5. For scheduled reports, go to **Admin > Email Reports** (appears in the sidebar after activation) and create delivery schedules

#### Usage notes

- The plugin runs an SMTP connectivity health check on activation. Credentials are encrypted with AES-256-GCM.
- Scheduled reports support PDF, Excel (XLSX), or both attachment formats with configurable frequency (daily, weekly, monthly).
- The email body contains an inline-styled HTML summary with key metrics.
- The legacy `smtp_config` table in the dashboard database still works as a fallback if this plugin is not installed.

---

### AWS S3 Storage (`storage-s3`)

**Package:** `@luqen/plugin-storage-s3`
**Type:** Storage
**Description:** Store reports and scan data in AWS S3

**When to use:** You want scan reports stored in AWS S3 instead of (or in addition to) the local filesystem. Useful for cloud deployments, compliance archiving, or sharing reports across multiple dashboard instances.

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| S3 Bucket Name | `bucket` | string | Yes | — | The S3 bucket to store reports in |
| AWS Region | `region` | string | No | `us-east-1` | AWS region where the bucket is located |
| Access Key ID | `accessKeyId` | secret | Yes | — | AWS IAM access key ID with S3 write permissions |
| Secret Access Key | `secretAccessKey` | secret | Yes | — | AWS IAM secret access key |
| Key Prefix | `prefix` | string | No | `luqen/` | Prefix added to all S3 object keys (acts as a folder path) |

#### Setup steps

1. Create an S3 bucket in your AWS account
2. Create an IAM user or role with `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` permissions on the bucket
3. Go to **Admin > Plugins** and install **AWS S3 Storage**
4. Enter the bucket name, region, and IAM credentials
5. Click **Save**, then **Activate**

#### Usage notes

- Reports are stored with the key format `<prefix><report-id>.json`.
- The health check verifies the dashboard can list objects in the bucket.
- For production, consider using IAM roles (ECS task roles, EC2 instance profiles) instead of static access keys.

---

### Azure Blob Storage (`storage-azure`)

**Package:** `@luqen/plugin-storage-azure`
**Type:** Storage
**Description:** Store reports and scan data in Azure Blob Storage

**When to use:** You want scan reports stored in Azure Blob Storage. Ideal for Azure-hosted deployments or organisations standardised on Azure infrastructure.

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| Connection String | `connectionString` | secret | Yes | — | Azure Storage account connection string |
| Container Name | `containerName` | string | Yes | — | Blob container to store reports in |
| Blob Prefix | `prefix` | string | No | `luqen/` | Prefix added to all blob names (acts as a virtual folder) |

#### Setup steps

1. Create a Storage Account and blob container in the Azure Portal
2. Copy the connection string from **Access keys** in the storage account settings
3. Go to **Admin > Plugins** and install **Azure Blob Storage**
4. Enter the connection string, container name, and optional prefix
5. Click **Save**, then **Activate**

#### Usage notes

- The health check verifies the dashboard can access the specified container.
- For production, consider using managed identities instead of connection strings with embedded keys.
- Reports are stored with the blob name format `<prefix><report-id>.json`.

---

### Okta SSO (`auth-okta`)

**Package:** `@luqen/plugin-auth-okta`
**Type:** Auth
**Description:** Single sign-on via Okta OIDC with IdP group-to-team sync

**When to use:** You want your team to log in to the dashboard with their Okta credentials via OIDC. Enables enterprise SSO with group-based team assignment.

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| Okta Org URL | `orgUrl` | string | Yes | -- | Your Okta organization URL (e.g., `https://dev-123456.okta.com`) |
| Client ID | `clientId` | string | Yes | -- | The client ID from your Okta app integration |
| Client Secret | `clientSecret` | secret | Yes | -- | The client secret from your Okta app integration |
| Redirect URI | `redirectUri` | string | No | `/auth/callback/auth-okta` | The OAuth callback URL -- must match the redirect URI registered in Okta |
| Group Claim Name | `groupClaimName` | string | No | `groups` | The JWT claim containing Okta group names |
| Group Mapping (JSON) | `groupMapping` | string | No | `{}` | Maps Okta group names to dashboard team names, e.g. `{"Developers": "Frontend Team"}` |
| Auto-Create Teams | `autoCreateTeams` | boolean | No | `true` | Automatically create teams that do not yet exist in the dashboard |
| Sync Mode | `syncMode` | select | No | `additive` | `additive`: only add memberships; `mirror`: also remove memberships not present in IdP groups |

#### Setup steps

1. Create an OIDC Web Application in your Okta admin console
2. Go to **Admin > Plugins** and install **Okta**
3. Enter your Org URL, Client ID, and Client Secret
4. Click **Save**, then **Activate**
5. A **Sign in with Okta** button appears on the login page

#### Usage notes

- Users authenticated via SSO are matched by email address. If no dashboard user exists, one is auto-created with the `user` role.
- Group claims require adding a `groups` claim to your Okta authorization server.
- Use HTTPS for the redirect URI in production.

---

### Google OAuth (`auth-google`)

**Package:** `@luqen/plugin-auth-google`
**Type:** Auth
**Description:** Single sign-on via Google OAuth 2.0 / OpenID Connect with optional Google Workspace group sync

**When to use:** You want your team to log in with their Google accounts. Optionally restrict login to a specific Google Workspace domain and sync group memberships via the Admin SDK.

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| Client ID | `clientId` | string | Yes | -- | The OAuth 2.0 client ID from Google Cloud Console |
| Client Secret | `clientSecret` | secret | Yes | -- | The OAuth 2.0 client secret from Google Cloud Console |
| Redirect URI | `redirectUri` | string | No | `/auth/callback/auth-google` | The OAuth callback URL -- must match the redirect URI registered in Google Cloud Console |
| Hosted Domain | `hostedDomain` | string | No | -- | Restrict login to a Google Workspace domain (e.g., `example.com`) |
| Enable Groups | `groupsEnabled` | boolean | No | `false` | Fetch Google Workspace group memberships via Admin SDK (requires domain-wide delegation) |

#### Setup steps

1. Create an OAuth 2.0 client in Google Cloud Console (APIs & Services > Credentials)
2. Go to **Admin > Plugins** and install **Google OAuth**
3. Enter the Client ID and Client Secret
4. Optionally set the Hosted Domain to restrict logins to your organization
5. Click **Save**, then **Activate**
6. A **Sign in with Google** button appears on the login page

#### Usage notes

- Users authenticated via SSO are matched by email address. If no dashboard user exists, one is auto-created with the `user` role.
- To enable group sync, you must configure domain-wide delegation in the Google Workspace admin console and grant the Admin SDK Directory API scope.
- Use HTTPS for the redirect URI in production.

---

## LLM plugins

Four LLM plugins enable the compliance source intelligence pipeline to extract regulations from unstructured government pages and community sources. When no LLM plugin is active, only the structured W3C and WCAG parsers run during a reseed.

All LLM plugins use **dynamic model selection** (v1.1.0) — the model field is a `dynamic-select` that queries the provider API for available models. A refresh button in the UI re-fetches the model list.

---

### Anthropic Claude (`llm-anthropic`)

**Package:** `@luqen/plugin-llm-anthropic`
**Type:** LLM
**Description:** LLM extraction using Claude (claude-3-5-haiku / claude-3-5-sonnet)

**When to use:** You want to use Anthropic's Claude models for extracting regulations from unstructured content.

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| API Key | `apiKey` | secret | Yes | -- | Anthropic API key (`ANTHROPIC_API_KEY`) |
| Model | `model` | dynamic-select | No | `claude-3-5-haiku-20241022` | Model ID (fetched from Anthropic API) |

#### Setup steps

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. Go to **Admin > Plugins** and install **Anthropic Claude**
3. Enter your API key, then click the refresh button next to Model to fetch available models
4. Select a model, click **Save**, then **Activate**

---

### OpenAI / ChatGPT (`llm-openai`)

**Package:** `@luqen/plugin-llm-openai`
**Type:** LLM
**Description:** LLM extraction using GPT-4o or any OpenAI-compatible endpoint

**When to use:** You want to use OpenAI models or any OpenAI-compatible endpoint (Azure OpenAI, LM Studio) for regulation extraction.

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| API Key | `apiKey` | secret | Yes | -- | OpenAI API key (`OPENAI_API_KEY`) |
| Model | `model` | dynamic-select | No | `gpt-4o` | Model ID (fetched from OpenAI API) |
| Base URL | `baseUrl` | string | No | `https://api.openai.com/v1` | Override for OpenAI-compatible endpoints |

---

### Google Gemini (`llm-gemini`)

**Package:** `@luqen/plugin-llm-gemini`
**Type:** LLM
**Description:** LLM extraction using Gemini 1.5 Flash or Pro

**When to use:** You want to use Google's Gemini models for regulation extraction.

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| API Key | `apiKey` | secret | Yes | -- | Google AI Studio API key (`GEMINI_API_KEY`) |
| Model | `model` | dynamic-select | No | `gemini-1.5-flash` | Model ID (fetched from Google AI API) |

---

### Ollama (`llm-ollama`)

**Package:** `@luqen/plugin-llm-ollama`
**Type:** LLM
**Description:** LLM extraction using a locally running Ollama instance

**When to use:** You want to use a local Ollama installation for regulation extraction (no API key needed, data stays on-premise).

#### Configuration fields

| Field | Key | Type | Required | Default | Description |
|-------|-----|------|----------|---------|-------------|
| Ollama Base URL | `baseUrl` | string | Yes | `http://localhost:11434` | URL of the running Ollama instance |
| Model | `model` | dynamic-select | Yes | -- | Model name (fetched from Ollama API, e.g. `llama3`, `mistral`, `phi3`) |

#### Setup steps

1. Install [Ollama](https://ollama.com) and pull a model (e.g. `ollama pull llama3`)
2. Go to **Admin > Plugins** and install **Ollama (local)**
3. Enter the Ollama base URL, then click the refresh button next to Model to fetch available models
4. Select a model, click **Save**, then **Activate**

---

## Storage plugins (coming soon)

The dashboard's internal data layer uses a **StorageAdapter** architecture — a pluggable interface backed by 14 domain repositories (scans, users, roles, teams, organizations, plugins, etc.). Currently, only the built-in SQLite adapter is available.

Future storage plugins will allow the dashboard to use external databases as its primary data store:

| Package | Backend | Status |
|---------|---------|--------|
| `@luqen/plugin-storage-postgres` | PostgreSQL | Coming soon |
| `@luqen/plugin-storage-mongodb` | MongoDB | Coming soon |

These plugins are distinct from the existing **Storage** plugin type (S3, Azure Blob) which handles report file storage. Storage adapter plugins replace the dashboard's internal database engine and will be managed through the same plugin lifecycle (install, configure, activate) at **Admin > Plugins**.

For multi-replica Kubernetes deployments or environments requiring a shared database, Postgres is the recommended adapter once available.

---

## Developing custom plugins

Plugins are packages with a `manifest.json` and a default export implementing the `PluginInstance` interface. They are distributed as tarballs via the [luqen-plugins](https://github.com/trunten82/luqen-plugins) catalogue on GitHub. The development guide covers:

- Manifest schema and config field types
- Plugin instance interfaces (`AuthPlugin`, `NotificationPlugin`, `StoragePlugin`, `ScannerPlugin`, `LLMPlugin`, `GitHostPlugin`)
- Lifecycle hooks (`activate`, `deactivate`, `healthCheck`)
- The `adminPages` system for registering custom admin pages
- Publishing to the plugin catalogue

See [Plugin Development Guide](plugin-development.md) for the full reference.

---

*See also: [Plugin Development](plugin-development.md) | [Dashboard Admin](../guides/dashboard-admin.md) | [Enterprise SSO](../paths/enterprise-sso.md)*
