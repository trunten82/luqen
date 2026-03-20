[Docs](../README.md) > [Guides](./) > Scanning

# Scanning Guide

How to scan websites — discovery modes, options, WAF handling, and troubleshooting.

---

## Basic scan

```bash
pally-agent scan https://example.com
```

This discovers all pages (via sitemap), scans each one with pa11y, and writes a JSON report to `./pally-reports/`.

---

## Page discovery

Pally-agent finds pages in three ordered steps:

### Step 1: robots.txt

Fetches `/robots.txt` to extract `Disallow` rules and any `Sitemap:` directive. Disallowed URLs are filtered throughout discovery.

### Step 2: Sitemap

Tries to find the sitemap using:
1. The `Sitemap:` directive from `robots.txt`
2. Fallback: `/sitemap.xml`

Supports **sitemap index files** — if the sitemap is a `<sitemapindex>`, all nested sitemaps are fetched recursively. All `<loc>` URLs are collected.

### Step 3: Crawl fallback

Crawling activates when:
- No sitemap is found, **or**
- `--also-crawl` is set

**BFS algorithm:** Starts at the root URL, extracts `<a href>` links via cheerio, follows same-domain links only. Skips fragments, non-HTML resources (`.pdf`, `.jpg`, etc.), and disallowed paths.

**Default limits:**

| Limit | Default | Config field |
|-------|---------|-------------|
| Max pages | 100 | `maxPages` |
| Max crawl depth | 3 | `crawlDepth` |

---

## Scan modes

### Sitemap only (default)

```bash
pally-agent scan https://example.com
```

Uses sitemap exclusively. Fastest for well-maintained sitemaps.

### Crawl only (no sitemap)

If the site has no sitemap, the crawler runs automatically as fallback.

### Both (sitemap + crawl)

```bash
pally-agent scan https://example.com --also-crawl
```

Merges sitemap URLs and crawled URLs. Useful for sites with partial sitemaps. Duplicate URLs are deduplicated.

---

## Concurrency

Control how many pages are scanned simultaneously:

```bash
pally-agent scan https://example.com --concurrency 3
```

Default: 5. Reduce if the webservice is slow or the target site rate-limits.

---

## WCAG standard

```bash
# WCAG 2.1 AA (default — legal standard in most jurisdictions)
pally-agent scan https://example.com --standard WCAG2AA

# WCAG 2.1 A (minimum)
pally-agent scan https://example.com --standard WCAG2A

# WCAG 2.1 AAA (strictest)
pally-agent scan https://example.com --standard WCAG2AAA
```

---

## Report formats

```bash
# JSON only (default)
pally-agent scan https://example.com

# HTML only
pally-agent scan https://example.com --format html

# Both JSON and HTML
pally-agent scan https://example.com --format both
```

Reports are written to `./pally-reports/` with timestamped filenames. See [guides/reports.md](reports.md) for the full report reference.

---

## Scanning a staging site with authentication

Use the `headers` config field to pass credentials to the target site:

```bash
# Basic auth
pally-agent scan https://staging.example.com \
  --config ./staging/.pally-agent.json
```

In `.pally-agent.json`:

```json
{
  "headers": {
    "Authorization": "Basic c3RhZ2luZzpwYXNz"
  }
}
```

This passes the Authorization header to pa11y, which includes it in every page request.

---

## WAF detection

If a Web Application Firewall blocks the pa11y scanner, pages will return 403 or unusual HTML. Pally-agent detects common WAF response patterns and reports them clearly:

```
[3/12] Error: https://example.com/page — WAF_BLOCKED
```

The page appears in the report with `code: "WAF_BLOCKED"` in the errors array, not counted as a scan failure.

**Workarounds:**
- Add the pa11y webservice's IP to your WAF allowlist
- Use the `headers` config to pass a bypass token
- Use `hideElements` to exclude WAF challenge elements

---

## Scanning SPAs

Single-page apps may render content after page load. Use `wait` to pause before testing:

```bash
# Wait 2 seconds after page load
pally-agent scan https://example.com --config spa.json
```

In `spa.json`:

```json
{
  "wait": 2000
}
```

---

## Ignoring specific rules

```json
{
  "ignore": [
    "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.BgImage",
    "WCAG2AA.Principle1.Guideline1_4.1_4_3.G145.BgImage"
  ]
}
```

These colour contrast rules are sometimes false positives for gradient backgrounds.

---

## Troubleshooting

### "Found 0 URLs to scan"

1. Verify the sitemap exists: `curl https://example.com/sitemap.xml`
2. Check `robots.txt` for a `Sitemap:` directive
3. Add `--also-crawl` to fall back to link crawling
4. Check for aggressive `Disallow` rules in `robots.txt`

### Pages timing out

```json
{
  "pollTimeout": 120000,
  "timeout": 60000,
  "concurrency": 2
}
```

### "Fatal error: connect ECONNREFUSED"

The pa11y webservice is not running or not accessible.

```bash
curl http://localhost:3000/tasks   # Should return []
```

Check `PALLY_WEBSERVICE_URL` or `webserviceUrl` in your config.

### "Request failed with status 401"

The webservice requires authentication:

```bash
export PALLY_WEBSERVICE_AUTH="Bearer your-token-here"
```

---

*See also: [guides/reports.md](reports.md) | [guides/compliance-check.md](compliance-check.md) | [configuration/core.md](../configuration/core.md)*
