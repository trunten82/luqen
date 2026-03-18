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
│         Pa11y Webservice (Docker)           │
│         192.168.3.90                        │
└─────────────────────────────────────────────┘
```

### Layers

- **Interfaces** — thin wrappers (CLI via `commander`, MCP via `@modelcontextprotocol/sdk`) over the core library
- **Core Library** — all business logic, composed of focused modules
- **Pa11y Webservice** — external dependency, accessed via REST API

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

Activated only when no sitemap is found:

- Start from the root URL, follow same-domain `<a href>` links via BFS
- Configurable depth limit (default: 3)
- Respect robots.txt rules during crawl
- Deduplicate URLs, skip fragments/anchors, skip non-HTML resources
- Configurable max page count (default: 100) to prevent runaway crawls

**Output:** A deduplicated list of URLs, each tagged with discovery method (sitemap vs crawl).

## Scanning

The scanner orchestrates interactions with the pa11y webservice REST API.

### Task Lifecycle

1. Create a task per URL via `POST /tasks` with configured WCAG standard and options
2. Trigger scan via `POST /tasks/{id}/run` (returns 202, background processing)
3. Poll `GET /tasks/{id}/results?full=true` until results appear
4. After collecting results, delete the task via `DELETE /tasks/{id}` to avoid cluttering the dashboard

### Concurrency

- Configurable concurrency limit (default: 5 parallel scans)
- Queue remaining URLs, dispatch as slots free up

### Progress

- Emit progress events: `scanning page 12/47 — https://example.com/about`
- CLI displays a progress counter
- MCP returns progress notifications

### Error Handling

- Scan timeout: retry once, then mark as failed and continue
- Webservice unreachable: fail fast with clear error message
- Partial results collected — one page failure does not abort the run

### Per-Task Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `standard` | `WCAG2AA` | WCAG2A, WCAG2AA, or WCAG2AAA |
| `timeout` | `30000` | Scan timeout per page (ms) |
| `ignore` | `[]` | Rule codes to ignore |
| `hideElements` | `""` | CSS selector for elements to exclude |
| `headers` | `{}` | Custom HTTP headers (e.g. auth tokens) |
| `wait` | `0` | Milliseconds to wait before testing (SPAs) |

## Source Mapping

When a repository path is provided, the agent maps accessibility issues to source files.

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
| Plain HTML | `/about` | `about.html` or `about/index.html` |

Dynamic segments handled via pattern matching (e.g. `/blog/123` maps to `app/blog/[id]/page.tsx`).

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

- Pa11y results include CSS selectors for offending elements
- Search mapped source files for matching HTML/JSX patterns
- Report file path and approximate line number when possible
- If no match found, report the file but note the element could not be pinpointed

## Reporting

### Report Structure

Both JSON and HTML reports contain:

- **Summary** — total pages scanned, total issues, breakdown by severity (error/warning/notice) and WCAG rule
- **Per-page results** — URL, issue count, list of issues with: rule code, description, severity, CSS selector, context snippet
- **Source mapping** (when repo available) — file path, line number, component name
- **Fix suggestions** — human-readable explanation of how to fix each issue

### HTML Report

- Self-contained single file (inline CSS, no external dependencies)
- Sortable/filterable by severity, page, rule
- Collapsible sections per page
- Colour-coded severity: red (error), yellow (warning), blue (notice)

### Code Fix Proposals

For common issues, the agent generates concrete code diffs:

| Issue | Fix |
|-------|-----|
| `<img>` missing `alt` | Add `alt=""` (decorative) or flag for user to provide text |
| `<input>` missing label | Wrap with `<label>` or add `aria-label` |
| Missing `lang` on `<html>` | Add `lang="en"` (or configured locale) |
| Empty link text | Flag for user — needs context |
| Missing heading hierarchy | Flag with recommendation |

**Fix application:**

- CLI mode: prompt user per-file — "Apply 3 fixes to `app/about/page.tsx`? (y/n/show diff)"
- MCP mode: return proposed fixes as structured data, let calling agent decide
- Never apply changes without explicit user consent

## Configuration

### Config File (`.pally-agent.json`)

```json
{
  "webserviceUrl": "http://192.168.3.90:3000",
  "standard": "WCAG2AA",
  "concurrency": 5,
  "timeout": 30000,
  "maxPages": 100,
  "crawlDepth": 3,
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

# Apply fixes interactively
pally-agent fix https://example.com --repo ./my-project
```

### MCP Server Tools

| Tool | Description |
|------|-------------|
| `pally_scan` | Scan a site, returns JSON results |
| `pally_get_issues` | Get issues for a specific URL or page pattern |
| `pally_propose_fixes` | Get code fix proposals for a repo |
| `pally_apply_fix` | Apply a specific fix to a source file (requires confirmation) |

## Tech Stack

- **Language:** TypeScript (strict mode)
- **CLI:** `commander`
- **MCP:** `@modelcontextprotocol/sdk`
- **Sitemap parsing:** `xml2js`
- **Robots.txt:** `robots-parser`
- **Crawl fallback:** `cheerio` (link extraction from HTML)
- **HTML reports:** `handlebars`
- **Testing:** TDD workflow per project standards

## Non-Goals

- Running pa11y directly (always uses webservice API)
- Replacing the pa11y dashboard
- Supporting non-web accessibility testing
- Automatic fix application without user consent
