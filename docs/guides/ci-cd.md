[Docs](../README.md) > [Guides](./) > CI/CD Integration

# CI/CD Integration

Integrate pally-agent into your pipeline to fail builds on accessibility violations.

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | All pages scanned, no accessibility issues |
| `1` | Scan completed with accessibility issues found |
| `2` | Partial failure — some pages could not be scanned (timeout, HTTP error) |
| `3` | Fatal error — webservice unreachable, invalid config, unhandled exception |

In CI/CD:

- **Exit 0** — gate passes; site is clean
- **Exit 1** — accessibility issues found; build fails
- **Exit 2** — infrastructure issue (webservice or target site problem); investigate separately
- **Exit 3** — misconfiguration; check your config and webservice URL

---

## GitHub Actions

```yaml
name: Accessibility scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest
    services:
      pa11y-webservice:
        image: pally/webservice:latest
        ports:
          - 3000:3000

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install pally-agent
        run: |
          npm install
          npm run build --workspaces
          cd packages/core && npm link

      - name: Run accessibility scan
        run: pally-agent scan ${{ vars.SITE_URL }} --format json --output ./ci-reports
        env:
          PALLY_WEBSERVICE_URL: http://localhost:3000

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: accessibility-report
          path: ci-reports/*.json
```

---

## Fail on errors only (allow warnings)

By default, exit code `1` is raised for any issue (errors, warnings, or notices). To fail only on confirmed errors:

```bash
pally-agent scan https://example.com --format json --output ./ci-reports

ERRORS=$(cat ci-reports/pally-report-*.json | jq '.summary.byLevel.error')
if [ "$ERRORS" -gt "0" ]; then
  echo "Build failed: $ERRORS accessibility errors found"
  exit 1
fi
echo "No errors found (warnings/notices may exist)"
```

---

## Fail on compliance violations

To fail the build when legal compliance requirements are violated:

```bash
pally-agent scan https://example.com \
  --format json \
  --compliance-url $COMPLIANCE_URL \
  --jurisdictions EU,US \
  --compliance-client-id $CLIENT_ID \
  --compliance-client-secret $CLIENT_SECRET

VIOLATIONS=$(cat pally-reports/*.json | jq '.compliance.summary.totalMandatoryViolations')
if [ "$VIOLATIONS" -gt "0" ]; then
  echo "Build failed: $VIOLATIONS mandatory compliance violations"
  exit 1
fi
```

---

## Parse JSON output

```bash
# Print summary
cat ci-reports/pally-report-*.json | jq '.summary'

# Count errors
cat ci-reports/pally-report-*.json | jq '.summary.byLevel.error'

# List failing pages
cat ci-reports/pally-report-*.json | jq '.pages[] | select(.issueCount > 0) | .url'

# List template issues
cat ci-reports/pally-report-*.json | jq '.templateIssues[] | .code + " (" + (.affectedPageCount | tostring) + " pages)"'
```

---

## Webhook notifications

Pipe reports to external systems post-scan:

```bash
# Post summary to Slack
pally-agent scan https://example.com --format json --output /tmp/reports
ISSUES=$(cat /tmp/reports/pally-report-*.json | jq '.summary.totalIssues')
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-type: application/json' \
  --data "{\"text\": \"Accessibility scan: $ISSUES issues found on example.com\"}"
```

---

## Config for CI

Create a dedicated config for CI scans:

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

```bash
pally-agent scan https://staging.example.com --config ./ci/.pally-agent.json
```

---

## Docker in CI

If your CI environment supports Docker:

```yaml
services:
  pa11y-webservice:
    image: pally/webservice:latest
    ports: ['3000:3000']

  pally-compliance:
    image: your-registry/pally-compliance:latest
    ports: ['4000:4000']
    environment:
      COMPLIANCE_DB_PATH: /data/compliance.db
```

---

*See also: [configuration/core.md](../configuration/core.md) | [guides/scanning.md](scanning.md) | [guides/compliance-check.md](compliance-check.md)*
