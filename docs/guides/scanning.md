[Docs](../README.md) > [Guides](../README.md#how-to-guides) > Scanning Guide

# Scanning Guide

How to scan websites for accessibility issues using luqen's CLI and dashboard interfaces.

---

## Scan modes

Luqen-agent supports two scan modes:

| Mode | Behaviour | When to use |
|------|-----------|-------------|
| **Single Page** | Scans only the URL you provide. No discovery step. | Quick check on a specific page, CI/CD gate on a landing page. |
| **Full Site** | Discovers pages via sitemap and/or crawl, then scans each one (up to `maxPages`, default 100). | Comprehensive audit. Enables template issue detection and the Templates tab in reports. |

In the CLI, Full Site mode is the default — it always runs discovery. Pass a single URL and luqen will find the rest. In the dashboard, the scan form has a **Scan Mode** toggle that defaults to Single Page for speed.

---

## WCAG standards

Luqen-agent supports three WCAG 2.1 conformance levels:

| Standard | Flag value | What it checks |
|----------|-----------|----------------|
| **Level A** | `WCAG2A` | Minimum requirements. 30 success criteria. |
| **Level AA** | `WCAG2AA` | The legal standard in most jurisdictions (EU, UK, US federal, Australia). 50 success criteria. **This is the default.** |
| **Level AAA** | `WCAG2AAA` | Highest conformance. 78 success criteria. Rarely required by law but useful for public-facing government sites. |

Use `WCAG2AA` unless you have a specific reason to change it.

> **Note:** In the dashboard UI, these codes display as human-readable labels: WCAG2AA appears as "WCAG 2.1 Level AA".

---

## Runner selection

Luqen-agent supports two test runners:

| Runner | Value | Description |
|--------|-------|-------------|
| **HTML_CodeSniffer** | `htmlcs` | The default runner. Comprehensive WCAG 2.1 coverage with detailed rule codes. |
| **axe-core** | `axe` | Deque's axe-core engine. Requires `pa11y-runner-axe` installed on the pa11y webservice. Provides partial coverage for some WCAG 2.2 criteria. |

Configure the runner at multiple levels:

- **CLI flag:** `--runner axe`
- **Config file:** `"runner": "axe"` in `.luqen.json`
- **Environment variable:** `LUQEN_RUNNER=axe` (core) or `DASHBOARD_SCANNER_RUNNER=axe` (dashboard)
- **Dashboard scan form:** Select from the **Runner** dropdown when creating a scan

---

## Incremental scanning

For sites scanned repeatedly, incremental scanning avoids re-testing pages that have not changed. When enabled, luqen computes a SHA-256 hash of each page's HTML content and compares it against hashes stored from the previous scan (in the `page_hashes` database table).

- **Changed pages** are scanned normally and their hashes updated.
- **Unchanged pages** reuse results from the previous scan.

This significantly reduces scan time for large sites where only a few pages change between deployments.

**Enable incremental scanning:**

- **Dashboard:** Check the **Incremental scan** checkbox on the scan form.
- **CLI:** Use `--incremental` flag.

---

## Scan scheduling

The dashboard supports recurring scans without external cron. When creating a scan, enable the **Schedule** toggle and select a frequency:

| Frequency | Behaviour |
|-----------|-----------|
| **Daily** | Runs at the configured time every day |
| **Weekly** | Runs on a selected day of the week |
| **Monthly** | Runs on a selected day of the month |

Scheduled scans inherit the original scan's URL, standard, jurisdictions, runner, and concurrency settings. Manage active schedules from **Settings > Schedules** in the dashboard sidebar. Each schedule shows its next run time, last result, and can be paused or deleted.

CLI equivalent: use `luqen scan --schedule daily|weekly|monthly` to create a schedule via the API.

---

## Page limits

The `maxPages` setting caps how many pages are discovered and scanned during a Full Site scan.

| Context | Setting | Default |
|---------|---------|---------|
| CLI config | `maxPages` in `.luqen.json` | `100` |
| Dashboard env | `DASHBOARD_MAX_PAGES` | `50` |
| Dashboard config | `maxPages` in `dashboard.config.json` | `50` |

The dashboard accepts values from 1 to 1000. Adjust this based on your site size and available resources.

---

## CLI scanning

### Basic scan

```bash
luqen scan https://example.com
```

This discovers all pages (sitemap + crawl) and scans each one at WCAG 2.1 AA. Results are saved as a JSON report in `./luqen-reports/`.

### Common options

```bash
luqen scan https://example.com \
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
| `--output <dir>` | Directory for report files | `./luqen-reports` |
| `--also-crawl` | Crawl the site in addition to reading `sitemap.xml` | `false` |
| `--repo <path>` | Path to source repository for source mapping | none |
| `--config <path>` | Path to `.luqen.json` config file | auto-detected |

### Adding compliance enrichment

```bash
luqen scan https://example.com \
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
| `LUQEN_WEBSERVICE_URL` | pa11y webservice URL (default `http://localhost:3000`) |
| `LUQEN_WEBSERVICE_AUTH` | `Authorization` header for the webservice |
| `LUQEN_COMPLIANCE_URL` | `--compliance-url` |
| `LUQEN_CONFIG` | `--config` |

### Configuration file

Create `.luqen.json` in your project root:

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
  "outputDir": "./luqen-reports",
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

When running a Full Site scan, luqen discovers pages in two phases:

1. **Sitemap** — Fetches `robots.txt` to find sitemap URLs. If none are declared, falls back to `/sitemap.xml`. Supports sitemap index files (nested sitemaps). URLs disallowed by `robots.txt` are excluded.

2. **Crawl** — Follows links from the base URL up to `crawlDepth` levels deep (default 3). Only same-origin URLs are followed. Respects `robots.txt` disallow rules.

By default, luqen uses the sitemap if available and only crawls if no sitemap is found. Use `--also-crawl` (CLI) or Full Site mode (dashboard) to combine both methods — useful when the sitemap is incomplete.

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

Luqen-agent detects common WAF responses during crawling and reports a warning:

```
WARNING: Possible WAF/bot protection detected on https://example.com
```

**Workarounds:**

- Add custom headers to bypass WAF rules: `--headers '{"Authorization": "Bearer xxx"}'`
- Use the `wait` option to add a delay after page load: configure `"wait": 2000` in `.luqen.json`
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
| `pollTimeout` | 60,000 ms | How long luqen waits for scan results before retrying |

If a scan times out, luqen retries once with exponential backoff. If both attempts fail, the page is recorded as an error and scanning continues with the remaining pages.

---

*See also: [USER-GUIDE.md](../USER-GUIDE.md) | [compliance-check.md](compliance-check.md) | [reports.md](reports.md) | [ci-cd.md](ci-cd.md)*
