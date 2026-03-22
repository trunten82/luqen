[Docs](../README.md) > [Reference](./) > Plugin Guide

# Plugin Configuration Guide

A comprehensive reference for all available luqen plugins — what they do, how to configure them, and when to use each one.

---

## Plugin architecture overview

The luqen dashboard supports a plugin system that extends its capabilities in four areas:

| Plugin type | Purpose | Example |
|-------------|---------|---------|
| **Auth** | SSO authentication providers | Azure Entra ID |
| **Notification** | Send scan events to external channels | Slack, Microsoft Teams, Email |
| **Storage** | External report storage backends | AWS S3, Azure Blob Storage |
| **Scanner** | Custom WCAG rule evaluation | (custom implementations) |

Plugins are managed from **Admin > Plugins** in the dashboard UI, or via the CLI (`luqen-dashboard plugin install|configure|activate|deactivate|remove`).

### How plugins work

Each plugin is an npm package with a `manifest.json` that declares its type, configuration fields, and capabilities. The dashboard discovers available plugins from a built-in registry (`plugin-registry.json`), installs them into the configured `pluginsDir`, and manages their lifecycle through a database-backed state machine.

Configuration values are stored in the dashboard database. Fields marked as `secret` in the manifest are encrypted with AES-256-GCM using the dashboard's `sessionSecret` as the encryption key. Secret values are masked in the UI and API responses.

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

Every plugin follows the same lifecycle:

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

1. **Discover** — browse available plugins in the Plugin Registry tab at **Admin > Plugins**.
2. **Install** — click **Install** to download the plugin package. Status becomes `inactive`.
3. **Configure** — open the plugin settings and fill in the required configuration fields. Click **Save**.
4. **Activate** — click **Activate**. The dashboard runs a health check to verify connectivity. On success, status becomes `active`.
5. **Health check** — active plugins are checked every 30 seconds. After 3 consecutive failures, the plugin is either auto-deactivated (if `autoDeactivateOnFailure` is set) or marked `unhealthy`.
6. **Deactivate** — click **Deactivate** to stop the plugin without removing it. Configuration is preserved.
7. **Remove** — click **Remove** to deactivate, delete the database record, and remove the package files.

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

## Developing custom plugins

Plugins are standard npm packages with a `manifest.json` and a default export implementing the `PluginInstance` interface. The development guide covers:

- Manifest schema and config field types
- Plugin instance interfaces (`AuthPlugin`, `NotificationPlugin`, `StoragePlugin`, `ScannerPlugin`)
- Lifecycle hooks (`activate`, `deactivate`, `healthCheck`)
- The `adminPages` system for registering custom admin pages
- Registry entry format for adding plugins to the built-in registry

See [Plugin Development Guide](plugin-development.md) for the full reference.

---

*See also: [Plugin Development](plugin-development.md) | [Dashboard Admin](../guides/dashboard-admin.md) | [Enterprise SSO](../paths/enterprise-sso.md)*
