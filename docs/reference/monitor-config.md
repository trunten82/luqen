[Docs](../README.md) > [Configuration](./) > Monitor

# Monitor Agent Configuration Reference

`@pally-agent/monitor` — environment variables and CLI flags.

The monitor agent watches legal sources for content changes and creates UpdateProposals in the compliance service when a change is detected. It has no config file — all configuration is via environment variables.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONITOR_COMPLIANCE_URL` | Yes | Base URL of the compliance service (e.g. `http://localhost:4000`) |
| `MONITOR_CLIENT_ID` | Yes | OAuth client ID with `admin` scope |
| `MONITOR_CLIENT_SECRET` | Yes | OAuth client secret |

---

## Setup

```bash
# Create an OAuth client for the monitor in the compliance service
pally-compliance clients create \
  --name "monitor" \
  --scope "admin" \
  --grant client_credentials
# → note the client_id and client_secret

# Set env vars
export MONITOR_COMPLIANCE_URL=http://localhost:4000
export MONITOR_CLIENT_ID=<client-id>
export MONITOR_CLIENT_SECRET=<client-secret>
```

---

## CLI reference

### `pally-monitor scan`

Run a one-off scan of all monitored sources. For each source, fetches the content, computes a SHA-256 hash, and compares to the stored hash. If changed, creates an UpdateProposal in the compliance service.

```bash
pally-monitor scan
```

Output:
```
Scanned 3 sources
1 proposal created: W3C WAI Policies (https://www.w3.org/WAI/policies/)
```

### `pally-monitor status`

Show the current state of monitored sources.

```bash
pally-monitor status
```

Output:
```
Sources: 3
Last scan: 2026-03-19T10:00:00Z
Pending proposals: 1
```

### `pally-monitor mcp`

Start the MCP server on stdio for use with Claude Code.

```bash
pally-monitor mcp
```

This provides 3 MCP tools: `monitor_scan_sources`, `monitor_status`, `monitor_add_source`.

---

## Adding sources

Sources are managed via the compliance service. Add a source via CLI:

```bash
curl -X POST http://localhost:4000/api/v1/sources \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "W3C WAI Policies",
    "url": "https://www.w3.org/WAI/policies/",
    "type": "html",
    "schedule": "weekly"
  }'
```

Or via the dashboard admin section at `/admin/sources`.

### Source types

| Type | Description |
|------|-------------|
| `html` | Fetch HTML page and hash the content |
| `rss` | Parse RSS/Atom feed for new entries |
| `api` | Fetch JSON API response |

### Schedules

Schedules (`daily`, `weekly`, `monthly`) are informational — the monitor agent does not run automatically on a schedule. Use a cron job or scheduled CI pipeline to call `pally-monitor scan` at the desired frequency.

---

## Scheduling with cron

```bash
# Run every Monday at 06:00 UTC
0 6 * * 1 MONITOR_COMPLIANCE_URL=http://localhost:4000 MONITOR_CLIENT_ID=xxx MONITOR_CLIENT_SECRET=xxx pally-monitor scan
```

---

*See also: [integrations/claude-code.md](../integrations/claude-code.md) | [configuration/compliance.md](compliance.md) | [compliance/README.md](../compliance/README.md)*
