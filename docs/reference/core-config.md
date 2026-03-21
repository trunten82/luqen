[Docs](../README.md) > [Configuration](./) > Core

# Core Configuration Reference

`@pally-agent/core` — `.pally-agent.json` fields, environment variables, and CLI flags.

---

## Config file: `.pally-agent.json`

Place this file in your project root (or any ancestor directory). All fields are optional.

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
  "runner": "htmlcs",
  "outputDir": "./pally-reports",
  "sourceMap": {},
  "compliance": {
    "url": "http://localhost:4000",
    "clientId": "",
    "clientSecret": "",
    "jurisdictions": [],
    "sectors": [],
    "includeOptional": false
  }
}
```

### Field reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `webserviceUrl` | `string` | `"http://localhost:3000"` | Base URL of the pa11y webservice instance |
| `webserviceUrls` | `string[]` | `[]` | Additional pa11y webservice URLs for horizontal scaling. Scans are distributed round-robin across all URLs (including `webserviceUrl`). |
| `webserviceHeaders` | `object` | `{}` | HTTP headers sent with every request **to the webservice** (e.g. for webservice authentication) |
| `standard` | `"WCAG2A" \| "WCAG2AA" \| "WCAG2AAA"` | `"WCAG2AA"` | WCAG conformance level |
| `concurrency` | `number` | `5` | Maximum number of pages scanned in parallel |
| `timeout` | `number` | `30000` | Per-page scan timeout (ms) sent to pa11y webservice |
| `pollTimeout` | `number` | `60000` | Maximum wall-clock time (ms) to wait for a scan result |
| `maxPages` | `number` | `100` | Maximum pages to discover and scan |
| `crawlDepth` | `number` | `3` | Maximum link-following depth when crawling |
| `alsoCrawl` | `boolean` | `false` | Crawl the site in addition to the sitemap |
| `ignore` | `string[]` | `[]` | WCAG rule codes to exclude from results |
| `hideElements` | `string` | `""` | CSS selector for elements pa11y should ignore |
| `headers` | `object` | `{}` | HTTP headers sent by pa11y **to the target site** (e.g. staging auth) |
| `wait` | `number` | `0` | Milliseconds to wait after page load before testing (for SPAs) |
| `outputDir` | `string` | `"./pally-reports"` | Directory where reports are written |
| `runner` | `"htmlcs" \| "axe"` | `"htmlcs"` | Pa11y test runner. `axe` requires `pa11y-runner-axe` installed on the webservice. |
| `sourceMap` | `object` | `{}` | Manual URL-to-file overrides (glob patterns supported) |
| `compliance.url` | `string` | `""` | Base URL of the compliance service |
| `compliance.clientId` | `string` | `""` | OAuth client ID for the compliance service |
| `compliance.clientSecret` | `string` | `""` | OAuth client secret |
| `compliance.jurisdictions` | `string[]` | `[]` | Default jurisdictions to check |
| `compliance.sectors` | `string[]` | `[]` | Filter regulations by sector (empty = all) |
| `compliance.includeOptional` | `boolean` | `false` | Include optional requirement violations |

---

## Environment variables

| Variable | Overrides | Description |
|----------|-----------|-------------|
| `PALLY_WEBSERVICE_URL` | `webserviceUrl` | Base URL of the pa11y webservice |
| `PALLY_WEBSERVICE_AUTH` | `webserviceHeaders.Authorization` | Authorization header for the webservice |
| `PALLY_AGENT_CONFIG` | Config file path | Absolute path to a `.pally-agent.json` file |
| `PALLY_MAX_PAGES` | `maxPages` | Maximum pages to discover and scan (dashboard uses this via `DASHBOARD_MAX_PAGES`) |
| `PALLY_RUNNER` | `runner` | Pa11y test runner: `htmlcs` or `axe` |

---

## Precedence order

```
CLI flags  >  Environment variables  >  Config file  >  Defaults
```

---

## Config file discovery

When no `--config` flag is given, pally-agent searches for `.pally-agent.json` by:

1. Starting from the current working directory
2. Walking up to the filesystem root, checking each directory
3. If `--repo <path>` is specified, also checking the repo root
4. Using the first file found

Specify explicitly:

```bash
pally-agent scan https://example.com --config /path/to/.pally-agent.json
# or:
export PALLY_AGENT_CONFIG=/shared/pally-agent.json
```

---

## CLI reference

### `pally-agent scan`

```
pally-agent scan <url> [options]
```

| Option | Type | Description |
|--------|------|-------------|
| `--standard <standard>` | `WCAG2A \| WCAG2AA \| WCAG2AAA` | WCAG conformance level |
| `--concurrency <number>` | `number` | Number of parallel scans |
| `--repo <path>` | `string` | Path to source repository — enables source mapping |
| `--output <dir>` | `string` | Output directory for reports |
| `--format <format>` | `json \| html \| both` | Report format (default: `json`) |
| `--also-crawl` | flag | Crawl the site in addition to the sitemap |
| `--runner <runner>` | `htmlcs \| axe` | Pa11y test runner (default: `htmlcs`) |
| `--config <path>` | `string` | Explicit path to a config file |
| `--compliance-url <url>` | `string` | Base URL of the compliance service |
| `--jurisdictions <list>` | `string` | Comma-separated jurisdiction IDs (e.g. `EU,US,UK`) |
| `--compliance-client-id <id>` | `string` | OAuth client ID for compliance service |
| `--compliance-client-secret <secret>` | `string` | OAuth client secret |

### `pally-agent fix`

```
pally-agent fix [url] --repo <path> [options]
pally-agent fix --from-report <path> --repo <path> [options]
```

| Option | Type | Description |
|--------|------|-------------|
| `--repo <path>` | `string` | Path to source repository **(required)** |
| `--from-report <path>` | `string` | Load issues from an existing JSON report |
| `--standard <standard>` | `string` | WCAG standard (only applies when scanning) |
| `--config <path>` | `string` | Path to a config file |

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | All pages scanned, no accessibility issues |
| `1` | Scan completed with accessibility issues found |
| `2` | Partial failure — some pages failed (timeout or HTTP error) |
| `3` | Fatal error — webservice unreachable, invalid config |

---

## Example configs

### Basic — local webservice

```json
{
  "webserviceUrl": "http://localhost:3000",
  "standard": "WCAG2AA",
  "outputDir": "./a11y-reports"
}
```

### Authenticated — remote webservice + staging site

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

### CI/CD — strict, JSON only

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

*See also: [guides/scanning.md](../guides/scanning.md) | [guides/ci-cd.md](../guides/ci-cd.md) | [compliance-config.md](compliance-config.md)*
