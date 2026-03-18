# MCP Tools Reference

Luqen exposes **20 MCP tools** across three packages. Each package runs its own MCP server over stdio.

---

## Server Connection Config

### Core (luqen)

Start the server:

```bash
npx @luqen/core mcp
```

Claude Desktop / VS Code config:

```json
{
  "mcpServers": {
    "luqen": {
      "command": "npx",
      "args": ["@luqen/core", "mcp"]
    }
  }
}
```

### Compliance (luqen-compliance)

Start the server:

```bash
npx @luqen/compliance mcp
```

Claude Desktop / VS Code config:

```json
{
  "mcpServers": {
    "luqen-compliance": {
      "command": "npx",
      "args": ["@luqen/compliance", "mcp"]
    }
  }
}
```

### Monitor (luqen-monitor)

Start the server:

```bash
npx @luqen/monitor mcp
```

Claude Desktop / VS Code config:

```json
{
  "mcpServers": {
    "luqen-monitor": {
      "command": "npx",
      "args": ["@luqen/monitor", "mcp"]
    }
  }
}
```

---

## Core Tools (6)

### luqen_scan

Scan a website for accessibility issues using pa11y webservice. Discovers URLs via sitemap/crawling, runs concurrent scans, and returns a full JSON report.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | `string` (URL) | Yes | The URL to scan |
| `standard` | `"WCAG2A" \| "WCAG2AA" \| "WCAG2AAA"` | No | WCAG standard to use |
| `concurrency` | `integer` (positive) | No | Number of concurrent scans |
| `maxPages` | `integer` (positive) | No | Maximum number of pages to scan |
| `alsoCrawl` | `boolean` | No | Also crawl the site in addition to sitemap |
| `ignore` | `string[]` | No | Issue codes to ignore |
| `headers` | `Record<string, string>` | No | Additional HTTP headers |
| `wait` | `integer` (>= 0) | No | Milliseconds to wait after page load |

**Example:**

```json
{
  "url": "https://example.com",
  "standard": "WCAG2AA",
  "concurrency": 3,
  "maxPages": 50
}
```

---

### luqen_get_issues

Read and filter issues from a JSON scan report.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `reportPath` | `string` | Yes | Path to the JSON scan report |
| `urlPattern` | `string` | No | Filter pages by URL pattern (substring match) |
| `severity` | `"error" \| "warning" \| "notice"` | No | Filter issues by severity |
| `ruleCode` | `string` | No | Filter issues by rule code |

**Example:**

```json
{
  "reportPath": "./reports/scan-2025-01-15.json",
  "severity": "error",
  "urlPattern": "/contact"
}
```

---

### luqen_propose_fixes

Propose code fixes for accessibility issues found in a scan report.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `reportPath` | `string` | Yes | Path to the JSON scan report |
| `repoPath` | `string` | Yes | Path to the repository source code |

**Example:**

```json
{
  "reportPath": "./reports/scan-2025-01-15.json",
  "repoPath": "/home/user/my-website"
}
```

---

### luqen_apply_fix

Apply a proposed fix to a source file.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `file` | `string` | Yes | Path to the file to modify |
| `line` | `integer` (>= 0) | Yes | Line number of the fix |
| `oldText` | `string` | Yes | The existing text to replace |
| `newText` | `string` | Yes | The new text to insert |

**Example:**

```json
{
  "file": "/home/user/my-website/src/index.html",
  "line": 42,
  "oldText": "<img src=\"logo.png\">",
  "newText": "<img src=\"logo.png\" alt=\"Company logo\">"
}
```

---

### luqen_raw

Run a single-page pa11y scan and return raw pa11y webservice output. Use this for backward compatibility with existing pa11y automations -- the response format matches pa11y-webservice exactly.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `url` | `string` (URL) | Yes | | The URL to test |
| `standard` | `"WCAG2A" \| "WCAG2AA" \| "WCAG2AAA"` | No | `"WCAG2AA"` | WCAG standard |
| `timeout` | `integer` (positive) | No | | Scan timeout in ms |
| `wait` | `integer` (>= 0) | No | | Wait time after page load in ms |
| `ignore` | `string[]` | No | | Issue codes to ignore |
| `hideElements` | `string` | No | | CSS selector for elements to hide |
| `headers` | `Record<string, string>` | No | | HTTP headers sent to the target page |
| `actions` | `string[]` | No | | Pa11y actions to run before testing (e.g. `"click element #tab"`, `"wait for element .loaded"`) |

**Example:**

```json
{
  "url": "https://example.com/page",
  "standard": "WCAG2AA",
  "wait": 2000,
  "actions": ["click element #accept-cookies"]
}
```

---

### luqen_raw_batch

Run pa11y scans on multiple URLs and return raw pa11y results per URL. Backward-compatible output format matching pa11y-webservice.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `urls` | `string[]` (URLs) | Yes | | List of URLs to test |
| `standard` | `"WCAG2A" \| "WCAG2AA" \| "WCAG2AAA"` | No | `"WCAG2AA"` | WCAG standard |
| `concurrency` | `integer` (positive) | No | `5` | Max concurrent scans |
| `timeout` | `integer` (positive) | No | | Scan timeout per page in ms |
| `wait` | `integer` (>= 0) | No | | Wait time after page load in ms |
| `ignore` | `string[]` | No | | Issue codes to ignore |
| `hideElements` | `string` | No | | CSS selector for elements to hide |
| `headers` | `Record<string, string>` | No | | HTTP headers sent to target pages |

**Example:**

```json
{
  "urls": [
    "https://example.com/",
    "https://example.com/about",
    "https://example.com/contact"
  ],
  "standard": "WCAG2AA",
  "concurrency": 3
}
```

---

## Compliance Tools (11)

### compliance_check

Check pa11y accessibility issues against jurisdiction legal requirements.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `jurisdictions` | `string[]` | Yes | List of jurisdiction IDs to check (e.g. `["EU", "US"]`) |
| `issues` | `object[]` | Yes | Pa11y issues to check (each with `code`, `type`, `message`, `selector`, `context`, optional `url`) |
| `includeOptional` | `boolean` | No | Include optional requirements (default: false) |
| `sectors` | `string[]` | No | Filter regulations by sector |

**Issue object shape:**

| Field | Type | Required |
|-------|------|----------|
| `code` | `string` | Yes |
| `type` | `string` | Yes |
| `message` | `string` | Yes |
| `selector` | `string` | Yes |
| `context` | `string` | Yes |
| `url` | `string` | No |

**Example:**

```json
{
  "jurisdictions": ["EU", "US"],
  "issues": [
    {
      "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "type": "error",
      "message": "Img element missing an alt attribute.",
      "selector": "img.hero",
      "context": "<img src=\"hero.jpg\">"
    }
  ],
  "includeOptional": false
}
```

---

### compliance_list_jurisdictions

List all jurisdictions with optional filters.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `type` | `"supranational" \| "country" \| "state"` | No | Filter by jurisdiction type |
| `parentId` | `string` | No | Filter by parent jurisdiction ID |

**Example:**

```json
{ "type": "country" }
```

---

### compliance_list_regulations

List regulations with optional filters.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `jurisdictionId` | `string` | No | Filter by jurisdiction |
| `status` | `"active" \| "draft" \| "repealed"` | No | Filter by status |
| `scope` | `"public" \| "private" \| "all"` | No | Filter by scope |

**Example:**

```json
{ "jurisdictionId": "EU", "status": "active" }
```

---

### compliance_list_requirements

List requirements with optional filters.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `regulationId` | `string` | No | Filter by regulation ID |
| `wcagCriterion` | `string` | No | Filter by WCAG criterion |
| `obligation` | `"mandatory" \| "recommended" \| "optional"` | No | Filter by obligation level |

**Example:**

```json
{ "regulationId": "eu-eaa", "obligation": "mandatory" }
```

---

### compliance_get_regulation

Get a single regulation by ID, including its requirements.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | Yes | Regulation ID (e.g. `"eu-eaa"`) |

**Example:**

```json
{ "id": "eu-eaa" }
```

---

### compliance_propose_update

Submit a proposed change to the compliance rule database.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `source` | `string` | Yes | URL or description of where the change was detected |
| `type` | `"new_regulation" \| "amendment" \| "repeal" \| "new_requirement" \| "new_jurisdiction"` | Yes | Type of change |
| `summary` | `string` | Yes | Human-readable description of the change |
| `proposedChanges` | `object` | Yes | The change details (see below) |
| `affectedRegulationId` | `string` | No | Related regulation ID |
| `affectedJurisdictionId` | `string` | No | Related jurisdiction ID |

**`proposedChanges` object:**

| Field | Type | Required |
|-------|------|----------|
| `action` | `"create" \| "update" \| "delete"` | Yes |
| `entityType` | `"jurisdiction" \| "regulation" \| "requirement"` | Yes |
| `entityId` | `string` | No |
| `before` | `Record<string, unknown>` | No |
| `after` | `Record<string, unknown>` | No |

**Example:**

```json
{
  "source": "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32019L0882",
  "type": "amendment",
  "summary": "Updated enforcement deadline for EAA",
  "proposedChanges": {
    "action": "update",
    "entityType": "regulation",
    "entityId": "eu-eaa",
    "before": { "enforcementDate": "2025-06-28" },
    "after": { "enforcementDate": "2025-06-28" }
  },
  "affectedRegulationId": "eu-eaa"
}
```

---

### compliance_get_pending

List pending update proposals. Takes no parameters.

**Parameters:** None (empty object `{}`).

**Example:**

```json
{}
```

---

### compliance_approve_update

Approve a pending update proposal and apply the proposed changes.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | Yes | Proposal ID to approve |
| `reviewedBy` | `string` | No | Reviewer identifier |

**Example:**

```json
{ "id": "prop-abc123", "reviewedBy": "admin" }
```

---

### compliance_list_sources

List monitored legal sources. Takes no parameters.

**Parameters:** None (empty object `{}`).

**Example:**

```json
{}
```

---

### compliance_add_source

Add a monitored legal source URL.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | `string` | Yes | Display name for the source |
| `url` | `string` | Yes | URL to monitor |
| `type` | `"html" \| "rss" \| "api"` | Yes | Content type of the source |
| `schedule` | `"daily" \| "weekly" \| "monthly"` | Yes | How often to check |

**Example:**

```json
{
  "name": "W3C WAI Policies",
  "url": "https://www.w3.org/WAI/policies/",
  "type": "html",
  "schedule": "weekly"
}
```

---

### compliance_seed

Load the baseline compliance dataset (idempotent). Takes no parameters.

**Parameters:** None (empty object `{}`).

**Example:**

```json
{}
```

---

## Monitor Tools (3)

### monitor_scan_sources

Run a full scan of all monitored legal sources. Fetches each source, computes a SHA-256 hash, and creates UpdateProposals for any sources whose content has changed since the last scan.

**Parameters:** None (empty object `{}`).

**Example:**

```json
{}
```

---

### monitor_status

Show the current monitor status: number of monitored sources, last scan time, and pending proposal count.

**Parameters:** None (empty object `{}`).

**Example:**

```json
{}
```

---

### monitor_add_source

Add a new legal source URL to the compliance service for monitoring.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | `string` | Yes | Human-readable name for the source (e.g. "W3C WAI Policies") |
| `url` | `string` (URL) | Yes | URL to monitor |
| `type` | `"html" \| "rss" \| "api"` | Yes | Content type of the source |
| `schedule` | `"daily" \| "weekly" \| "monthly"` | Yes | How often to check the source |

**Example:**

```json
{
  "name": "EU Web Accessibility Directive updates",
  "url": "https://digital-strategy.ec.europa.eu/en/policies/web-accessibility",
  "type": "html",
  "schedule": "weekly"
}
```
