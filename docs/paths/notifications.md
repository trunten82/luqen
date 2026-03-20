[Docs](../README.md) > [Paths](./) > Slack Notifications

# Slack Notifications

Send real-time accessibility scan results and compliance alerts to a Slack channel using the Slack Notifications plugin.

---

## Prerequisites

- Running pally-agent dashboard (see [Full Dashboard](full-dashboard.md))
- Admin access to the dashboard
- A Slack workspace where you can create apps

---

## 1. Create a Slack webhook

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**, name the app (e.g. `Pally Agent`), and select your workspace
3. In the app settings, go to **Incoming Webhooks** and toggle it **On**
4. Click **Add New Webhook to Workspace**
5. Select the channel where notifications should be posted (e.g. `#accessibility`)
6. Click **Allow**
7. Copy the **Webhook URL** — it looks like `https://hooks.slack.com/services/T00.../B00.../xxxx`

Keep this URL safe. It will be stored encrypted in the dashboard.

---

## 2. Install the plugin

### Via dashboard UI

1. Log in as an admin
2. Go to **Settings > Plugins**
3. Find **Slack Notifications** in the Plugin Registry tab
4. Click **Install**

### Via CLI

```bash
pally-dashboard plugin install @pally-agent/plugin-notify-slack
```

### Via config file

Add the plugin to your `pally-plugins.json`:

```json
{
  "plugins": [
    {
      "package": "@pally-agent/plugin-notify-slack"
    }
  ]
}
```

---

## 3. Configure the plugin

### Via dashboard UI

1. Click the installed **Slack Notifications** plugin
2. Fill in the configuration fields (see table below)
3. Click **Save**

### Via CLI

```bash
pally-dashboard plugin configure <plugin-id> \
  --set webhookUrl=https://hooks.slack.com/services/T00.../B00.../xxxx \
        channel=#accessibility \
        username="Pally Agent" \
        events=scan.complete,violation.found
```

### Configuration options

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `webhookUrl` | Yes | — | The Slack Incoming Webhook URL. Stored encrypted (AES-256-GCM). |
| `channel` | No | `#accessibility` | Override the default channel set in the Slack app. |
| `username` | No | `Pally Agent` | Bot display name shown in Slack messages. |
| `events` | No | All events | Comma-separated list of event types to send. See section 4. |

---

## 4. Event types

Subscribe to specific events by setting the `events` configuration field. If omitted, all event types are enabled.

| Event | Trigger | Message includes |
|-------|---------|-----------------|
| `scan.complete` | A scan finishes successfully | URL, pages scanned, total issues found |
| `scan.failed` | A scan fails with an error | URL, error message |
| `violation.found` | Accessibility violations detected | WCAG criterion, occurrence count |
| `regulation.changed` | A monitored regulation is updated | Regulation name, change summary |

Example — subscribe only to scan results:

```bash
pally-dashboard plugin configure <plugin-id> \
  --set events=scan.complete,scan.failed
```

---

## 5. Activate and test

### Activate the plugin

Click **Activate** on the plugin card in the dashboard, or run:

```bash
pally-dashboard plugin activate <plugin-id>
```

The system runs a health check to verify the webhook URL is reachable.

### Test the integration

1. Run a scan from the dashboard against any URL
2. Wait for the scan to complete
3. Check your Slack channel for the notification message
4. Verify the message contains the scan URL and issue count

Plugin health status is visible at **Settings > Plugins** — a green indicator confirms the webhook is responding.

---

## Troubleshooting

**"Webhook URL invalid"** — the URL must match the format `https://hooks.slack.com/services/...`. Copy the full URL from the Slack app settings page.

**"403 Forbidden when sending"** — the Slack app may have been removed or its permissions revoked. Regenerate the webhook in the Slack app settings and update the plugin configuration.

**"No messages appearing in Slack"** — check the `events` configuration. If specific events are configured, only those event types trigger messages. Ensure the event type you expect (e.g. `scan.complete`) is included.

**"Health check failing"** — the webhook URL may be unreachable from the server. Verify network connectivity and that the Slack app is still active.

---

## Next steps

- [Full Dashboard guide](full-dashboard.md) — setup and administration
- [Regulatory Monitoring](regulatory-monitoring.md) — track regulation changes
- [CLI reference](../reference/cli-reference.md) — plugin management commands

---

*See also: [Managing Plugins](full-dashboard.md#managing-plugins) | [Compliance Checking](compliance-checking.md)*
