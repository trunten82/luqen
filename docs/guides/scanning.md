[Docs](../README.md) > [Guides](../README.md#how-to-guides) > Scanning Guide

# Scanning Guide

How to scan websites for accessibility issues using pally-agent's CLI and dashboard interfaces.

---

## Scan modes

Pally-agent supports two scan modes:

| Mode | Behaviour | When to use |
|------|-----------|-------------|
| **Single Page** | Scans only the URL you provide. No discovery step. | Quick check on a specific page, CI/CD gate on a landing page. |
| **Full Site** | Discovers pages via sitemap and/or crawl, then scans each one (up to `maxPages`, default 100). | Comprehensive audit. Enables template issue detection and the Templates tab in reports. |

In the CLI, Full Site mode is the default — it always runs discovery. Pass a single URL and pally-agent will find the rest. In the dashboard, the scan form has a **Scan Mode** toggle that defaults to Single Page for speed.

---

## WCAG standards

Pally-agent supports three WCAG 2.1 conformance levels:

| Standard | Flag value | What it checks |
|----------|-----------|----------------|
| **Level A** | `WCAG2A` | Minimum requirements. 30 success criteria. |
| **Level AA** | `WCAG2AA` | The legal standard in most jurisdictions (EU, UK, US federal, Australia). 50 success criteria. **This is the default.** |
| **Level AAA** | `WCAG2AAA` | Highest conformance. 78 success criteria. Rarely required by law but useful for public-facing government sites. |

Use `WCAG2AA` unless you have a specific reason to change it.

> **Note:** In the dashboard UI, these codes display as human-readable labels: WCAG2AA appears as "WCAG 2.1 Level AA".

---

## CLI scanning

### Basic scan

```bash
pally-agent scan https://example.com
```

This discovers all pages (sitemap + crawl) and scans each one at WCAG 2.1 AA. Results are saved as a JSON report in `./pally-reports/`.

### Common options

```bash
pally-agent scan https://example.com \
  --standard WCAG2AAA \
  --concurrency 3 \
  --format both \
  --output ./my-reports \
  --also-crawl
```

| Flag | Description | Default |
|------|-------------|---------|
| `--standard <level>` | `WCAG2A`, `WCAG2AA`, or `WCAG2AAA` | `WCAG2AA` |
| `--concurrency <n>` | Number of pages to scan in parallel (1-10) | `5` |
| `--format <fmt>` | `json`, `html`, or `both` | `json` |
| `--output <dir>` | Directory for report files | `./pally-reports` |
| `--also-crawl` | Crawl the site in addition to reading `sitemap.xml` | `false` |
| `--repo <path>` | Path to source repository for source mapping | none |
| `--config <path>` | Path to `.pally-agent.json` config file | auto-detected |

### Adding compliance enrichment

```bash
pally-agent scan https://example.com \
  --format both \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU,US,UK \
  --compliance-client-id $CLIENT_ID \
  --compliance-client-secret $CLIENT_SECRET
```

This annotates every issue with the regulations that require it and adds a per-jurisdiction compliance matrix to the report.

### Environment variables

| Variable | Equivalent flag |
|----------|----------------|
| `PALLY_WEBSERVICE_URL` | pa11y webservice URL (default `http://localhost:3000`) |
| `PALLY_WEBSERVICE_AUTH` | `Authorization` header for the webservice |
| `PALLY_COMPLIANCE_URL` | `--compliance-url` |
| `PALLY_AGENT_CONFIG` | `--config` |

### Configuration file

Create `.pally-agent.json` in your project root:

```json
{
  "webserviceUrl": "http://localhost:3000",
  "standard": "WCAG2AA",
  "concurrency": 5,
  "maxPages": 100,
  "crawlDepth": 3,
  "alsoCrawl": false,
  "timeout": 30000,
  "pollTimeout": 60000,
  "outputDir": "./pally-reports",
  "ignore": [],
  "hideElements": "",
  "headers": {},
  "wait": 0,
  "sourceMap": {}
}
```

CLI flags override config file values.

---

## Dashboard scanning

### Starting a scan

1. Navigate to **New Scan** from the dashboard sidebar.
2. Enter the target URL (must use `http://` or `https://`).
3. Select a WCAG standard (default: WCAG 2.1 AA).
4. Choose the scan mode: **Single Page** or **Full Site**.
5. Optionally select jurisdictions using the searchable picker (type to filter, click to toggle).
6. Adjust concurrency (1-10 concurrent pages, default from server config).
7. Click **Start Scan**.

### Scan progress

After submitting, you are redirected to a live progress page. The dashboard uses **Server-Sent Events (SSE)** to stream updates in real time:

- A progress bar shows the percentage of pages scanned.
- Each page logs its start, completion, or error as it happens.
- When all pages are scanned, the progress page automatically redirects to the report.

SSE event types:

| Event | Meaning |
|-------|---------|
| `scan_start` | Scan started, discovering pages |
| `discovery` | Pages discovered, count available |
| `scan_complete` | A page was scanned (includes pagesScanned, totalPages, currentUrl) |
| `compliance` | Running compliance check |
| `complete` | Scan finished, report URL available |
| `failed` | Scan failed with error message |

---

## URL discovery

### Discovery methods

When running a Full Site scan, pally-agent discovers pages in two phases:

1. **Sitemap** — Fetches `robots.txt` to find sitemap URLs. If none are declared, falls back to `/sitemap.xml`. Supports sitemap index files (nested sitemaps). URLs disallowed by `robots.txt` are excluded.

2. **Crawl** — Follows links from the base URL up to `crawlDepth` levels deep (default 3). Only same-origin URLs are followed. Respects `robots.txt` disallow rules.

By default, pally-agent uses the sitemap if available and only crawls if no sitemap is found. Use `--also-crawl` (CLI) or Full Site mode (dashboard) to combine both methods — useful when the sitemap is incomplete.

All discovered URLs are deduplicated. The total is capped at `maxPages` (default 100).

### Discovery method in reports

Each page in the report is tagged with its discovery method (`sitemap` or `crawl`) so you can see how it was found.

---

## Concurrency

The `concurrency` setting controls how many pages are scanned in parallel. The scanner uses a worker pool pattern — N workers pull from a shared queue.

| Setting | Trade-off |
|---------|-----------|
| `1` | Safest. Use when the target server is fragile or rate-limited. |
| `3-5` | Good default. Balances speed and server load. |
| `10` | Maximum. Use for large sites on robust infrastructure. |

The dashboard enforces a maximum of 10. The CLI default is 5.

---

## WAF and bot protection

Some websites use Web Application Firewalls (WAFs) or bot detection (Cloudflare, AWS WAF, Akamai) that block automated scanners.

Pally-agent detects common WAF responses during crawling and reports a warning:

```
WARNING: Possible WAF/bot protection detected on https://example.com
```

**Workarounds:**

- Add custom headers to bypass WAF rules: `--headers '{"Authorization": "Bearer xxx"}'`
- Use the `wait` option to add a delay after page load: configure `"wait": 2000` in `.pally-agent.json`
- Allowlist the scanner's IP address in your WAF configuration
- Use the `hideElements` option to ignore WAF-injected challenge elements

---

## Exit codes

The CLI uses exit codes for pipeline integration:

| Code | Meaning |
|------|---------|
| `0` | No accessibility issues found |
| `1` | Accessibility issues found (scan succeeded) |
| `2` | Partial failure — some pages failed to scan |
| `3` | Fatal error — scan could not run |

See [ci-cd.md](ci-cd.md) for pipeline integration patterns.

---

## Timeouts

Two timeout settings control scan behaviour:

| Setting | Default | Purpose |
|---------|---------|---------|
| `timeout` | 30,000 ms | How long pa11y waits for a page to load |
| `pollTimeout` | 60,000 ms | How long pally-agent waits for scan results before retrying |

If a scan times out, pally-agent retries once with exponential backoff. If both attempts fail, the page is recorded as an error and scanning continues with the remaining pages.

---

*See also: [USER-GUIDE.md](../USER-GUIDE.md) | [compliance-check.md](compliance-check.md) | [reports.md](reports.md) | [ci-cd.md](ci-cd.md)*
