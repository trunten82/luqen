[Docs](../README.md) > [Integrations](./) > Claude Code

# Claude Code Integration

Set up pally-agent MCP servers for Claude Code — gives Claude 20 tools for accessibility scanning, compliance checking, and regulatory monitoring.

---

## Configuration

Add all servers to `.claude/settings.json` in your project, or `~/.claude/settings.json` for global access:

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

Build first:

```bash
cd /root/pally-agent
npm run build --workspaces
```

Restart Claude Code after editing the config.

---

## Tool inventory

### pally-agent (core) — 6 tools

| Tool | Description |
|------|-------------|
| `pally_scan` | Site-wide scan with page discovery, source mapping, and enriched report |
| `pally_get_issues` | Filter issues from an existing report by severity, URL pattern, or rule code |
| `pally_propose_fixes` | Map issues to source files and generate fix proposals |
| `pally_apply_fix` | Apply a single fix to a source file |
| `pally_raw` | Single-page pa11y passthrough (raw pa11y-webservice format) |
| `pally_raw_batch` | Multi-page pa11y passthrough with concurrency control |

### pally-compliance — 11 tools

| Tool | Description |
|------|-------------|
| `compliance_check` | Check pa11y issues against jurisdiction legal requirements |
| `compliance_list_jurisdictions` | List jurisdictions with optional type/parent filters |
| `compliance_list_regulations` | List regulations with jurisdiction/status/scope filters |
| `compliance_list_requirements` | List WCAG requirement mappings |
| `compliance_get_regulation` | Get a single regulation with all its requirements |
| `compliance_propose_update` | Submit a proposed rule change |
| `compliance_get_pending` | List pending update proposals |
| `compliance_approve_update` | Approve and apply a pending proposal |
| `compliance_list_sources` | List monitored legal sources |
| `compliance_add_source` | Add a URL to monitor for regulatory changes |
| `compliance_seed` | Load the baseline compliance dataset |

### pally-monitor — 3 tools

| Tool | Description |
|------|-------------|
| `monitor_scan_sources` | Scan all monitored sources for content changes |
| `monitor_status` | Show source count, last scan time, and pending proposals |
| `monitor_add_source` | Add a legal source to monitor |

---

## Example conversations

### Basic scan and fix

```
User: Check example.com for accessibility issues.

Claude: [calls pally_scan with url="https://example.com"]
Found 7 issues across 12 pages: 3 errors, 4 warnings.
The most critical issues are on /about (missing alt text) and /contact (unlabelled inputs).

User: Fix the errors on /about.

Claude: [calls pally_propose_fixes]
I found 2 fixable issues in app/about/page.tsx.

Fix 1: Add alt="" to the hero image at line 24.
  Before: <img src="/hero.jpg">
  After:  <img alt="" src="/hero.jpg">

Shall I apply this fix?

User: Yes.

Claude: [calls pally_apply_fix]
Applied. The file has been updated.
```

### Compliance-enriched scan

```
User: Scan example.com and tell me which EU laws we're violating.

Claude: [calls pally_scan with url="https://example.com"]
        [calls compliance_check with jurisdictions=["EU"]]

Found 3 confirmed violations under the European Accessibility Act (EAA):
- Missing alt text on logo (criterion 1.1.1) — mandatory under EAA
- Unlabelled email input on /contact (criterion 1.3.1) — mandatory under EAA
- Missing page language declaration (criterion 3.1.1) — mandatory under EAA

The EU Web Accessibility Directive (WAD) also requires these to be fixed.

Shall I generate fix proposals?
```

### Regulatory monitoring workflow

```
User: Have any accessibility regulations changed recently?

Claude: [calls monitor_scan_sources]
Scanned 3 monitored sources.
1 change detected: W3C WAI Policies page updated.
A new UpdateProposal has been created.

[calls compliance_get_pending]
Pending proposal: "W3C WAI Policies — possible new WCAG 2.2 requirement mapping"

Would you like me to review the proposal and approve or reject it?
```

### CI-style automated workflow

```
Claude: [calls pally_scan with url="https://staging.example.com"]
        [calls pally_get_issues with severity="error"]
        [calls pally_propose_fixes]
        [presents all changes to user for review]
        [calls pally_apply_fix for each approved fix]
        [calls pally_scan again to verify]
        All 3 errors resolved. Re-scan shows 0 errors.
```

---

## pally_scan — full input reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | `string` | Yes | — | Root URL to scan |
| `standard` | `"WCAG2A" \| "WCAG2AA" \| "WCAG2AAA"` | No | `"WCAG2AA"` | WCAG level |
| `concurrency` | `number` | No | `5` | Parallel scans |
| `maxPages` | `number` | No | `100` | Max pages to scan |
| `alsoCrawl` | `boolean` | No | `false` | Crawl in addition to sitemap |
| `ignore` | `string[]` | No | `[]` | Rule codes to exclude |
| `headers` | `object` | No | `{}` | HTTP headers for the target site |
| `wait` | `number` | No | `0` | Wait after page load (ms) |

Output includes: `summary`, `pages`, `errors`, `reportPath`, `templateIssues` (when applicable), `compliance` (when enabled).

---

## Environment variables for MCP

The `pally-agent` MCP server reads `PALLY_WEBSERVICE_URL` from the environment. Set it in the MCP config:

```json
{
  "mcpServers": {
    "pally-agent": {
      "command": "node",
      "args": ["/root/pally-agent/packages/core/dist/mcp.js"],
      "env": {
        "PALLY_WEBSERVICE_URL": "http://localhost:3000"
      }
    }
  }
}
```

---

*See also: [ARCHITECTURE.md](../ARCHITECTURE.md) | [integrations/api-reference.md](api-reference.md) | [guides/fix-proposals.md](../guides/fix-proposals.md)*
