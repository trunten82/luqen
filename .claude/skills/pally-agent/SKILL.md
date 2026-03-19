---
name: pally-agent
description: Use when the user asks to check accessibility, run a11y scans, fix WCAG issues, audit a website for accessibility compliance, or when working on frontend code that should meet WCAG standards. Also use when user mentions pa11y, WCAG, or accessibility testing.
---

# Pally Agent — Accessibility Scanner

Scan entire websites for WCAG accessibility issues via pa11y, map issues to source files, and propose/apply code fixes.

## Setup

### As MCP Server (recommended for Claude Code)

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "pally-agent": {
      "command": "node",
      "args": ["/root/pally-agent/dist/mcp.js"]
    }
  }
}
```

Build first: `cd /root/pally-agent && npm run build`

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

## CLI Usage

```bash
# Scan a site
pally-agent scan https://example.com --format json,html

# Scan with source mapping
pally-agent scan https://example.com --repo ./my-project

# Fix interactively
pally-agent fix https://example.com --repo ./my-project

# Fix from existing report
pally-agent fix --from-report ./pally-reports/report.json --repo ./my-project
```

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
