# Integrating luqen with the Compliance Service

Connect luqen to the compliance service to automatically annotate accessibility scan results with legal context.

## Overview

Without the compliance service:
```
luqen scan → WCAG violations list
```

With the compliance service:
```
luqen scan → WCAG violations → compliance check → enriched report
                                           ↓
                           per-jurisdiction pass/fail matrix
                           legal obligation levels
                           specific regulation references
```

## Configuration

### Step 1: Create a compliance OAuth client

On the compliance service:

```bash
luqen-compliance clients create \
  --name "luqen" \
  --scope "read" \
  --grant client_credentials
```

Note the `client_id` and `client_secret`.

### Step 2: Configure luqen

Add a `compliance` section to `.luqen.json`:

```json
{
  "webserviceUrl": "http://localhost:3000",
  "standard": "WCAG2AA",
  "concurrency": 3,
  "compliance": {
    "url": "http://localhost:4000",
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "jurisdictions": ["EU", "US", "UK"],
    "sectors": [],
    "includeOptional": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Base URL of the compliance service |
| `clientId` | string | OAuth client ID |
| `clientSecret` | string | OAuth client secret |
| `jurisdictions` | string[] | Default jurisdictions to check |
| `sectors` | string[] | Filter regulations by sector (empty = all) |
| `includeOptional` | boolean | Include optional requirement violations |

Use environment variables for secrets:

```json
{
  "compliance": {
    "url": "${COMPLIANCE_URL}",
    "clientId": "${COMPLIANCE_CLIENT_ID}",
    "clientSecret": "${COMPLIANCE_CLIENT_SECRET}",
    "jurisdictions": ["EU", "US"]
  }
}
```

## Workflow: scan → compliance check → enriched report

### Integrated workflow (recommended — v0.2.0+)

luqen has native compliance integration. Pass credentials on the CLI and the enriched report is produced in a single step:

```bash
luqen scan https://example.com \
  --format both \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU,US,UK \
  --compliance-client-id $COMPLIANCE_CLIENT_ID \
  --compliance-client-secret $COMPLIANCE_CLIENT_SECRET
```

The HTML report includes:
- A compliance matrix table (per-jurisdiction pass/fail)
- Regulation badges on each issue (e.g. `EAA`, `ADA`) — clicking a badge opens the official legal text (v0.3.0+)
- WCAG criterion links on every issue (v0.3.0+)

The JSON report includes:
- `compliance` field — jurisdiction matrix with mandatory violation counts
- `templateIssues` array — issues deduplicated across 3+ pages (v0.3.0+)
- `regulations` array on each issue — legal annotations with optional `url` field

### Manual workflow (shell pipeline)

If you need more control or are scripting outside of luqen:

```bash
# Step 1: Scan the website
luqen scan https://example.com --format json

# Step 2: Obtain a token
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"$COMPLIANCE_CLIENT_ID\",\"client_secret\":\"$COMPLIANCE_CLIENT_SECRET\",\"scope\":\"read\"}" \
  | jq -r '.access_token')

# Step 3: Extract issues and check compliance
ISSUES=$(jq '[.pages[].issues[] | {code:.code,type:.type,message:.message,selector:.selector,context:.context}]' \
  luqen-reports/luqen-report-*.json)

curl -X POST http://localhost:4000/api/v1/compliance/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jurisdictions\":[\"EU\",\"US\",\"UK\"],\"issues\":$ISSUES}" \
  | jq '.summary'
```

## Reading the enriched report

### Summary

```json
{
  "summary": {
    "totalJurisdictions": 3,
    "passing": 1,
    "failing": 2,
    "totalMandatoryViolations": 5,
    "totalOptionalViolations": 0
  }
}
```

### Per-jurisdiction results

```json
{
  "matrix": {
    "EU": {
      "status": "fail",
      "mandatoryViolations": 3,
      "regulations": [
        {
          "regulationId": "EU-EAA",
          "regulationName": "European Accessibility Act",
          "shortName": "EAA",
          "status": "fail",
          "enforcementDate": "2025-06-28",
          "violations": [
            { "wcagCriterion": "1.1.1", "obligation": "mandatory", "issueCount": 2 },
            { "wcagCriterion": "1.3.1", "obligation": "mandatory", "issueCount": 1 }
          ]
        }
      ]
    }
  }
}
```

### Annotated issues

Each pa11y issue is enriched with the regulations it violates:

```json
{
  "annotatedIssues": [
    {
      "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "wcagCriterion": "1.1.1",
      "wcagLevel": "AA",
      "originalIssue": {
        "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
        "message": "Img element missing an alt attribute.",
        "selector": "img.hero-image",
        "context": "<img class=\"hero-image\" src=\"hero.jpg\">"
      },
      "regulations": [
        {
          "regulationId": "EU-EAA",
          "shortName": "EAA",
          "jurisdictionId": "EU",
          "obligation": "mandatory",
          "enforcementDate": "2025-06-28"
        },
        {
          "regulationId": "US-ADA",
          "shortName": "ADA",
          "jurisdictionId": "US",
          "obligation": "mandatory",
          "enforcementDate": "1990-07-26"
        }
      ]
    }
  ]
}
```

## A2A integration (agent-to-agent)

luqen can also call the compliance service via the A2A protocol. This uses task semantics with SSE streaming for progress updates.

### A2A config in luqen

```json
{
  "a2a": {
    "peers": [
      {
        "name": "luqen-compliance",
        "url": "http://localhost:4000",
        "clientId": "YOUR_CLIENT_ID",
        "clientSecret": "YOUR_CLIENT_SECRET"
      }
    ]
  }
}
```

### How it works

1. luqen discovers the compliance service via `GET http://localhost:4000/.well-known/agent.json`
2. Authenticates using client credentials: `POST /api/v1/oauth/token`
3. Submits a task: `POST /a2a/tasks` with `skill: "compliance-check"`
4. Streams progress: `GET /a2a/tasks/:id/stream`
5. Retrieves result: `GET /a2a/tasks/:id`

## Data API for external integrations

The dashboard (v0.14.0+) provides read-only JSON and CSV endpoints for programmatic access to scan results, issue data, trends, and compliance summaries. These endpoints use `X-API-Key` header authentication (separate from the OAuth credentials above) and are rate limited to 60 requests per minute.

Use these endpoints to feed scan data into Power BI, custom dashboards, or CI/CD pipelines without re-running scans. See [API Reference — Dashboard Data API](../../reference/api-reference.md#dashboard-data-api) for full endpoint documentation.

## Jurisdiction selection guide

Choose jurisdictions based on where your users are located or where you operate:

| If your users are in... | Check jurisdictions |
|------------------------|---------------------|
| European Union | `EU` (covers all member states via EAA/WAD) |
| Germany specifically | `DE`, `EU` (BITV 2.0 + EAA/WAD) |
| France specifically | `FR`, `EU` (RGAA + EAA/WAD) |
| United States | `US` (Section 508 + ADA) |
| United Kingdom | `UK` (Equality Act + PSBAR) |
| Australia | `AU` (DDA) |
| Canada | `CA` (ACA) |
| Japan | `JP` (JIS X 8341-3) |
| Global public-facing site | `EU`, `US`, `UK`, `AU`, `CA`, `JP` |
