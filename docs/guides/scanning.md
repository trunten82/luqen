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
| `complete` | Scan finished, report URL available. Carries `discoveryWarning: 'waf-blocked'` when discovery was blocked by bot protection (see [WAF and bot protection](#waf-and-bot-protection)) |
| `failed` | Scan failed with error message |

---

## URL discovery

### Discovery methods

When running a Full Site scan, luqen discovers pages in two phases:

1. **Sitemap** — Fetches `robots.txt` to find sitemap URLs. If none are declared, falls back to `/sitemap.xml`. Supports sitemap index files (nested sitemaps). URLs disallowed by `robots.txt` are excluded.

2. **Crawl** — Follows links from the base URL up to `crawlDepth` levels deep (default 3). Only same-origin URLs are followed. Respects `robots.txt` disallow rules.

By default, luqen uses the sitemap if available and only crawls if no sitemap is found. Use `--also-crawl` (CLI) or Full Site mode (dashboard) to combine both methods — useful when the sitemap is incomplete.

All discovered URLs are deduplicated. The total is capped at `maxPages` (default 100).

### Discovery scope

Both sitemap and crawl discovery keep only URLs that match the start URL's **exact origin**
(scheme, host, port — never a string prefix, so a userinfo trick like
`https://example.com@127.0.0.1/`, a lookalike host like `https://example.com.evil.test/`, or
another port like `https://example.com:8443/` are never followed) **and** whose path starts
with the start URL's **directory prefix**:

- A start URL ending in `/` uses that path as-is: `https://example.com/dev/en-us/` scopes
  discovery to `/dev/en-us/...` only — sibling sections like `/dev/fr-fr/` are excluded.
- A start URL that looks like a document uses its parent directory:
  `https://example.com/dev/en-us/index.html` scopes to `/dev/en-us/`.
- A start URL with no trailing slash and no file extension uses its parent directory too
  (wider than the last segment, on purpose — see below): `https://example.com/dev/en-us`
  scopes to `/dev/`. Add a trailing slash if you want the narrower `/dev/en-us/` scope.
- A root start URL (`https://example.com` or `https://example.com/`) scopes to the whole
  origin, exactly as before.

If a sitemap's entries are **all** out of scope, it is treated as no sitemap and the crawl
fallback still runs. One known consequence: a start URL on one host whose declared sitemap
lists a different host (e.g. apex vs `www`) now yields no sitemap URLs at all and relies
entirely on the crawl, since same-origin is enforced literally.

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

Detection happens on the **start page only**, at the discovery step (a Node `fetch` request — no
JavaScript execution, so a challenge page that only a browser can pass always looks like a WAF hit
to the fetch-based crawler and sitemap fetch). When the dashboard's Full Site scan hits this, the
scan is not silently reduced to a normal-looking 1-page site.

### Browser-based discovery fallback (WAF-BROWSER-2)

The FIRST thing that happens on a detected challenge is a **browser-based discovery fallback**: Luqen
opens the site in one headless Chromium (launched through the shared resolver — see
[Browser resolution](#browser-resolution) below), navigates to the start URL, waits one navigation
if the initial load itself is a challenge page, then reads every `a[href]` from the RENDERED DOM.
Those links go through the same scope, robots, extension-filtering, hash-stripping, depth and
maxPages rules as the normal fetch-based crawler — the only difference is the DOM is real (JavaScript
already ran) instead of parsed HTML. Discovered pages keep `discoveryMethod: 'crawl'` — there is no
separate "browser-discovered" method value, only a separate flag on the scan record (below).

The fallback runs ONLY when a challenge was detected, is bounded by a 20-second-per-page timeout and
a 120-second total budget, always closes the browser it opened (success, page failure, launch
failure, or budget exhaustion), and never throws — a bug in the fallback degrades to today's blocked
result rather than crashing discovery.

Two outcomes:

- **The fallback finds pages beyond the start URL.** The scan record carries
  `discovery_warning: 'waf-browser-discovery'` (NOT `'waf-blocked'`) and `pagesScanned` reflects the
  whole site the fallback found. Both the live progress page and the finished report page show an
  informational note (not a warning) explaining that bot protection blocked *standard* discovery and
  these pages were found by opening the site in a headless browser — pages not reachable that way
  within the crawl limits were not discovered. This is neither "blocked" nor a whole-site guarantee.
- **The fallback finds nothing beyond the start URL, or itself fails to launch a browser.** The scan
  record keeps `discovery_warning: 'waf-blocked'` exactly as before, and both pages show the original
  "discovery was blocked" warning.

**Incremental scans of a flagged site** (either code) scan **every discovered page and write no page
hashes** for that run. A Node-fetch content hash of a WAF/challenge page hashes the bot-protection
challenge body — not the page — which would otherwise mark every page "unchanged" on the next run and
skip it forever (a coverage loss that fails silently, in the reassuring direction). This guard never
affects a clean (non-flagged) site's incremental behaviour.

**Time cost:** REASONED, not yet measured against a live WAF site — a browser launch of a few seconds
plus one DOMContentLoaded page load per crawled page below `crawlDepth` until `maxPages` URLs are
known, each bounded by the 20 s per-page timeout, worst case around budget (120 s) plus one in-flight
page timeout plus launch time. Zero added cost for sites without a detected challenge — the browser
is never launched at all in that case.

**Workarounds** (still apply when the browser fallback also cannot get past the challenge):

- Add custom headers to bypass WAF rules: `--headers '{"Authorization": "Bearer xxx"}'`
- Use the `wait` option to add a delay after page load: configure `"wait": 2000` in `.luqen.json`
- Allowlist the scanner's IP address in your WAF configuration
- Use the `hideElements` option to ignore WAF-injected challenge elements

---

## Browser resolution

Every Chromium-launching code path in Luqen — the pa11y-based scanner, the behavioral / Lighthouse /
IBM / reflow / accessibility-tree deep-scan engines, the browser-based discovery fallback above, and
the dashboard's ACR PDF rendering — resolves its browser through ONE shared resolver
(`packages/core/src/browser/resolve.ts`). Resolution order, each candidate accepted only when its
FILE actually exists on disk:

1. `PUPPETEER_EXECUTABLE_PATH`, when set.
2. Known system binaries, in order: `/usr/bin/chromium`, `/usr/bin/chromium-browser`,
   `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`.
3. The puppeteer download cache (`PUPPETEER_CACHE_DIR`, else `~/.cache/puppeteer`), newest version
   directory first — an EMPTY download directory (a partial/failed install) is skipped rather than
   accepted.
4. A playwright chromium install (`~/.cache/ms-playwright`), newest first.
5. puppeteer's own `executablePath()` resolver, accepted only if that file exists.

Nothing found throws `ChromiumNotFoundError`, naming every path it tried. No caller falls through to
puppeteer's own bare `.launch()` default resolver — the resolver is the only place that decides.

**Startup + `/health`:** the dashboard probes this resolver once at startup and logs the outcome —
an ERROR naming every tried path (and the features that will fail: scans, the browser discovery
fallback, ACR PDFs) when nothing resolves, or an INFO line with the resolved path and its source when
something does. `GET /health` (public, unauthenticated) probes again on every request and reports
`{ status: 'ok' | 'degraded', checks: { browser: { status, source? } } }` — HTTP 200 either way, never
503, because a missing browser only affects scan-shaped features and a 503 would make uptime monitors
treat the whole dashboard as down. The health body never includes filesystem paths (a public,
unauthenticated surface) — those go to the server log only.

**Measured root cause (live server, 2026-09-28, by the orchestrator):** puppeteer 25.1.0 (the root
workspace dependency) expects Chrome `149.0.7827.22`; the live server's
`/root/.cache/puppeteer/chrome/linux-149.0.7827.22` directory EXISTS but is EMPTY (created
2026-05-31 — a download that never completed), while `linux-131` and `linux-146` directories hold
real binaries; `/usr/bin/chromium` is a real, working `154.0.8037.57` install; the service runs as
root with `WorkingDirectory=/root/luqen` and no `PUPPETEER_*` environment variable set. A bare
`puppeteer.launch()` (puppeteer's own default resolver) picks the empty 149 directory and fails with
`Could not find Chrome (ver. 149...)`. The shared resolver above skips that empty directory by
construction and resolves `/usr/bin/chromium` (step 2) on that host.

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
