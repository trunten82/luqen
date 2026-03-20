---
name: pally-agent
description: Use when the user asks to check accessibility, run a11y scans, fix WCAG issues, audit a website for accessibility compliance, or when working on frontend code that should meet WCAG standards. Also use when user mentions pa11y, WCAG, or accessibility testing.
---

# Pally Agent — Accessibility Scanner

Scan entire websites for WCAG accessibility issues via pa11y, map issues to source files, and propose/apply code fixes.

## Setup

### As MCP Server (recommended for Claude Code)

Add to `.claude/settings.json` (all 4 servers — 20 tools total):

```json
{
  "mcpServers": {
    "pally-agent": {
      "command": "node",
      "args": ["/root/pally-agent/packages/core/dist/mcp.js"]
    },
    "pally-compliance": {
      "command": "node",
      "args": ["/root/pally-agent/packages/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_DB_PATH": "/root/pally-agent/packages/compliance/compliance.db"
      }
    },
    "pally-monitor": {
      "command": "node",
      "args": ["/root/pally-agent/packages/monitor/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_URL": "http://localhost:4000",
        "COMPLIANCE_CLIENT_ID": "<client-id>",
        "COMPLIANCE_CLIENT_SECRET": "<client-secret>"
      }
    }
  }
}
```

Build first: `cd /root/pally-agent && npm run build --workspaces`

This gives Claude Code **20 MCP tools**: 6 for scanning/fixing (pally-agent), 11 for compliance (pally-compliance), and 3 for regulatory monitoring (pally-monitor).

### As CLI

```bash
cd /root/pally-agent && npm link
```

## MCP Tools

### `pally_scan` — Scan a website

```json
{ "url": "https://example.com", "standard": "WCAG2AA", "alsoCrawl": true }
```

Returns: summary (pages, issues, severity counts) + per-page results with CSS selectors.

### `pally_get_issues` — Filter issues from a report

```json
{ "reportPath": "./pally-reports/report.json", "severity": "error" }
```

Filter by `urlPattern`, `severity` (error/warning/notice), or `ruleCode`.

### `pally_propose_fixes` — Get fix proposals for a repo

```json
{ "reportPath": "./pally-reports/report.json", "repoPath": "/path/to/repo" }
```

Returns fixable/unfixable counts + concrete `oldText`/`newText` diffs per file.

### `pally_apply_fix` — Apply a single fix

```json
{ "file": "/path/to/file.tsx", "line": 12, "oldText": "<img src=\"x\">", "newText": "<img alt=\"\" src=\"x\">" }
```

### `pally_raw` — Single-page pa11y passthrough (backward compatible)

```json
{ "url": "https://example.com/page", "standard": "WCAG2AA" }
```

Returns raw pa11y-webservice output (identical format). Supports `actions` for pre-test interactions.

### `pally_raw_batch` — Multi-page pa11y passthrough

```json
{ "urls": ["https://example.com/", "https://example.com/about"], "concurrency": 5 }
```

Returns array of `{ url, result, error? }` with raw pa11y output per URL.

## CLI Usage

```bash
# Scan a site
pally-agent scan https://example.com --format json,html

# Scan with source mapping
pally-agent scan https://example.com --repo ./my-project

# Compliance-enriched scan (v0.2.0+)
pally-agent scan https://example.com \
  --format both \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU,US,UK \
  --compliance-client-id $CLIENT_ID \
  --compliance-client-secret $CLIENT_SECRET

# Fix interactively
pally-agent fix https://example.com --repo ./my-project

# Fix from existing report
pally-agent fix --from-report ./pally-reports/report.json --repo ./my-project
```

### Compliance CLI Options (v0.2.0+)

| Option | Description |
|--------|-------------|
| `--compliance-url <url>` | Base URL of the compliance service |
| `--jurisdictions <list>` | Comma-separated jurisdiction IDs (e.g. `EU,US,UK`) |
| `--compliance-client-id <id>` | OAuth client ID |
| `--compliance-client-secret <secret>` | OAuth client secret |

### v0.3.0 Report Enhancements

- **WCAG hyperlinks** — `wcagInfo.url` on every issue links to W3C Understanding WCAG 2.1
- **Regulation hyperlinks** — `regulations[].url` on annotated issues links to official legal texts
- **Template issue deduplication** — issues with the same `code+selector+context` on 3+ pages are grouped in the top-level `templateIssues` array (removes ~84% of duplicate noise)

## Typical Workflow

1. **Scan:** `pally_scan` with the target URL
2. **Review:** `pally_get_issues` filtered to errors first
3. **Map:** `pally_propose_fixes` with repo path to get file-level diffs
4. **Fix:** `pally_apply_fix` per issue (confirm with user before each)
5. **Re-scan:** `pally_scan` again to verify fixes

## Configuration

Place `.pally-agent.json` in repo root:

```json
{
  "webserviceUrl": "http://192.168.3.90:3000",
  "standard": "WCAG2AA",
  "concurrency": 5,
  "sourceMap": { "/docs/*": "src/templates/docs.tsx" }
}
```

Env overrides: `PALLY_WEBSERVICE_URL`, `PALLY_WEBSERVICE_AUTH`, `PALLY_AGENT_CONFIG`.

## Auto-fixable Issues

| Pattern | Fix |
|---------|-----|
| `<img>` missing alt | Adds `alt=""` |
| `<input>` missing label | Adds `aria-label` |
| `<html>` missing lang | Adds `lang="en"` |

Issues like empty links and heading hierarchy are flagged but require human judgment.

## Exit Codes (CLI)

`0` clean, `1` issues found, `2` partial scan failure, `3` fatal error.

---

## Pally Dashboard

Web dashboard for browsing reports and managing scans. HTMX-powered, no JS build step.

### Start Dashboard

```bash
cd /root/pally-agent/packages/dashboard && npm run build
node dist/cli.js serve --port 5000
# Open http://localhost:5000
```

Or via Docker: `docker compose up -d` (starts compliance + dashboard together)

### Features

**User section:** New scan launcher (with jurisdiction picker), live SSE progress, report browser (search/filter/sort), report viewer, delete reports

**Admin section:** CRUD jurisdictions/regulations/requirements, review/approve update proposals, manage sources/webhooks/users/OAuth clients, system health

### Roles

| Role | Access |
|------|--------|
| `viewer` | Browse reports only |
| `user` | Scan + reports |
| `admin` | Full admin section |

Create users via compliance CLI: `pally-compliance users create --username admin --role admin`

---

## Pally Compliance Service

The compliance service (`@pally-agent/compliance`) maps WCAG violations to country-specific legal requirements. It is a separate service that pally-agent and Claude Code can call.

### MCP Setup (compliance service)

Add alongside `pally-agent` in `.claude/settings.json`:

```json
{
  "mcpServers": {
    "pally-agent": {
      "command": "node",
      "args": ["/root/pally-agent/dist/mcp.js"]
    },
    "pally-compliance": {
      "command": "node",
      "args": ["/root/pally-agent/packages/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_DB_PATH": "/root/pally-agent/packages/compliance/compliance.db"
      }
    }
  }
}
```

Build first:
```bash
cd /root/pally-agent/packages/compliance && npm run build
node dist/cli.js keys generate
node dist/cli.js seed
```

### Compliance MCP Tools (11 total)

#### `compliance_check` — Core tool

```json
{
  "jurisdictions": ["EU", "US", "UK"],
  "issues": [
    {
      "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "type": "error",
      "message": "Img element missing an alt attribute.",
      "selector": "img#logo",
      "context": "<img id=\"logo\" src=\"logo.png\">"
    }
  ],
  "includeOptional": false,
  "sectors": ["e-commerce"]
}
```

Returns: `{ matrix, annotatedIssues, summary }` — per-jurisdiction pass/fail with regulation names, obligation levels, and enforcement dates.

#### `compliance_list_jurisdictions`

```json
{ "type": "country", "parentId": "EU" }
```

Lists jurisdictions. Filters: `type` (`supranational`/`country`/`state`), `parentId`.

#### `compliance_list_regulations`

```json
{ "jurisdictionId": "US", "status": "active" }
```

Filters: `jurisdictionId`, `status` (`active`/`draft`/`repealed`), `scope` (`public`/`private`/`all`).

#### `compliance_list_requirements`

```json
{ "regulationId": "EU-EAA", "obligation": "mandatory" }
```

Filters: `regulationId`, `wcagCriterion`, `obligation`.

#### `compliance_get_regulation`

```json
{ "id": "EU-EAA" }
```

Returns the regulation plus all its requirements. Common IDs: `EU-EAA`, `EU-WAD`, `US-508`, `US-ADA`, `UK-EA`, `UK-PSBAR`, `DE-BITV`, `FR-RGAA`, `AU-DDA`, `CA-ACA`, `JP-JIS`.

#### `compliance_propose_update`

```json
{
  "source": "https://eur-lex.europa.eu/...",
  "type": "amendment",
  "summary": "EAA now covers WCAG 2.2",
  "proposedChanges": {
    "action": "update",
    "entityType": "regulation",
    "entityId": "EU-EAA",
    "before": { "wcagVersion": "2.1" },
    "after": { "wcagVersion": "2.2" }
  },
  "affectedRegulationId": "EU-EAA"
}
```

Proposal types: `new_regulation`, `amendment`, `repeal`, `new_requirement`, `new_jurisdiction`.

#### `compliance_get_pending`

```json
{}
```

Lists all pending update proposals awaiting review.

#### `compliance_approve_update`

```json
{ "id": "proposal-id", "reviewedBy": "claude-code" }
```

Approves a proposal and applies the change to the database.

#### `compliance_list_sources`

```json
{}
```

Lists monitored legal source URLs.

#### `compliance_add_source`

```json
{
  "name": "W3C WAI Policies",
  "url": "https://www.w3.org/WAI/policies/",
  "type": "html",
  "schedule": "weekly"
}
```

Source types: `html`, `rss`, `api`. Schedules: `daily`, `weekly`, `monthly`.

#### `compliance_seed`

```json
{}
```

Loads baseline data (idempotent). Run once on setup. Returns counts of jurisdictions/regulations/requirements loaded.

---

## Pally Monitor Agent

Watches monitored legal sources (HTML pages, RSS feeds, APIs) for content changes. When a source changes it creates an UpdateProposal in the compliance service for human review.

### MCP Setup (monitor agent)

Add alongside the other servers in `.claude/settings.json`:

```json
{
  "mcpServers": {
    "pally-agent": {
      "command": "node",
      "args": ["/root/pally-agent/packages/core/dist/mcp.js"]
    },
    "pally-compliance": {
      "command": "node",
      "args": ["/root/pally-agent/packages/compliance/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_DB_PATH": "/root/pally-agent/packages/compliance/compliance.db"
      }
    },
    "pally-monitor": {
      "command": "node",
      "args": ["/root/pally-agent/packages/monitor/dist/cli.js", "mcp"],
      "env": {
        "COMPLIANCE_URL": "http://localhost:4000",
        "COMPLIANCE_CLIENT_ID": "<client-id>",
        "COMPLIANCE_CLIENT_SECRET": "<client-secret>"
      }
    }
  }
}
```

Build first: `cd /root/pally-agent/packages/monitor && npm run build`

### Monitor MCP Tools (3 total)

#### `monitor_scan_sources` — Scan all monitored sources

```json
{}
```

Fetches every source registered in the compliance service, computes a SHA-256 hash, and creates UpdateProposals for any sources whose content has changed. Returns `{ scanned, changed, unchanged, errors }`.

#### `monitor_status` — Show monitor status

```json
{}
```

Returns the number of monitored sources, last scan timestamp, and count of pending proposals.

#### `monitor_add_source` — Add a new source

```json
{
  "name": "W3C WAI Policies",
  "url": "https://www.w3.org/WAI/policies/",
  "type": "html",
  "schedule": "weekly"
}
```

Registers a new URL for monitoring. Source types: `html`, `rss`, `api`. Schedules: `daily`, `weekly`, `monthly`.

### Monitor CLI

```bash
# Run one full scan cycle (detect changes, create proposals)
pally-monitor scan

# Show current status (source count, last scan, pending proposals)
pally-monitor status

# Start MCP server on stdio (for Claude Code)
pally-monitor mcp

# Start HTTP server with A2A agent card endpoint
pally-monitor serve --port 4200
```

---

### Full Audit Workflow (all MCP servers)

```
1. pally_scan — scan the website for WCAG issues
2. pally_get_issues — filter to errors first
3. compliance_check — check issues against EU, US, UK (or relevant jurisdictions)
4. Review matrix: mandatory violations = legal exposure
5. pally_propose_fixes — get code-level fix suggestions
6. Prioritize: fix mandatory violations first (legal), then recommended
7. pally_apply_fix — apply fixes one at a time
8. pally_scan — re-scan to verify
9. monitor_scan_sources — detect any regulation changes that may affect obligations
10. monitor_status — confirm no pending proposals require review
```

### Baseline Jurisdictions

| ID | Name | Key Regulations |
|----|------|----------------|
| EU | European Union | EAA (enforcement: 2025-06-28), WAD |
| US | United States | Section 508, ADA |
| UK | United Kingdom | Equality Act 2010, PSBAR |
| DE | Germany (EU child) | BITV 2.0 |
| FR | France (EU child) | RGAA 4.1 |
| AU | Australia | DDA |
| CA | Canada | ACA |
| JP | Japan | JIS X 8341-3 |

Checking `DE` automatically includes EU regulations (jurisdiction inheritance).

### Compliance CLI

```bash
# Start the REST+MCP+A2A server
pally-compliance serve --port 4000

# Load baseline data
pally-compliance seed

# Create OAuth client for automated tools
pally-compliance clients create --name "ci-pipeline" --scope "read" --grant client_credentials

# List clients
pally-compliance clients list

# Generate JWT key pair (required before first serve)
pally-compliance keys generate

# Start MCP server on stdio (for Claude Code)
pally-compliance mcp
```

### REST API Quick Reference

Base URL: `http://localhost:4000/api/v1`

```bash
# Health check (no auth)
GET /health

# Get token
POST /oauth/token  { grant_type, client_id, client_secret, scope }

# Compliance check (scope: read)
POST /compliance/check  { jurisdictions, issues, includeOptional?, sectors? }

# List jurisdictions (scope: read)
GET /jurisdictions?type=country&parentId=EU

# List regulations (scope: read)
GET /regulations?jurisdictionId=EU&status=active

# Seed baseline (scope: admin)
POST /seed

# Check seed status (scope: read)
GET /seed/status
```
