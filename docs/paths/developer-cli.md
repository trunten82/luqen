[Docs](../README.md) > [Paths](./) > Developer CLI

# Developer CLI — Scan, Gate, Fix

Covers composition paths 1-3: quick scanning, CI/CD gating, and fix proposals. Uses `@luqen/core` only.

---

## Prerequisites

- Node.js 20+
- pa11y webservice running (Docker: `docker run -d -p 3000:3000 luqen/webservice:latest`)

---

## Install

```bash
npm install -g @luqen/core
export LUQEN_WEBSERVICE_URL=http://localhost:3000
```

---

## Basic scanning

```bash
# JSON report (default)
luqen scan https://example.com

# HTML report
luqen scan https://example.com --format html

# Both formats
luqen scan https://example.com --format both
```

### Scan options

| Flag | Description | Default |
|------|-------------|---------|
| `--standard <std>` | WCAG level: `WCAG2A`, `WCAG2AA`, `WCAG2AAA` | `WCAG2AA` |
| `--concurrency <n>` | Pages scanned in parallel | `5` |
| `--format <fmt>` | Output: `json`, `html`, `both` | `json` |
| `--output <dir>` | Report output directory | `./luqen-reports` |
| `--also-crawl` | Crawl links in addition to sitemap | off |
| `--repo <path>` | Source repo for source mapping | none |
| `--config <path>` | Custom config file path | `.luqen.json` |

### Output formats

**JSON** — machine-readable, suitable for CI/CD pipelines and downstream tools. Contains full issue details, selectors, WCAG codes, and template deduplication.

**HTML** — self-contained browser report with sortable tables, severity filters, and links to WCAG criteria documentation.

---

## Exit codes

| Code | Meaning | CI/CD action |
|------|---------|-------------|
| `0` | No accessibility issues found | Pass |
| `1` | Issues found | Fail (violations detected) |
| `2` | Partial failure (some pages errored) | Investigate |
| `3` | Fatal error (bad config, webservice down) | Fix configuration |

---

## CI/CD integration

### GitHub Actions

```yaml
name: Accessibility scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  a11y:
    runs-on: ubuntu-latest
    services:
      pa11y:
        image: luqen/webservice:latest
        ports:
          - 3000:3000

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install -g @luqen/core

      - name: Scan
        env:
          LUQEN_WEBSERVICE_URL: http://localhost:3000
        run: luqen scan ${{ vars.SITE_URL }} --format json

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: a11y-report
          path: luqen-reports/
```

The job fails on exit code 1 (issues found) or higher. Artifacts preserve the report regardless of outcome.

### Azure DevOps

```yaml
trigger:
  branches:
    include: [main]

pool:
  vmImage: ubuntu-latest

services:
  pa11y:
    image: luqen/webservice:latest
    ports:
      - 3000:3000

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm install -g @luqen/core
    displayName: Install luqen

  - script: luqen scan $(SITE_URL) --format json
    displayName: Accessibility scan
    env:
      LUQEN_WEBSERVICE_URL: http://localhost:3000

  - task: PublishBuildArtifacts@1
    condition: always()
    inputs:
      pathToPublish: luqen-reports
      artifactName: a11y-report
```

---

## Fix proposals

Generate code fixes for issues found in a scan:

```bash
# Scan first
luqen scan https://example.com --format json --repo ./my-project

# Propose fixes from the report
luqen fix --repo ./my-project --from-report luqen-reports/luqen-report-*.json
```

The fix command reads the scan report, maps issues to source files using the `--repo` path, and presents fixes interactively. Each fix shows a diff preview. Accept or skip each one.

Fix proposals cover common issues: missing `alt` attributes, missing form labels, missing `lang` attribute, empty link text, and missing ARIA roles.

---

## Configuration file

Create `.luqen.json` in your project root to avoid repeating flags:

```json
{
  "webserviceUrl": "http://localhost:3000",
  "standard": "WCAG2AA",
  "concurrency": 5,
  "format": "both",
  "outputDir": "./luqen-reports",
  "alsoCrawl": true
}
```

CLI flags override config file values.

---

## Next steps

- Add legal compliance: [Compliance checking](compliance-checking.md)
- Use in your IDE: [IDE integration](ide-integration.md)
- Deploy the full platform: [Full dashboard](full-dashboard.md)

---

*See also: [Quick scan](../getting-started/quick-scan.md) | [CI/CD guide](../guides/ci-cd.md) | [Scanning guide](../guides/scanning.md)*
