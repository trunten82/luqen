[Docs](../README.md) > [Paths](./) > Compliance Checking

# Compliance Checking — Legal Requirement Mapping

Covers composition paths 4-5: scanning with compliance enrichment, and using the compliance API standalone. Uses `@pally-agent/core` + `@pally-agent/compliance`.

---

## Prerequisites

- Node.js 20+
- pa11y webservice running (for scanning; not needed for API-only use)

---

## Install

```bash
git clone https://github.com/trunten82/pally-agent.git ~/pally-agent
cd ~/pally-agent && npm install && npm run build --workspaces
cd packages/core && npm link
```

---

## Start the compliance service

```bash
cd ~/pally-agent/packages/compliance

# Generate JWT keys (first time only)
node dist/cli.js keys generate

# Seed the database with 58 jurisdictions and 62 regulations
node dist/cli.js seed

# Start the API server on port 4000
node dist/cli.js serve
```

Verify: `curl http://localhost:4000/api/v1/health`

---

## Create an OAuth2 client

The compliance API requires OAuth2 `client_credentials` authentication:

```bash
cd ~/pally-agent/packages/compliance
node dist/cli.js clients create --name scanner --scope "read write" --grant client_credentials
```

Save the `client_id` and `client_secret` from the output.

---

## Scan with compliance

```bash
export PALLY_WEBSERVICE_URL=http://localhost:3000

pally-agent scan https://example.com \
  --format both \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU,US,UK \
  --compliance-client-id $CLIENT_ID \
  --compliance-client-secret $CLIENT_SECRET
```

The report now includes a compliance matrix showing pass/fail per jurisdiction and regulation badges on each issue.

---

## Understanding the compliance matrix

The enriched report contains a per-jurisdiction summary:

| Jurisdiction | Status | Mandatory violations |
|--------------|--------|---------------------|
| EU | FAIL | 3 |
| US | FAIL | 3 |
| UK | PASS | 0 |

**FAIL** means confirmed WCAG errors that a law in that jurisdiction requires you to fix. **PASS** means no confirmed errors violate mandatory requirements.

Each issue shows regulation badges (e.g., `EAA`, `ADA`, `BITV 2.0`) linking to the official legal text. Only errors count as violations — warnings and notices are never treated as legal failures.

**Jurisdiction inheritance:** Checking a member state (e.g., `DE`) automatically includes supranational regulations (EU-level EAA, WAD) in addition to country-specific ones (BITV 2.0).

---

## Use the compliance API standalone

The compliance service has a REST API you can call directly without scanning.

### Get an access token

```bash
curl -X POST http://localhost:4000/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "'$CLIENT_ID'",
    "client_secret": "'$CLIENT_SECRET'"
  }'
```

Returns `{ "access_token": "...", "token_type": "Bearer", "expires_in": 3600 }`.

### List jurisdictions

```bash
curl http://localhost:4000/api/v1/jurisdictions \
  -H "Authorization: Bearer $TOKEN"
```

### List regulations for a jurisdiction

```bash
curl "http://localhost:4000/api/v1/regulations?jurisdictionId=EU" \
  -H "Authorization: Bearer $TOKEN"
```

### Check issues programmatically

```bash
curl -X POST http://localhost:4000/api/v1/compliance/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jurisdictions": ["EU", "US"],
    "issues": [
      {
        "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
        "type": "error",
        "message": "Img element missing an alt attribute.",
        "selector": "img.logo",
        "context": "<img src=\"logo.png\">"
      }
    ]
  }'
```

---

## MCP tools (11)

When using the compliance service via MCP in your IDE:

| Tool | Description |
|------|-------------|
| `compliance_check` | Check issues against jurisdiction requirements |
| `compliance_list_jurisdictions` | List jurisdictions (filter by type, parent) |
| `compliance_list_regulations` | List regulations (filter by jurisdiction, status, scope) |
| `compliance_list_requirements` | List requirements (filter by regulation, WCAG criterion) |
| `compliance_get_regulation` | Get full regulation details with requirements |
| `compliance_propose_update` | Submit a rule database change proposal |
| `compliance_get_pending` | List pending update proposals |
| `compliance_approve_update` | Approve and apply a proposal |
| `compliance_list_sources` | List monitored legal sources |
| `compliance_add_source` | Add a new legal source to monitor |
| `compliance_seed` | Load or refresh baseline compliance data |

See [IDE integration](ide-integration.md) for MCP server setup.

---

## Next steps

- Deploy the full dashboard: [Full dashboard](full-dashboard.md)
- Add regulatory monitoring: [Regulatory monitoring](regulatory-monitoring.md)
- Compliance configuration: [configuration/compliance.md](../configuration/compliance.md)

---

*See also: [What is Pally Agent?](../getting-started/what-is-pally.md) | [Compliance guide](../guides/compliance-check.md)*
