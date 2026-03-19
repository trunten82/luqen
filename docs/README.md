# Pally Agent — Documentation

Pally Agent is a Node.js/TypeScript tool that orchestrates accessibility testing across entire websites using a [pa11y webservice](https://github.com/pa11y/pa11y-webservice) instance. It discovers all pages (via `sitemap.xml` with crawl fallback), runs pa11y scans through the webservice REST API, aggregates results into JSON and HTML reports, and — when given access to source code — maps issues to specific files and proposes concrete code fixes.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Getting Started](#2-getting-started)
3. [Configuration](#3-configuration)
4. [CLI Reference](#4-cli-reference)
5. [MCP Server](#5-mcp-server)
6. [Page Discovery](#6-page-discovery)
7. [Source Mapping](#7-source-mapping)
8. [Fix Proposals](#8-fix-proposals)
9. [Report Formats](#9-report-formats)
10. [Integration Guide](#10-integration-guide)
11. [Troubleshooting](#11-troubleshooting)
12. [API Reference](#12-api-reference)
13. [Backward Compatibility / Pa11y Passthrough](#13-backward-compatibility--pa11y-passthrough)

---

## 1. Product Overview

### What It Is

Pally Agent bridges the gap between running a single-page accessibility check and getting a complete, actionable accessibility audit of an entire site. It answers three questions:

1. **What pages have issues?** — Site-wide scanning via pa11y webservice.
2. **Where in the code do those issues live?** — Source mapping to your framework's files.
3. **What's the fix?** — Concrete code diffs that can be applied interactively or via an AI agent.

### The Problem It Solves

Running pa11y manually on one page at a time is tedious. The pa11y webservice exposes a REST API for batch scanning, but wiring up discovery, concurrency control, reporting, and fix proposals requires significant glue code. Pally Agent provides that glue as a ready-to-use tool with both a CLI and a Model Context Protocol (MCP) server.

### Key Features

- **Site-wide scanning** — discovers all pages via `sitemap.xml` (with sitemap index recursion), crawl fallback, or both
- **Source mapping** — maps WCAG issues to source files in Next.js, Nuxt, SvelteKit, Angular, and plain HTML projects
- **Auto-fix proposals** — generates unified diffs for common issues (missing `alt`, missing labels, missing `lang`)
- **Dual interfaces** — CLI for humans, MCP server for AI agents (Claude Code and others)
- **Structured reports** — timestamped JSON and self-contained HTML reports
- **CI/CD ready** — meaningful exit codes, JSON output, no interactive prompts in non-fix mode

### Architecture

```
┌─────────────────────────────────────────────┐
│           Interfaces (CLI + MCP)            │
├─────────────────────────────────────────────┤
│              Core Library                   │
│  ┌───────────┬───────────┬────────────────┐ │
│  │ Discovery │ Scanner   │ Reporter       │ │
│  │ (sitemap, │ (pa11y    │ (JSON, HTML,   │ │
│  │  crawl,   │  webservice│ code fixes)   │ │
│  │  robots)  │  client)  │               │ │
│  ├───────────┼───────────┼────────────────┤ │
│  │ Source    │ Config    │ Framework      │ │
│  │ Mapper   │ Manager   │ Detector       │ │
│  └───────────┴───────────┴────────────────┘ │
├─────────────────────────────────────────────┤
│      Pa11y Webservice (configurable URL)    │
└─────────────────────────────────────────────┘
```

**Layers:**

- **Interfaces** — thin wrappers over the core library: CLI via `commander`, MCP via `@modelcontextprotocol/sdk`
- **Core Library** — all business logic in focused modules (discovery, scanner, reporter, source mapper, config manager, framework detector)
- **Pa11y Webservice** — external dependency accessed via REST API at a configurable URL

---

## 2. Getting Started

### Prerequisites

- **Node.js** 18 or later
- A running **pa11y webservice** instance (see [pa11y-webservice](https://github.com/pa11y/pa11y-webservice) for setup)
- The webservice URL — typically `http://localhost:3000` or a remote host

### Installation

```bash
# Clone and install dependencies
git clone <repo-url> pally-agent
cd pally-agent
npm install

# Build TypeScript
npm run build

# Link globally for CLI access
npm link
```

After linking, `pally-agent` is available as a global command.

### Quick Start: Scan a Site in 30 Seconds

```bash
# 1. Set the webservice URL (or put it in .pally-agent.json)
export PALLY_WEBSERVICE_URL=http://localhost:3000

# 2. Scan a site
pally-agent scan https://example.com

# 3. View the report
ls pally-reports/
```

### First Scan Walkthrough

Running `pally-agent scan https://example.com` produces output similar to:

```
Discovering URLs from https://example.com...
Found 12 URLs to scan
[1/12] Scanning https://example.com/
[1/12] Done: https://example.com/
[2/12] Scanning https://example.com/about
[2/12] Done: https://example.com/about
...
[12/12] Done: https://example.com/contact
JSON report written to: ./pally-reports/pally-report-2026-03-18T120000Z.json
```

**What happens under the hood:**

1. Pally Agent fetches `/robots.txt` and `/sitemap.xml` from `example.com`
2. All `<loc>` URLs from the sitemap are collected (crawl fallback if no sitemap)
3. Each URL is sent to the pa11y webservice as a task; results are polled with exponential backoff
4. Results are aggregated into a timestamped JSON report
5. Exit code reflects the outcome: `0` (clean), `1` (issues found), `2` (partial failure), `3` (fatal)

To also generate an HTML report:

```bash
pally-agent scan https://example.com --format both
```

---

## 3. Configuration

### `.pally-agent.json`

Place this file in your project root (or any ancestor directory). All fields are optional and have sensible defaults.

```json
{
  "webserviceUrl": "http://localhost:3000",
  "webserviceHeaders": {},
  "standard": "WCAG2AA",
  "concurrency": 5,
  "timeout": 30000,
  "pollTimeout": 60000,
  "maxPages": 100,
  "crawlDepth": 3,
  "alsoCrawl": false,
  "ignore": [],
  "hideElements": "",
  "headers": {},
  "wait": 0,
  "outputDir": "./pally-reports",
  "sourceMap": {}
}
```

#### Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `webserviceUrl` | `string` | `"http://localhost:3000"` | Base URL of the pa11y webservice instance |
| `webserviceHeaders` | `object` | `{}` | HTTP headers sent with every request **to the webservice** (e.g. for webservice authentication) |
| `standard` | `"WCAG2A" \| "WCAG2AA" \| "WCAG2AAA"` | `"WCAG2AA"` | WCAG conformance level to test against |
| `concurrency` | `number` | `5` | Maximum number of pages scanned in parallel |
| `timeout` | `number` | `30000` | Per-page scan timeout in milliseconds, sent to pa11y webservice |
| `pollTimeout` | `number` | `60000` | Maximum wall-clock time (ms) to wait for a scan result before marking the page as timed out |
| `maxPages` | `number` | `100` | Maximum number of pages to discover and scan (prevents runaway crawls) |
| `crawlDepth` | `number` | `3` | Maximum link-following depth when crawl fallback is active |
| `alsoCrawl` | `boolean` | `false` | When `true`, crawl the site in addition to parsing the sitemap (merges both URL sets) |
| `ignore` | `string[]` | `[]` | WCAG rule codes to exclude from results (e.g. `["WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail"]`) |
| `hideElements` | `string` | `""` | CSS selector for elements pa11y should ignore during testing |
| `headers` | `object` | `{}` | HTTP headers sent by pa11y **to the target website** during scanning (e.g. for staging auth) |
| `wait` | `number` | `0` | Milliseconds to wait after page load before testing — useful for SPAs |
| `outputDir` | `string` | `"./pally-reports"` | Directory where JSON and HTML reports are written |
| `sourceMap` | `object` | `{}` | Manual URL-to-file overrides for source mapping (glob patterns supported) |

### Environment Variables

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `PALLY_WEBSERVICE_URL` | `webserviceUrl` | Base URL of the pa11y webservice |
| `PALLY_WEBSERVICE_AUTH` | `webserviceHeaders.Authorization` | Authorization header value for the webservice |
| `PALLY_AGENT_CONFIG` | Config file path | Absolute path to a `.pally-agent.json` file (equivalent to `--config`) |

### Config File Discovery Rules

When no `--config` flag is given, pally-agent searches for `.pally-agent.json` by:

1. Starting from the **current working directory**
2. Walking up to the filesystem root, checking each directory
3. If `--repo <path>` is specified, also checking the repo root
4. Using the **first file found**

To explicitly specify a config file:

```bash
pally-agent scan https://example.com --config /path/to/my-config.json
```

To use an environment variable for the config path:

```bash
export PALLY_AGENT_CONFIG=/shared/pally-agent.json
pally-agent scan https://example.com
```

### Precedence Order

From highest to lowest priority:

```
CLI flags  >  Environment variables  >  Config file  >  Defaults
```

For example, `--standard WCAG2AAA` on the CLI overrides `"standard": "WCAG2AA"` in the config file, which overrides the default `WCAG2AA`.

### Example Configs

#### Basic — local webservice

```json
{
  "webserviceUrl": "http://localhost:3000",
  "standard": "WCAG2AA",
  "outputDir": "./a11y-reports"
}
```

#### Authenticated — remote webservice + staging site

```json
{
  "webserviceUrl": "https://pa11y.internal.example.com",
  "webserviceHeaders": {
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9..."
  },
  "headers": {
    "Authorization": "Basic c3RhZ2luZzpwYXNz"
  },
  "standard": "WCAG2AA",
  "concurrency": 3
}
```

#### CI/CD — strict, JSON only, limited scope

```json
{
  "webserviceUrl": "http://pa11y-webservice:3000",
  "standard": "WCAG2AA",
  "concurrency": 10,
  "maxPages": 50,
  "outputDir": "./ci-reports",
  "ignore": [
    "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.BgImage"
  ]
}
```

---

## 4. CLI Reference

### `pally-agent scan`

Discover and scan all pages on a site for accessibility issues.

```
pally-agent scan <url> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<url>` | The root URL of the site to scan (required) |

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `--standard <standard>` | `WCAG2A \| WCAG2AA \| WCAG2AAA` | WCAG conformance level (overrides config) |
| `--concurrency <number>` | `number` | Number of parallel scans (overrides config) |
| `--repo <path>` | `string` | Path to source repository — enables source mapping |
| `--output <dir>` | `string` | Output directory for reports (overrides `outputDir` in config) |
| `--format <format>` | `json \| html \| both` | Report format to generate (default: `json`) |
| `--also-crawl` | `boolean` | Crawl the site in addition to the sitemap |
| `--config <path>` | `string` | Explicit path to a `.pally-agent.json` config file |

**Examples:**

```bash
# Basic scan — JSON report only
pally-agent scan https://example.com

# Generate both JSON and HTML reports
pally-agent scan https://example.com --format both

# Stricter standard, custom output directory
pally-agent scan https://example.com --standard WCAG2AAA --output ./reports

# Limit concurrency for slower environments
pally-agent scan https://example.com --concurrency 2

# Scan with source mapping (maps issues to source files)
pally-agent scan https://example.com --repo ./my-next-project

# Supplement sitemap with crawl
pally-agent scan https://example.com --also-crawl

# Use explicit config file
pally-agent scan https://example.com --config ./ci/.pally-agent.json
```

**Output:**

Console output shows real-time progress:
```
Discovering URLs from https://example.com...
Found 8 URLs to scan
[1/8] Scanning https://example.com/
[1/8] Done: https://example.com/
[2/8] Error: https://example.com/slow-page — TIMEOUT
...
JSON report written to: ./pally-reports/pally-report-2026-03-18T120000Z.json
```

### `pally-agent fix`

Propose and interactively apply accessibility fixes. Requires `--repo`.

```
pally-agent fix [url] --repo <path> [options]
pally-agent fix --from-report <path> --repo <path> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `[url]` | Site URL to scan (optional when `--from-report` is used) |

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `--repo <path>` | `string` | Path to source repository **(required)** |
| `--from-report <path>` | `string` | Load issues from an existing JSON report instead of scanning |
| `--standard <standard>` | `WCAG2A \| WCAG2AA \| WCAG2AAA` | WCAG standard (only applies when scanning, not with `--from-report`) |
| `--config <path>` | `string` | Path to a `.pally-agent.json` config file |

**Interactive Fix Flow:**

For each proposed fix, you see:

```
File: app/about/page.tsx (line 24)
Issue: WCAG2AA.Principle1.Guideline1_1.1_1_1.H37
Description: img element missing alt attribute
Confidence: high
Apply fix? [y]es / [n]o / [s]how diff / [a]bort all:
```

| Key | Action |
|-----|--------|
| `y` / `yes` | Apply the fix immediately |
| `n` / `no` | Skip this fix, continue to the next |
| `s` / `show` | Display a unified diff preview, then prompt again |
| `a` / `abort` | Stop processing all remaining fixes |

**`--from-report` usage:**

Use `--from-report` to skip re-scanning when you already have a report:

```bash
# Generate a report
pally-agent scan https://example.com --repo ./my-project

# Fix from that report without re-scanning
pally-agent fix --from-report ./pally-reports/pally-report-2026-03-18T120000Z.json \
  --repo ./my-project
```

The report file must conform to the `ScanReport` schema (see [API Reference](#12-api-reference)).

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All pages scanned successfully with no accessibility issues |
| `1` | Scan completed, but accessibility issues were found on one or more pages |
| `2` | Partial failure — at least one page failed to scan (timeout or HTTP error), but other pages were scanned |
| `3` | Fatal error — webservice unreachable, invalid configuration, unhandled exception |

In CI/CD, check for exit code `0` to assert a fully clean site. Exit code `1` triggers a failing build when issues are found; exit code `2` indicates an infrastructure problem worth investigating separately.

---

## 5. MCP Server

MCP (Model Context Protocol) is a standard protocol that allows AI assistants to call external tools. Pally Agent implements an MCP server so that Claude Code (and other MCP-compatible agents) can scan sites, retrieve issues, and apply fixes as part of an automated workflow — without leaving the AI assistant interface.

### Setup in Claude Code

Add the following to your project's `.claude/settings.json`:

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

Build first:

```bash
cd /root/pally-agent && npm run build
```

After restarting Claude Code, the six MCP tools will be available.

### MCP Tools

#### `pally_scan` — Scan a Website

Discovers all pages on a site and scans them for accessibility issues.

**Input schema:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | `string` | Yes | — | Root URL of the site to scan |
| `standard` | `"WCAG2A" \| "WCAG2AA" \| "WCAG2AAA"` | No | `"WCAG2AA"` | WCAG conformance level |
| `concurrency` | `number` | No | `5` | Parallel scans |
| `maxPages` | `number` | No | `100` | Maximum pages to discover |
| `alsoCrawl` | `boolean` | No | `false` | Also crawl beyond the sitemap |
| `ignore` | `string[]` | No | `[]` | Rule codes to ignore |
| `headers` | `object` | No | `{}` | HTTP headers for the target site |
| `wait` | `number` | No | `0` | Wait time after page load (ms) |

**Output schema:**

```typescript
{
  summary: {
    url: string;
    pagesScanned: number;
    pagesFailed: number;
    totalIssues: number;
    byLevel: { error: number; warning: number; notice: number };
  };
  pages: PageResult[];     // Full per-page results
  errors: ScanError[];     // Pages that failed to scan
  reportPath: string;      // Absolute path to the generated JSON report
}
```

**Example:**

```json
// Input
{ "url": "https://example.com", "standard": "WCAG2AA", "alsoCrawl": true }

// Output
{
  "summary": {
    "url": "https://example.com",
    "pagesScanned": 12,
    "pagesFailed": 0,
    "totalIssues": 7,
    "byLevel": { "error": 3, "warning": 4, "notice": 0 }
  },
  "pages": [...],
  "errors": [],
  "reportPath": "/home/user/project/pally-reports/pally-report-2026-03-18T120000Z.json"
}
```

---

#### `pally_get_issues` — Filter Issues from a Report

Reads a previously generated JSON report and returns issues matching the specified filters.

**Input schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reportPath` | `string` | Yes | Absolute or relative path to a JSON report |
| `urlPattern` | `string` | No | Glob pattern to filter by page URL (e.g. `**/blog/**`) |
| `severity` | `"error" \| "warning" \| "notice"` | No | Filter by issue severity |
| `ruleCode` | `string` | No | Filter by WCAG rule code (exact match) |

**Output:** Filtered array of `PageResult` objects (see [API Reference](#12-api-reference)).

**Examples:**

```json
// Only errors
{ "reportPath": "./pally-reports/report.json", "severity": "error" }

// Specific rule on blog pages
{
  "reportPath": "./pally-reports/report.json",
  "urlPattern": "**/blog/**",
  "ruleCode": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37"
}
```

---

#### `pally_propose_fixes` — Generate Fix Proposals

Reads a JSON report, maps issues to source files in the given repository, and returns structured fix proposals.

**Input schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reportPath` | `string` | Yes | Path to a JSON scan report |
| `repoPath` | `string` | Yes | Absolute path to the source code repository |

**Output schema:**

```typescript
{
  fixable: number;          // Number of issues with auto-generated fixes
  unfixable: number;        // Number of issues requiring human judgment
  fixes: Array<{
    file: string;           // Absolute file path
    line: number;           // Line number of the issue
    issue: string;          // WCAG rule code
    description: string;    // Human-readable description
    oldText: string;        // Current text to be replaced
    newText: string;        // Replacement text
    confidence: "high" | "low";
  }>;
}
```

**Example:**

```json
// Input
{
  "reportPath": "./pally-reports/report.json",
  "repoPath": "/home/user/my-next-app"
}

// Output
{
  "fixable": 5,
  "unfixable": 2,
  "fixes": [
    {
      "file": "/home/user/my-next-app/app/about/page.tsx",
      "line": 24,
      "issue": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "description": "img element missing alt attribute",
      "oldText": "<img src=\"/hero.jpg\">",
      "newText": "<img alt=\"\" src=\"/hero.jpg\">",
      "confidence": "high"
    }
  ]
}
```

---

#### `pally_apply_fix` — Apply a Single Fix

Applies one fix proposal to the source file. The calling agent must confirm with the user before invoking this tool — the MCP server does not prompt for confirmation itself.

**Input schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | `string` | Yes | Absolute path to the source file |
| `line` | `number` | Yes | Line number of the change |
| `oldText` | `string` | Yes | Exact text to replace |
| `newText` | `string` | Yes | Replacement text |

**Output schema:**

```typescript
{
  applied: boolean;   // true if the replacement succeeded
  file: string;       // File path that was modified
  diff: string;       // Unified diff of the change
}
```

**Example:**

```json
// Input
{
  "file": "/home/user/my-next-app/app/about/page.tsx",
  "line": 24,
  "oldText": "<img src=\"/hero.jpg\">",
  "newText": "<img alt=\"\" src=\"/hero.jpg\">"
}

// Output
{
  "applied": true,
  "file": "/home/user/my-next-app/app/about/page.tsx",
  "diff": "--- a/app/about/page.tsx\n+++ b/app/about/page.tsx\n@@ -23,7 +23,7 @@\n ..."
}
```

---

#### `pally_raw` — Single-Page Pa11y Passthrough

Runs a pa11y scan on a single URL and returns the raw pa11y-webservice output format — identical to what pa11y-webservice natively returns. Designed for backward compatibility with existing automations that already consume pa11y-webservice output directly.

**Input schema:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | `string` | Yes | — | URL to scan |
| `standard` | `"WCAG2A" \| "WCAG2AA" \| "WCAG2AAA"` | No | `"WCAG2AA"` | WCAG conformance level |
| `timeout` | `number` | No | `30000` | Per-page scan timeout in milliseconds |
| `wait` | `number` | No | `0` | Milliseconds to wait after page load before testing |
| `ignore` | `string[]` | No | `[]` | WCAG rule codes to exclude from results |
| `hideElements` | `string` | No | `""` | CSS selector for elements pa11y should ignore |
| `headers` | `object` | No | `{}` | HTTP headers sent by pa11y to the target page |
| `actions` | `string[]` | No | `[]` | Pa11y actions to run before testing (e.g. `"click element #tab"`) |

**Output schema:**

Raw pa11y result object — the same structure pa11y-webservice returns natively:

```typescript
{
  date: string;        // ISO 8601 timestamp of the scan
  issues: Array<{
    code: string;      // WCAG rule code
    type: string;      // "error", "warning", or "notice"
    message: string;   // Human-readable description
    selector: string;  // CSS selector of the offending element
    context: string;   // HTML snippet surrounding the issue
  }>;
}
```

**Example:**

```json
// Input
{ "url": "https://example.com/page", "standard": "WCAG2AA" }

// Output
{
  "date": "2026-03-19T10:00:00.000Z",
  "issues": [
    {
      "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "type": "error",
      "message": "Img element missing an alt attribute.",
      "selector": "html > body > main > img",
      "context": "<img src=\"/hero.jpg\">"
    }
  ]
}
```

---

#### `pally_raw_batch` — Multi-Page Pa11y Passthrough

Runs pa11y on multiple URLs with concurrency control and returns raw pa11y output per URL. Uses the same backward-compatible format as `pally_raw`.

**Input schema:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `urls` | `string[]` | Yes | — | Array of URLs to scan |
| `standard` | `"WCAG2A" \| "WCAG2AA" \| "WCAG2AAA"` | No | `"WCAG2AA"` | WCAG conformance level |
| `concurrency` | `number` | No | `5` | Maximum number of pages scanned in parallel |
| `timeout` | `number` | No | `30000` | Per-page scan timeout in milliseconds |
| `wait` | `number` | No | `0` | Milliseconds to wait after page load before testing |
| `ignore` | `string[]` | No | `[]` | WCAG rule codes to exclude from results |
| `hideElements` | `string` | No | `""` | CSS selector for elements pa11y should ignore |
| `headers` | `object` | No | `{}` | HTTP headers sent by pa11y to the target pages |

**Output schema:**

Array of per-URL result objects:

```typescript
Array<{
  url: string;         // The URL that was scanned
  result?: {           // Present when the scan succeeded
    date: string;
    issues: Array<{
      code: string;
      type: string;
      message: string;
      selector: string;
      context: string;
    }>;
  };
  error?: string;      // Present when the scan failed (timeout, HTTP error, etc.)
}>
```

**Example:**

```json
// Input
{ "urls": ["https://example.com/", "https://example.com/about"], "concurrency": 5 }

// Output
[
  {
    "url": "https://example.com/",
    "result": {
      "date": "2026-03-19T10:00:00.000Z",
      "issues": []
    }
  },
  {
    "url": "https://example.com/about",
    "result": {
      "date": "2026-03-19T10:00:01.000Z",
      "issues": [
        {
          "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
          "type": "error",
          "message": "Img element missing an alt attribute.",
          "selector": "html > body > main > img",
          "context": "<img src=\"/team.jpg\">"
        }
      ]
    }
  }
]
```

---

### Example Conversation Flows

#### Basic scan and review

```
User: Check example.com for accessibility issues.

Claude: [calls pally_scan with url="https://example.com"]
        Found 7 issues across 12 pages: 3 errors, 4 warnings.
        The most critical issues are on /about (missing alt text) and /contact (unlabelled inputs).

User: Fix the errors on /about.

Claude: [calls pally_propose_fixes with repoPath="/path/to/repo"]
        I found 2 fixable issues in app/about/page.tsx.

        Fix 1: Add alt="" to the hero image at line 24.
        Old: <img src="/hero.jpg">
        New: <img alt="" src="/hero.jpg">

        Shall I apply this fix?

User: Yes.

Claude: [calls pally_apply_fix]
        Applied. The file has been updated.
```

#### CI-style scan (agent-driven, no user interaction)

```
Claude: [calls pally_scan with url="https://staging.example.com"]
        [calls pally_get_issues with severity="error"]
        [calls pally_propose_fixes]
        [calls pally_apply_fix for each fix after summarising all changes to the user]
        [calls pally_scan again to verify]
```

---

## 6. Page Discovery

Pally Agent discovers URLs in three ordered steps.

### Step 1: Robots.txt Parsing

Before anything else, pally-agent fetches `/robots.txt` from the target site:

- Extracts `Disallow` rules for `*` (all agents)
- Extracts `Sitemap` directives (some sites declare the sitemap location in robots.txt)
- Stores disallow rules to filter URLs throughout discovery and scanning

### Step 2: Sitemap Resolution

Pally-agent tries to locate the sitemap using:

1. The `Sitemap:` directive from `robots.txt` (if found)
2. Fall back to `/sitemap.xml`

**Sitemap index recursion:** If the sitemap is a `<sitemapindex>` file, pally-agent recursively fetches all `<sitemap>` entries and collects URLs from all nested sitemaps. There is no depth limit on sitemap index recursion.

**URL extraction:** All `<loc>` entries in `<urlset>` documents are extracted. URLs matching robots.txt `Disallow` rules are filtered out.

### Step 3: Crawl Fallback

The crawler activates when:

- No `sitemap.xml` is found, **or**
- `--also-crawl` flag is set (or `alsoCrawl: true` in config) to supplement a partial sitemap

**BFS algorithm:**

1. Start from the root URL
2. Fetch the page HTML, extract all `<a href>` links via `cheerio`
3. Keep only same-domain links; skip fragments (`#`), non-HTML resources (`.pdf`, `.jpg`, etc.)
4. Respect robots.txt disallow rules
5. Add newly discovered URLs to the BFS queue
6. Continue until the queue is empty, or `crawlDepth` or `maxPages` is reached

**Default limits:**

| Limit | Default | Config field |
|-------|---------|-------------|
| Max depth | 3 | `crawlDepth` |
| Max pages | 100 | `maxPages` |

### `--also-crawl` for Partial Sitemaps

Some sites have sitemaps that only list a subset of pages (e.g. only blog posts). Use `--also-crawl` to merge sitemap URLs with crawled URLs:

```bash
pally-agent scan https://example.com --also-crawl
```

Or in config:

```json
{ "alsoCrawl": true }
```

Duplicate URLs are deduplicated. Each discovered URL is tagged with its discovery method (`sitemap` or `crawl`) in the report.

---

## 7. Source Mapping

When `--repo <path>` is provided, pally-agent maps each accessibility issue to a source file in the repository. Source mapping is **best-effort** — JSX composition, CSS modules, and server-side rendering can all produce HTML that differs structurally from the source.

### Supported Frameworks

| Framework | Detection markers |
|-----------|------------------|
| Next.js (App Router) | `app/` directory + `next.config.*` |
| Next.js (Pages Router) | `pages/` directory + `next.config.*` |
| Nuxt | `nuxt.config.*` |
| SvelteKit | `svelte.config.*` + `src/routes/` |
| Angular | `angular.json` |
| Plain HTML | `index.html` in root |
| Vite-based | `vite.config.*` (delegates to plugin-specific strategy) |

### How Framework Detection Works

1. Scan the repository root for framework configuration files (e.g. `next.config.ts`, `angular.json`)
2. Check `package.json` dependencies as a secondary signal
3. Each detected framework gets a routing strategy that knows how to convert a URL path to a source file path

### URL-to-File Mapping Examples

| Framework | URL | Maps to |
|-----------|-----|---------|
| Next.js App Router | `/about` | `app/about/page.tsx` |
| Next.js App Router | `/blog/my-post` | `app/blog/[slug]/page.tsx` |
| Next.js Pages Router | `/about` | `pages/about.tsx` |
| Next.js Pages Router | `/blog/my-post` | `pages/blog/[slug].tsx` |
| Nuxt | `/about` | `pages/about.vue` |
| Nuxt | `/blog/my-post` | `pages/blog/[slug].vue` |
| SvelteKit | `/about` | `src/routes/about/+page.svelte` |
| SvelteKit | `/blog/my-post` | `src/routes/blog/[slug]/+page.svelte` |
| Angular | `/about` | detected via `angular.json` routes config |
| Plain HTML | `/about` | `about.html` or `about/index.html` |

### Dynamic Segments

| Pattern | Matches |
|---------|---------|
| `[param]` | Single URL segment (e.g. `[slug]` matches `/my-post`) |
| `[...slug]` | Catch-all (e.g. `[...slug]` matches `/a/b/c`) |

**Route groups** in Next.js (e.g. `(marketing)/about/page.tsx`) are traversed transparently — the `(marketing)` segment is not part of the URL.

**Out of scope:** Parallel routes, intercepting routes, and other advanced routing patterns. Use `sourceMap` overrides for these.

### User Overrides

Override or supplement auto-detection in `.pally-agent.json`:

```json
{
  "sourceMap": {
    "/docs/*": "src/templates/docs.tsx",
    "/blog/*": "src/templates/blog-post.tsx",
    "/": "app/page.tsx"
  }
}
```

User overrides take precedence over auto-detected mappings. Glob patterns (`*`, `**`) are supported.

### Confidence Levels

| Level | Meaning |
|-------|---------|
| `high` | Unique element match found in the source file — line number is reliable |
| `low` | Multiple candidates matched, or heuristic match — file is correct, line number may not be |
| `none` | Source file identified, but the specific element could not be located within it |

When confidence is `low` or `none`, the report includes the file path with a note about the uncertainty. Fix proposals are only generated when a source file is identified (any confidence level).

### Limitations

- JSX composition: an issue in a shared `<Button>` component shows up on every page that renders it; the mapper points to where the component is rendered, not the component definition
- CSS modules and styled-components may produce class names that don't match the source
- Server-rendered HTML may differ structurally from JSX (e.g. conditionally rendered elements)
- This feature is explicitly best-effort and is clearly marked as such in reports

---

## 8. Fix Proposals

### Auto-Fixable Patterns

| Issue | WCAG Rule (example) | Fix Applied |
|-------|---------------------|-------------|
| `<img>` missing `alt` attribute | `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37` | Adds `alt=""` (decorative) — user should add descriptive text |
| `<input>` missing label | `WCAG2AA.Principle1.Guideline1_3.1_3_1.F68` | Adds `aria-label` attribute |
| `<html>` missing `lang` | `WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2` | Adds `lang="en"` |
| Empty link text | `WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.A.NoContent` | Flagged for human review |
| Missing heading hierarchy | `WCAG2AA.Principle1.Guideline1_3.1_3_1` | Flagged with recommendation |

Issues marked "flagged for human review" appear in the `unfixable` count and are listed in the report with a `fixSuggestion` text description but no code diff.

### How Fixes Are Proposed

1. **Scan** — run or load a scan report
2. **Map** — use source mapping to identify the source file for each issue
3. **Match** — search the source file for the offending element using the CSS selector and context snippet from pa11y
4. **Diff** — generate an `oldText` / `newText` pair representing the minimal change needed

Fix proposals are returned as structured data. They are never applied without explicit user consent.

### Interactive CLI Fix Flow

The `pally-agent fix` command presents each proposed fix one at a time:

```
File: app/about/page.tsx (line 24)
Issue: WCAG2AA.Principle1.Guideline1_1.1_1_1.H37
Description: img element missing alt attribute
Confidence: high
Apply fix? [y]es / [n]o / [s]how diff / [a]bort all:
```

- **`y`** — applies the fix immediately, moves to the next
- **`n`** — skips this file, moves to the next
- **`s`** — prints a unified diff, then repeats the prompt
- **`a`** — aborts all remaining fixes (already-applied fixes are not rolled back)

Individual issue selection within a file is not supported in v1 — all fixes for a file are applied together.

### MCP Fix Flow

In MCP mode, fix proposals and application are separate steps:

1. Call `pally_propose_fixes` to get all proposed fixes as structured data
2. Present fixes to the user (the calling agent's responsibility)
3. For each approved fix, call `pally_apply_fix`

The MCP server never prompts for confirmation — that responsibility lies with the calling agent.

### What Requires Human Judgment

These issue types are flagged but not auto-fixed:

- **Empty link text** — the correct link text depends on context and purpose
- **Missing heading hierarchy** — restructuring headings may affect page design
- **Colour contrast** — requires design decisions, not just code changes
- **Keyboard navigation** — often requires JavaScript changes or structural rework
- **ARIA roles** — incorrect ARIA usage may need architectural fixes

---

## 9. Report Formats

### JSON Report Structure

Reports are written to `outputDir` with timestamped filenames (e.g. `pally-report-2026-03-18T120000Z.json`).

**Full schema:**

```typescript
{
  // Top-level summary
  summary: {
    url: string;              // Root URL that was scanned
    pagesScanned: number;     // Pages that completed scanning
    pagesFailed: number;      // Pages that errored
    totalIssues: number;      // Total accessibility issues found
    byLevel: {
      error: number;          // WCAG errors
      warning: number;        // WCAG warnings
      notice: number;         // Informational notices
    };
  };

  // Per-page results
  pages: Array<{
    url: string;                          // Page URL
    discoveryMethod: "sitemap" | "crawl"; // How this page was found
    issueCount: number;                   // Number of issues on this page
    issues: Array<{
      code: string;           // WCAG rule code (e.g. "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37")
      type: "error" | "warning" | "notice";
      message: string;        // Human-readable description
      selector: string;       // CSS selector of the offending element
      context: string;        // HTML snippet surrounding the issue
      fixSuggestion?: string; // Textual recommendation (always present)
    }>;
    sourceMap?: {             // Present when --repo was used
      file: string;           // Source file path
      line?: number;          // Line number (when confidence is high)
      component?: string;     // Component name if detectable
      confidence: "high" | "low" | "none";
    };
    error?: {                 // Present only for failed pages
      url: string;
      code: "TIMEOUT" | "WEBSERVICE_ERROR" | "HTTP_ERROR" | "UNKNOWN";
      message: string;
      retried: boolean;
    };
  }>;

  // Pages that failed to scan
  errors: Array<{
    url: string;
    code: "TIMEOUT" | "WEBSERVICE_ERROR" | "HTTP_ERROR" | "UNKNOWN";
    message: string;
    retried: boolean;
  }>;

  // Path to this report file
  reportPath: string;
}
```

### HTML Report Features

HTML reports (`pally-report-*.html`) are:

- **Self-contained** — a single file with all CSS inlined; no external dependencies, safe to email or archive
- **Filterable** — filter issues by severity (error / warning / notice), page URL, and rule code
- **Collapsible** — each page section is collapsible; summary statistics are always visible
- **Colour-coded** — errors in red, warnings in yellow, notices in blue

### Output Directory and Naming

Reports are written to `outputDir` (default: `./pally-reports`). The directory is created if it does not exist.

File naming:

```
pally-report-<ISO8601-timestamp>.json
pally-report-<ISO8601-timestamp>.html
```

Example: `pally-report-2026-03-18T120000Z.json`

**No-overwrite guarantee:** If a file with the same timestamp already exists (e.g. from a concurrent process), pally-agent appends a counter suffix rather than overwriting.

---

## 10. Integration Guide

### CI/CD Integration

Use exit codes to drive your pipeline:

```yaml
# GitHub Actions example
- name: Run accessibility scan
  run: pally-agent scan ${{ env.SITE_URL }} --format json
  env:
    PALLY_WEBSERVICE_URL: http://pa11y-webservice:3000
  # Exit 1 = issues found (fail the build)
  # Exit 2 = some pages failed (fail the build, investigate infrastructure)
  # Exit 3 = fatal (misconfiguration)
```

For JSON output in CI:

```bash
pally-agent scan https://staging.example.com --format json --output ./ci-reports
# Parse the report for issue counts
cat ci-reports/pally-report-*.json | jq '.summary.byLevel'
```

To allow warnings but fail on errors only, parse the JSON report in a post-step:

```bash
ERRORS=$(cat ci-reports/pally-report-*.json | jq '.summary.byLevel.error')
if [ "$ERRORS" -gt "0" ]; then exit 1; fi
```

### Claude Code Integration

Two complementary ways to use pally-agent in Claude Code:

**1. MCP Server** (automated, agent-driven):

Add to `.claude/settings.json` as shown in [Section 5](#5-mcp-server). Claude can then scan sites, propose fixes, and apply them in a conversation.

**2. Claude Code Skill** (triggered by user intent):

The skill at `.claude/skills/pally-agent/SKILL.md` activates automatically when you ask about accessibility, WCAG, or pa11y. It provides Claude with the right tool invocation patterns.

**Recommended workflow in Claude Code:**

1. Ask Claude to scan your site: *"Check example.com for accessibility issues"*
2. Claude calls `pally_scan` and summarises the results
3. Ask to fix errors: *"Fix the accessibility errors on the about page"*
4. Claude calls `pally_propose_fixes`, shows you the diffs, and applies approved fixes via `pally_apply_fix`
5. Ask Claude to verify: *"Re-scan to check the fixes worked"*

### Using with Other AI Agents

Pally Agent implements the MCP protocol, so any MCP-compatible agent can use it:

```json
{
  "mcpServers": {
    "pally-agent": {
      "command": "node",
      "args": ["/path/to/pally-agent/dist/mcp.js"],
      "env": {
        "PALLY_WEBSERVICE_URL": "http://localhost:3000"
      }
    }
  }
}
```

The six tools (`pally_scan`, `pally_get_issues`, `pally_propose_fixes`, `pally_apply_fix`, `pally_raw`, `pally_raw_batch`) follow the MCP tool calling convention and return structured JSON.

### Webhook / Notification Patterns

Pally-agent does not have built-in webhook support, but you can pipe reports to external systems post-scan:

```bash
# Scan and post summary to Slack
pally-agent scan https://example.com --format json --output /tmp/reports
ISSUES=$(cat /tmp/reports/pally-report-*.json | jq '.summary.totalIssues')
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-type: application/json' \
  --data "{\"text\": \"Accessibility scan found $ISSUES issues\"}"
```

---

## 11. Troubleshooting

### Webservice Connection Issues

**Error:** `Fatal error: connect ECONNREFUSED 127.0.0.1:3000`

The pa11y webservice is not running or is not accessible at the configured URL.

**Solutions:**
1. Verify the webservice is running: `curl http://localhost:3000/tasks`
2. Check `PALLY_WEBSERVICE_URL` or `webserviceUrl` in your config
3. If the webservice is on a different host, ensure network connectivity
4. If authentication is required, set `PALLY_WEBSERVICE_AUTH` or `webserviceHeaders.Authorization`

---

**Error:** `Fatal error: Request failed with status 401`

The webservice requires authentication.

**Solution:** Set the authorization header:

```bash
export PALLY_WEBSERVICE_AUTH="Bearer your-token-here"
```

Or in config:

```json
{
  "webserviceHeaders": { "Authorization": "Bearer your-token-here" }
}
```

---

### Scan Timeouts

**Error:** Pages appearing in the report with `code: "TIMEOUT"`

Pa11y did not return results within the `pollTimeout` window.

**Solutions:**
1. Increase `pollTimeout` in config (default: 60000ms): `"pollTimeout": 120000`
2. Increase `timeout` (the pa11y per-page timeout): `"timeout": 60000`
3. For SPAs, add a `wait` value: `"wait": 2000`
4. Check that the target site is accessible from the webservice host
5. Reduce `concurrency` to lower load on the webservice: `"concurrency": 2`

---

### Source Mapping Mismatches

**Symptom:** Issues are mapped to wrong files, or `confidence: "none"` on all pages.

**Solutions:**
1. Ensure `--repo` points to the project root (not a subdirectory)
2. For monorepos, point `--repo` to the specific app directory
3. Add manual overrides in `.pally-agent.json`:
   ```json
   { "sourceMap": { "/my-special-route/*": "src/pages/special.tsx" } }
   ```
4. Check that the framework is detected: look for the expected config file (`next.config.ts`, `svelte.config.js`, etc.) in the repo root
5. For advanced routing patterns (parallel routes, intercepting routes), manual `sourceMap` overrides are required

---

### Config Not Found

**Symptom:** The webservice URL reverts to `http://localhost:3000` even though you have a config file.

**Solutions:**
1. Ensure the file is named exactly `.pally-agent.json` (note the leading dot)
2. Run the scan from a directory at or below where the config file lives
3. Use `--config <path>` to specify the config file explicitly
4. Set `PALLY_AGENT_CONFIG=/path/to/.pally-agent.json` as an environment variable

---

### No Pages Discovered

**Symptom:** `Found 0 URLs to scan`

**Solutions:**
1. Verify the sitemap exists: `curl https://example.com/sitemap.xml`
2. If the sitemap uses a custom URL, check `robots.txt` for a `Sitemap:` directive
3. Add `--also-crawl` to fall back to link crawling even with a sitemap
4. Check that the base URL is correct (with or without trailing slash)
5. If robots.txt aggressively disallows paths, check which URLs are being filtered

---

### HTML Report Is Empty / Shows No Issues

**Symptom:** The HTML report loads but shows 0 issues even though JSON shows issues.

This is typically a browser issue with self-contained HTML files and is not a pally-agent bug. Try opening the report from a local HTTP server rather than directly from the filesystem.

---

## 12. API Reference

All TypeScript interfaces are defined in `src/types.ts`.

### `PallyConfig`

The complete configuration object. All fields are readonly.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `webserviceUrl` | `string` | `"http://localhost:3000"` | Pa11y webservice base URL |
| `webserviceHeaders` | `Record<string, string>` | `{}` | Headers for every webservice API request |
| `standard` | `"WCAG2A" \| "WCAG2AA" \| "WCAG2AAA"` | `"WCAG2AA"` | WCAG conformance level |
| `concurrency` | `number` | `5` | Max parallel scans |
| `timeout` | `number` | `30000` | Per-page scan timeout (ms) sent to pa11y |
| `pollTimeout` | `number` | `60000` | Max wait time for scan results (ms) |
| `maxPages` | `number` | `100` | Maximum pages to discover |
| `crawlDepth` | `number` | `3` | Max crawl depth when crawling |
| `alsoCrawl` | `boolean` | `false` | Crawl in addition to sitemap |
| `ignore` | `string[]` | `[]` | Rule codes to exclude |
| `hideElements` | `string` | `""` | CSS selector for elements to exclude |
| `headers` | `Record<string, string>` | `{}` | Headers sent by pa11y to the target site |
| `wait` | `number` | `0` | Wait time before testing (ms) |
| `outputDir` | `string` | `"./pally-reports"` | Report output directory |
| `sourceMap` | `Record<string, string>` | `{}` | URL-to-file overrides (glob patterns) |

---

### `ScanReport`

Returned by `pally_scan` and written to the JSON report file.

| Field | Type | Description |
|-------|------|-------------|
| `summary` | `ScanSummary` | Aggregate statistics |
| `pages` | `PageResult[]` | Per-page results |
| `errors` | `ScanError[]` | Pages that failed to scan |
| `reportPath` | `string` | Absolute path to the JSON report file |

---

### `ScanSummary`

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Root URL that was scanned |
| `pagesScanned` | `number` | Number of pages that completed scanning |
| `pagesFailed` | `number` | Number of pages that errored |
| `totalIssues` | `number` | Total accessibility issues across all pages |
| `byLevel.error` | `number` | Count of error-level issues |
| `byLevel.warning` | `number` | Count of warning-level issues |
| `byLevel.notice` | `number` | Count of notice-level issues |

---

### `PageResult`

One entry per discovered URL.

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Page URL |
| `discoveryMethod` | `"sitemap" \| "crawl"` | How this URL was discovered |
| `issueCount` | `number` | Number of accessibility issues |
| `issues` | `AccessibilityIssue[]` | List of issues found on this page |
| `sourceMap` | `SourceMapping \| undefined` | Source mapping result (when `--repo` used) |
| `error` | `ScanError \| undefined` | Error details for failed pages |

---

### `AccessibilityIssue`

One accessibility issue as reported by pa11y.

| Field | Type | Description |
|-------|------|-------------|
| `code` | `string` | WCAG rule code (e.g. `"WCAG2AA.Principle1.Guideline1_1.1_1_1.H37"`) |
| `type` | `"error" \| "warning" \| "notice"` | Issue severity |
| `message` | `string` | Human-readable description |
| `selector` | `string` | CSS selector of the offending element |
| `context` | `string` | HTML snippet surrounding the issue |
| `fixSuggestion` | `string \| undefined` | Textual recommendation |

---

### `SourceMapping`

Source code location for a page, when `--repo` is used.

| Field | Type | Description |
|-------|------|-------------|
| `file` | `string` | Path to the source file |
| `line` | `number \| undefined` | Line number (present when confidence is high) |
| `component` | `string \| undefined` | Component name if identifiable |
| `confidence` | `"high" \| "low" \| "none"` | Reliability of the mapping |

---

### `ScanError`

Describes a page that failed to scan.

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | Page URL that failed |
| `code` | `"TIMEOUT" \| "WEBSERVICE_ERROR" \| "HTTP_ERROR" \| "UNKNOWN"` | Error category |
| `message` | `string` | Human-readable error description |
| `retried` | `boolean` | Whether the scan was retried before failing |

---

### `FixProposal`

A proposed code change to fix an accessibility issue.

| Field | Type | Description |
|-------|------|-------------|
| `file` | `string` | Absolute path to the source file |
| `line` | `number` | Line number of the change |
| `issue` | `string` | WCAG rule code |
| `description` | `string` | Human-readable description of the fix |
| `oldText` | `string` | Text to be replaced |
| `newText` | `string` | Replacement text |
| `confidence` | `"high" \| "low"` | Reliability of the fix proposal |

---

### `FixResult`

Result of applying a `FixProposal` via `pally_apply_fix`.

| Field | Type | Description |
|-------|------|-------------|
| `applied` | `boolean` | `true` if the replacement succeeded |
| `file` | `string` | File path that was modified |
| `diff` | `string` | Unified diff of the change |

---

### `ScanProgress`

Emitted during scanning for progress tracking. CLI displays these as console log lines; MCP emits them as `notifications/progress` messages.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"scan:start" \| "scan:complete" \| "scan:error" \| "scan:progress"` | Event type |
| `url` | `string` | URL being scanned |
| `current` | `number` | 1-indexed position in the scan queue |
| `total` | `number` | Total number of URLs to scan |
| `timestamp` | `string` | ISO 8601 timestamp |
| `error` | `string \| undefined` | Error message (only on `scan:error`) |

---

### `DiscoveredUrl`

A URL returned by the discovery phase.

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | The discovered URL |
| `discoveryMethod` | `"sitemap" \| "crawl"` | How it was found |

---

## 13. Backward Compatibility / Pa11y Passthrough

### Purpose

`pally_raw` and `pally_raw_batch` exist for teams that already have automations built on top of [pa11y-webservice](https://github.com/pa11y/pa11y-webservice) and want to call those automations through an MCP interface without migrating to the enriched `pally_scan` output format.

### Output Format

The output of both tools is **identical to the native pa11y-webservice response format**. If your code already processes pa11y-webservice results, it will work with `pally_raw` and `pally_raw_batch` without any changes.

Each issue object contains exactly the fields pa11y-webservice returns:

| Field | Description |
|-------|-------------|
| `code` | WCAG rule code |
| `type` | `"error"`, `"warning"`, or `"notice"` |
| `message` | Human-readable description |
| `selector` | CSS selector of the offending element |
| `context` | HTML snippet surrounding the issue |

### When to Use Each Tool

| Tool | Use case |
|------|----------|
| `pally_raw` | Single-page scan with pa11y-webservice-compatible output |
| `pally_raw_batch` | Multiple pages, same format, with concurrency control |
| `pally_scan` | Full site scan with discovery, source mapping, and enriched output |

### Contrast with `pally_scan`

`pally_scan` adds capabilities on top of the raw pa11y output:

- **Page discovery** — automatically finds all pages via sitemap and/or crawl
- **Source mapping** — maps issues to source files in your framework's codebase
- **Enriched output** — adds `discoveryMethod`, `issueCount`, source mapping results, and structured error details
- **Structured reports** — writes timestamped JSON and HTML report files to disk

Use `pally_raw` / `pally_raw_batch` when you need the raw pa11y data format and handle the rest yourself. Use `pally_scan` when you want Pally Agent to handle discovery, source mapping, and reporting for you.

### Migration Path

If you are building new integrations, prefer `pally_scan` for its richer output. The passthrough tools are provided for backward compatibility and will be maintained alongside `pally_scan`.

---

*Pally Agent v0.1.0 — MIT License*
