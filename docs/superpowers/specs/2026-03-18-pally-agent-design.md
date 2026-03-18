# Pally Agent — Design Specification

## Overview

Pally Agent is a Node.js/TypeScript tool that orchestrates accessibility testing across entire websites using a pa11y webservice instance. It discovers all pages via sitemap.xml (with crawl fallback), runs pa11y scans via the webservice REST API, aggregates results into JSON and HTML reports, and when given access to source code, maps issues to specific files and proposes code fixes.

It exposes two interfaces over a shared core library: a CLI and an MCP server.

## Architecture

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

### Layers

- **Interfaces** — thin wrappers (CLI via `commander`, MCP via `@modelcontextprotocol/sdk`) over the core library
- **Core Library** — all business logic, composed of focused modules
- **Pa11y Webservice** — external dependency, accessed via REST API at a configurable URL

## Page Discovery

Discovery runs in three ordered steps:

### 1. Robots.txt Parsing

- Fetch `/robots.txt` from the target site
- Extract `Disallow` rules for the agent's user-agent and `*`
- Extract `Sitemap` directives (sites may declare sitemap location here)
- Store rules to filter disallowed paths from scan results

### 2. Sitemap Resolution

- Try sitemap URL from robots.txt first, fall back to `/sitemap.xml`
- Handle `<sitemapindex>` files recursively — follow nested `<sitemap>` entries
- Parse `<urlset>` entries, extract `<loc>` URLs
- Filter out URLs matching robots.txt disallow rules
- Optionally filter by `<lastmod>` for incremental scans

### 3. Crawl Fallback

Activated when no sitemap is found. Can also be triggered alongside a sitemap via `--also-crawl` flag (CLI) or `alsoCrawl: true` (config) to discover pages not listed in the sitemap.

- Start from the root URL, follow same-domain `<a href>` links via BFS
- Configurable depth limit (default: 3)
- Respect robots.txt rules during crawl
- Deduplicate URLs, skip fragments/anchors, skip non-HTML resources
- Configurable max page count (default: 100) to prevent runaway crawls

**Output:** A deduplicated list of URLs, each tagged with discovery method (sitemap vs crawl).

## Scanning

The scanner orchestrates interactions with the pa11y webservice REST API.

### Pa11y Webservice API Contract

Reference: [pa11y-webservice endpoints](https://github.com/pa11y/pa11y-webservice/wiki/Web-Service-Endpoints)

Key API behaviours the scanner depends on:

- `POST /tasks` — creates a task, returns `201` with task object including `id`
- `POST /tasks/{id}/run` — triggers a background scan, returns `202`
- `GET /tasks/{id}/results?full=true` — returns an array of result objects; an empty array means the scan has not completed yet
- `DELETE /tasks/{id}` — removes the task, returns `204`

### Task Lifecycle

1. Create a task per URL via `POST /tasks` with configured WCAG standard and options
2. Trigger scan via `POST /tasks/{id}/run` (returns 202, background processing)
3. Poll `GET /tasks/{id}/results?full=true` with exponential backoff (initial: 1s, max: 10s, jitter: ±500ms)
4. **Completion condition:** results array is non-empty (contains at least one result object with a `date` field)
5. **Timeout:** if no results after `pollTimeout` (default: 60s wall-clock time), mark as timed out, retry once, then record as failed
6. After collecting results, delete the task via `DELETE /tasks/{id}` to avoid cluttering the dashboard

### Concurrency

- Configurable concurrency limit (default: 5 parallel scans)
- Queue remaining URLs, dispatch as slots free up

### Progress Events

The scanner emits structured progress events:

```typescript
interface ScanProgress {
  type: 'scan:start' | 'scan:complete' | 'scan:error' | 'scan:progress';
  url: string;
  current: number;    // 1-indexed current page number
  total: number;      // total pages to scan
  timestamp: string;  // ISO 8601
  error?: string;     // present only for scan:error
}
```

- CLI subscribes and displays a progress counter
- MCP emits these as progress notifications via the protocol's notification mechanism

### Error Handling

- Scan timeout: retry once, then mark as failed and continue
- Webservice unreachable: fail fast with clear error message
- Partial results collected — one page failure does not abort the run

**Structured error type:**

```typescript
interface ScanError {
  url: string;
  code: 'TIMEOUT' | 'WEBSERVICE_ERROR' | 'HTTP_ERROR' | 'UNKNOWN';
  message: string;
  retried: boolean;
}
```

Failed pages appear in the report with their `ScanError` attached and zero issues.

**CLI exit codes:**
- `0` — all pages scanned successfully
- `1` — scan completed but accessibility issues found (above configured threshold, if any)
- `2` — partial failure (some pages failed to scan)
- `3` — fatal error (webservice unreachable, invalid config, etc.)

### Per-Task Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `standard` | `WCAG2AA` | WCAG2A, WCAG2AA, or WCAG2AAA |
| `timeout` | `30000` | Scan timeout per page (ms) — sent to pa11y webservice |
| `pollTimeout` | `60000` | Max wall-clock time to wait for results (ms) |
| `ignore` | `[]` | Rule codes to ignore |
| `hideElements` | `""` | CSS selector for elements to exclude |
| `headers` | `{}` | Custom HTTP headers sent to the target site |
| `wait` | `0` | Milliseconds to wait before testing (SPAs) |

### Webservice Authentication

If the pa11y webservice requires authentication, configure it separately from per-page headers:

```json
{
  "webserviceUrl": "http://192.168.3.90:3000",
  "webserviceHeaders": {
    "Authorization": "Bearer <token>"
  }
}
```

`webserviceHeaders` are sent with every request to the pa11y webservice API. They are distinct from `headers`, which are sent by pa11y to the target website during scanning.

## Source Mapping

When a repository path is provided, the agent maps accessibility issues to source files. Source mapping is **best-effort** — results may be imprecise for component-heavy frameworks where JSX does not map 1:1 to rendered HTML.

### Framework Detection

- Scan repo for framework markers: `next.config.*`, `nuxt.config.*`, `angular.json`, `vite.config.*`, plain `index.html`, etc.
- Check `package.json` dependencies as secondary signal
- Each detected framework gets a routing strategy

### Built-in Routing Strategies

| Framework | Example URL | Maps To |
|-----------|-------------|---------|
| Next.js (App Router) | `/about` | `app/about/page.tsx` |
| Next.js (Pages Router) | `/about` | `pages/about.tsx` |
| Nuxt | `/about` | `pages/about.vue` |
| SvelteKit | `/about` | `src/routes/about/+page.svelte` |
| Angular | `/about` | detected via `angular.json` routes config |
| Plain HTML | `/about` | `about.html` or `about/index.html` |

**Dynamic segments:** Supports `[param]` (single segment) and `[...slug]` (catch-all) patterns. Route groups (e.g. Next.js `(marketing)/`) are traversed transparently. Other advanced routing patterns (parallel routes, intercepting routes) are out of scope — use `sourceMap` overrides for these.

**Vite-based projects:** Vite is a build tool, not a framework with routing conventions. For Vite projects, the agent checks for framework plugins (React Router, Vue Router) in the Vite config and delegates to the appropriate strategy. If no routing framework is detected, falls back to plain HTML mapping.

### User Override Config

In `.pally-agent.json`:

```json
{
  "sourceMap": {
    "/docs/*": "src/templates/docs.tsx",
    "/blog/*": "src/templates/blog-post.tsx"
  }
}
```

User overrides take precedence over auto-detected mappings.

### Issue-to-Element Mapping

- Pa11y results include CSS selectors for offending elements (e.g. `nav > ul > li:nth-child(3) > a`)
- Search mapped source files for matching HTML/JSX element types and attributes via string/regex matching
- Report file path and line number when a confident match is found
- **Confidence levels:** `high` (unique element match), `low` (multiple candidates or heuristic match), `none` (file identified but element not located)
- When confidence is `none` or `low`, the report includes the file but notes the match uncertainty
- This is a best-effort feature — JSX composition, CSS modules, and server-side rendering can all produce HTML that differs from the source structure

## Reporting

### Report Structure

Both JSON and HTML reports contain:

- **Summary** — total pages scanned, total issues, pages failed, breakdown by severity (error/warning/notice) and WCAG rule
- **Per-page results** — URL, issue count, list of issues with: rule code, description, severity, CSS selector, context snippet
- **Failed pages** — URL and `ScanError` details
- **Source mapping** (when repo provided) — file path, line number, confidence level, component name
- **Fix suggestions** — generic textual recommendations are always included; concrete code diffs require a repo

### HTML Report

- Self-contained single file (inline CSS, no external dependencies)
- Sortable/filterable by severity, page, rule
- Collapsible sections per page
- Colour-coded severity: red (error), yellow (warning), blue (notice)

### Output File Naming

Reports are written to `outputDir` (default: `./pally-reports`) with timestamped names:

- `pally-report-2026-03-18T120000Z.json`
- `pally-report-2026-03-18T120000Z.html`

Existing files are never overwritten.

### Code Fix Proposals

Code fix proposals require a `--repo` argument. For common issues, the agent generates concrete code diffs:

| Issue | Fix |
|-------|-----|
| `<img>` missing `alt` | Add `alt=""` (decorative) or flag for user to provide text |
| `<input>` missing label | Wrap with `<label>` or add `aria-label` |
| Missing `lang` on `<html>` | Add `lang="en"` (or configured locale) |
| Empty link text | Flag for user — needs context |
| Missing heading hierarchy | Flag with recommendation |

**Fix application:**

- CLI mode: prompt user per-file — "Apply 3 fixes to `app/about/page.tsx`? [y]es / [n]o / [s]how diff / [a]bort all". "Show diff" displays unified diff output. "No" skips that file and continues to the next. "Abort" stops all remaining fixes. Individual issue selection within a file is not supported in v1.
- MCP mode: return proposed fixes as structured data (file path, line range, original text, replacement text), let calling agent decide
- Never apply changes without explicit user consent

## Configuration

### Config File (`.pally-agent.json`)

Config file discovery: search from the current working directory upward to the filesystem root, using the first `.pally-agent.json` found. If `--repo` is specified, also check the repo root. An explicit `--config <path>` flag overrides discovery.

```json
{
  "webserviceUrl": "http://192.168.3.90:3000",
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

All values have sensible defaults. Environment variable `PALLY_WEBSERVICE_URL` overrides the config file value.

### CLI Interface

```bash
# Full site scan
pally-agent scan https://example.com

# With options
pally-agent scan https://example.com --standard WCAG2AAA --concurrency 3

# Scan with repo for source mapping + fixes
pally-agent scan https://example.com --repo ./my-project

# Output options
pally-agent scan https://example.com --output ./reports --format json,html

# Crawl in addition to sitemap
pally-agent scan https://example.com --also-crawl

# Explicit config file
pally-agent scan https://example.com --config ./custom-config.json

# Apply fixes interactively (re-scans the site, then proposes fixes)
pally-agent fix https://example.com --repo ./my-project

# Apply fixes from a previous scan report (no re-scan)
pally-agent fix --from-report ./pally-reports/pally-report-2026-03-18T120000Z.json --repo ./my-project
```

**`fix` subcommand:** By default, `fix` runs a full scan first, then proposes fixes. Use `--from-report <path>` to skip the scan and propose fixes from a previously generated JSON report. The `--repo` flag is required for `fix`.

### MCP Server Tools

#### `pally_scan`

Scan a website for accessibility issues.

```typescript
// Input
interface PallyScanInput {
  url: string;                    // Website URL to scan
  standard?: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';  // Default: WCAG2AA
  concurrency?: number;           // Default: 5
  maxPages?: number;              // Default: 100
  alsoCrawl?: boolean;            // Default: false
  ignore?: string[];              // Rule codes to ignore
  headers?: Record<string, string>;  // Headers for target site
  wait?: number;                  // Wait time for SPAs (ms)
}

// Output
interface PallyScanOutput {
  summary: {
    url: string;
    pagesScanned: number;
    pagesFailed: number;
    totalIssues: number;
    byLevel: { error: number; warning: number; notice: number };
  };
  pages: PageResult[];
  errors: ScanError[];
  reportPath: string;             // Path to generated JSON report
}
```

#### `pally_get_issues`

Get issues filtered by URL pattern, severity, or rule code.

```typescript
// Input
interface PallyGetIssuesInput {
  reportPath: string;             // Path to a JSON report
  urlPattern?: string;            // Glob pattern to filter URLs
  severity?: 'error' | 'warning' | 'notice';
  ruleCode?: string;              // Specific WCAG rule code
}

// Output: filtered array of PageResult
```

#### `pally_propose_fixes`

Generate code fix proposals for issues in a repo.

```typescript
// Input
interface PallyProposeFixesInput {
  reportPath: string;             // Path to a JSON report
  repoPath: string;               // Path to source code repo
}

// Output
interface PallyProposeFixesOutput {
  fixable: number;
  unfixable: number;
  fixes: Array<{
    file: string;
    line: number;
    issue: string;                // WCAG rule code
    description: string;
    oldText: string;
    newText: string;
    confidence: 'high' | 'low';
  }>;
}
```

#### `pally_apply_fix`

Apply a specific proposed fix to a source file.

```typescript
// Input
interface PallyApplyFixInput {
  file: string;                   // Absolute file path
  line: number;                   // Line number
  oldText: string;                // Text to replace
  newText: string;                // Replacement text
}

// Output
interface PallyApplyFixOutput {
  applied: boolean;
  file: string;
  diff: string;                   // Unified diff of the change
}
```

The MCP server does not prompt for confirmation — the calling agent is responsible for confirming with the user before invoking `pally_apply_fix`.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **CLI:** `commander`
- **MCP:** `@modelcontextprotocol/sdk`
- **Sitemap parsing:** `xml2js`
- **Robots.txt:** `robots-parser`
- **Crawl fallback:** `cheerio` (link extraction from HTML)
- **HTML reports:** `handlebars`
- **Testing:** TDD workflow per project standards

## Acceptance Criteria

Key scenarios that drive the test suite:

1. **Sitemap discovery:** Given a site with `/sitemap.xml`, when scanned, all `<loc>` URLs appear in the discovered URL list
2. **Sitemap index:** Given a sitemap index with nested sitemaps, all URLs from all nested sitemaps are discovered
3. **Crawl fallback:** Given a site with no sitemap, the crawler discovers pages by following links up to the configured depth
4. **Robots.txt respect:** Given a site with `/robots.txt` disallowing `/admin`, that URL is excluded from discovery and scanning
5. **Scan lifecycle:** Given a URL, the scanner creates a task, triggers a run, polls for results, and deletes the task
6. **Concurrency limit:** Given 20 URLs and concurrency of 5, at most 5 tasks are active simultaneously
7. **Scan timeout:** Given a task that never returns results, the scanner retries once then records a `ScanError` with code `TIMEOUT`
8. **JSON report:** Given scan results, the JSON report contains summary, per-page results, and any errors
9. **HTML report:** Given scan results, the HTML report is a self-contained file that renders correctly
10. **Source mapping (Next.js):** Given a Next.js App Router project, `/about` maps to `app/about/page.tsx`
11. **Source mapping override:** Given a `sourceMap` config entry, the override takes precedence over auto-detection
12. **Fix proposal:** Given an `<img>` without `alt` in a mapped source file, the agent proposes adding `alt=""`
13. **CLI exit codes:** Exit 0 on clean scan, 1 on issues found, 2 on partial failure, 3 on fatal error
14. **Config discovery:** The agent finds `.pally-agent.json` by walking up from CWD; `--config` overrides

## Non-Goals

- Running pa11y directly (always uses webservice API)
- Replacing the pa11y dashboard
- Supporting non-web accessibility testing
- Automatic fix application without user consent
- Advanced routing patterns (parallel routes, intercepting routes) — use `sourceMap` overrides
