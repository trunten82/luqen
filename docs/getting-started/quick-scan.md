[Docs](../README.md) > [Getting Started](./) > Quick Scan

# Quick Scan — Under 60 Seconds

Scan a website for accessibility issues using the pally-agent CLI.

---

## Prerequisites

- **Node.js 20+** — check with `node --version`
- **pa11y webservice** — running and accessible (see below)

---

## 1. Start pa11y webservice

Pick one method:

**Docker (recommended):**
```bash
docker run -d -p 3000:3000 --name pa11y-ws pally/webservice:latest
```

**npm (global):**
```bash
npx pa11y-webservice
```

Verify it is running: `curl http://localhost:3000/tasks` should return `[]`.

---

## 2. Install pally-agent

```bash
npm install -g @pally-agent/core
```

Or install from source:
```bash
git clone https://github.com/alanna82/pally-agent.git
cd pally-agent && npm install && npm run build --workspaces
cd packages/core && npm link
```

---

## 3. Scan

```bash
export PALLY_WEBSERVICE_URL=http://localhost:3000
pally-agent scan https://example.com
```

The report is saved to `./pally-reports/`. For an HTML report, add `--format both`.

---

## 4. Read the report

The JSON report contains:

| Field | Description |
|-------|-------------|
| `summary.totalPages` | Number of pages scanned |
| `summary.totalIssues` | Total issues across all pages |
| `summary.issuesByType` | Counts by error, warning, notice |
| `pages[]` | Per-page results with URL, issues, and selectors |
| `pages[].issues[]` | Each issue: type, code, message, selector, context |
| `templateIssues[]` | Issues appearing on 3+ pages (likely shared components) |

Errors are confirmed WCAG violations. Warnings need human review. Notices are informational.

---

## Troubleshooting

**"Cannot connect to webservice"** — pa11y webservice is not running or `PALLY_WEBSERVICE_URL` is wrong. Verify with `curl $PALLY_WEBSERVICE_URL/tasks`.

**"0 URLs found"** — the target site has no `sitemap.xml` and returned no crawlable links. Try adding `--also-crawl` to follow links from the page.

**Scan times out** — the target site is slow or behind a WAF. Increase timeout with `--timeout 60000` or reduce concurrency with `--concurrency 1`.

---

## Next steps

- Add compliance checking: [Compliance guide](../paths/compliance-checking.md)
- Integrate with your IDE: [IDE integration](../paths/ide-integration.md)
- Add to CI/CD: [Developer CLI guide](../paths/developer-cli.md#cicd-integration)

---

*See also: [What is Pally Agent?](what-is-pally.md) | [User Guide](../USER-GUIDE.md)*
