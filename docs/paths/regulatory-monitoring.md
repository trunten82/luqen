[Docs](../README.md) > [Paths](./) > Regulatory Monitoring

# Regulatory Monitoring — Track Legal Changes

Composition path 7: monitor legal sources for accessibility regulation changes and feed proposals into the compliance service. Path 8 (standalone) is covered at the end.

---

## Prerequisites

- Node.js 20+
- `@pally-agent/compliance` service running (for path 7; not needed for standalone mode)

---

## Install

```bash
git clone https://github.com/alanna82/pally-agent.git ~/pally-agent
cd ~/pally-agent && npm install && npm run build --workspaces
```

---

## Configure sources

Sources are URLs the monitor checks for changes. Add them via the compliance API:

```bash
# Get a token
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials","client_id":"'$CLIENT_ID'","client_secret":"'$CLIENT_SECRET'"}' \
  | jq -r .access_token)

# Add a source
curl -X POST http://localhost:4000/api/v1/sources \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "W3C WAI Policies",
    "url": "https://www.w3.org/WAI/policies/",
    "type": "html",
    "schedule": "weekly"
  }'
```

Or use the MCP tool: ask your AI assistant "Add https://www.w3.org/WAI/policies/ as a weekly HTML source named W3C WAI Policies".

---

## Configure the monitor

The monitor connects to the compliance service via environment variables:

```bash
export MONITOR_COMPLIANCE_URL=http://localhost:4000
export MONITOR_CLIENT_ID=$CLIENT_ID
export MONITOR_CLIENT_SECRET=$CLIENT_SECRET
```

---

## Run a scan

```bash
cd ~/pally-agent/packages/monitor
node dist/cli.js scan
```

Output:
```json
{
  "scanned": 5,
  "changed": 1,
  "unchanged": 4,
  "errors": 0,
  "proposals": [...]
}
```

The monitor fetches each source, computes a SHA-256 hash, and creates an `UpdateProposal` in the compliance service for any source whose content has changed since the last scan.

---

## Check status

```bash
node dist/cli.js status
```

Returns the number of monitored sources, last scan time, and pending proposal count.

---

## Interpret proposals

When the monitor detects a change, it creates a proposal in the compliance service. Review proposals via the compliance API or MCP tools:

```bash
# List pending proposals
curl http://localhost:4000/api/v1/proposals?status=pending \
  -H "Authorization: Bearer $TOKEN"

# Approve a proposal (applies the change)
curl -X POST http://localhost:4000/api/v1/proposals/$PROPOSAL_ID/approve \
  -H "Authorization: Bearer $TOKEN"
```

Proposals include the source URL, a summary of the detected change, and the proposed action (new regulation, amendment, or repeal).

---

## Standalone mode

Run the monitor without a compliance service by configuring sources in a local JSON file.

Create `.pally-monitor.json` in your project root or home directory:

```json
{
  "sources": [
    {
      "name": "W3C WAI Policies",
      "url": "https://www.w3.org/WAI/policies/",
      "type": "html",
      "schedule": "weekly"
    },
    {
      "name": "EU Official Journal",
      "url": "https://eur-lex.europa.eu/oj/direct-access.html",
      "type": "html",
      "schedule": "daily"
    }
  ]
}
```

Run with the local sources file:

```bash
node dist/cli.js scan --sources-file .pally-monitor.json
```

The monitor fetches each source and reports changes to stdout. Without a compliance service, proposals are printed as JSON but not persisted.

Lookup order: explicit `--sources-file` path, then `.pally-monitor.json` in the current directory, then `~/.pally-monitor.json`.

---

## MCP tools (3)

| Tool | Description |
|------|-------------|
| `monitor_scan_sources` | Run a full scan of all monitored sources |
| `monitor_status` | Show monitor status and pending proposal count |
| `monitor_add_source` | Add a new legal source URL |

See [IDE integration](ide-integration.md) for MCP server setup.

---

## Next steps

- Set up compliance checking: [Compliance checking](compliance-checking.md)
- Deploy the full platform: [Full dashboard](full-dashboard.md)
- Monitor configuration: [configuration/monitor.md](../configuration/monitor.md)

---

*See also: [What is Pally Agent?](../getting-started/what-is-pally.md) | [Compliance guide](../guides/compliance-check.md)*
