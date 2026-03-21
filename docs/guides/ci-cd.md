[Docs](../README.md) > [Guides](../README.md#how-to-guides) > CI/CD Integration Guide

# CI/CD Integration Guide

How to integrate pally-agent into your continuous integration and deployment pipelines.

---

## Exit codes

Pally-agent uses exit codes to signal scan results to pipeline runners:

| Code | Meaning | Pipeline action |
|------|---------|-----------------|
| `0` | No accessibility issues found | Pass the build |
| `1` | Accessibility issues found (scan completed successfully) | Fail the build (if fail-on-violations is enabled) |
| `2` | Partial failure — some pages could not be scanned | Fail the build (unreliable result) |
| `3` | Fatal error — scan could not run at all | Fail the build (infrastructure problem) |

In most pipelines, exit code `0` passes and anything else fails. This means pally-agent will fail your pipeline whenever accessibility issues are found — which is the desired behaviour for a quality gate.

---

## Basic pipeline usage

### Minimal example

```bash
pally-agent scan https://staging.example.com --standard WCAG2AA --format json
```

If any issues are found, the command exits with code `1` and the pipeline step fails.

### With compliance gate

```bash
pally-agent scan https://staging.example.com \
  --standard WCAG2AA \
  --format json \
  --compliance-url https://compliance.internal:4100 \
  --jurisdictions EU,US \
  --compliance-client-id $COMPLIANCE_CLIENT_ID \
  --compliance-client-secret $COMPLIANCE_CLIENT_SECRET
```

This adds legal compliance data to the report. The exit code is still based on whether any issues were found (not on compliance status). To fail only on mandatory compliance violations, parse the JSON report (see [Compliance gate](#compliance-gate) below).

---

## GitHub Actions

```yaml
name: Accessibility Check

on:
  pull_request:
    branches: [develop, master]
  schedule:
    - cron: '0 6 * * 1'  # Weekly Monday 06:00 UTC

jobs:
  a11y-scan:
    runs-on: ubuntu-latest
    services:
      pa11y:
        image: pally/webservice:latest
        ports:
          - 3000:3000

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install pally-agent
        run: |
          git clone https://github.com/alanna82/pally-agent.git /tmp/pally-agent
          cd /tmp/pally-agent
          npm install
          npm run build:all
          cd packages/core && npm link

      - name: Run accessibility scan
        env:
          PALLY_WEBSERVICE_URL: http://localhost:3000
        run: |
          pally-agent scan ${{ vars.STAGING_URL }} \
            --standard WCAG2AA \
            --format both \
            --output ./a11y-reports

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: accessibility-report
          path: ./a11y-reports/
          retention-days: 30
```

### With compliance enrichment

Add a compliance service container and pass credentials:

```yaml
    services:
      pa11y:
        image: pally/webservice:latest
        ports:
          - 3000:3000

    steps:
      # ... checkout, setup, install steps ...

      - name: Run accessibility scan with compliance
        env:
          PALLY_WEBSERVICE_URL: http://localhost:3000
        run: |
          pally-agent scan ${{ vars.STAGING_URL }} \
            --standard WCAG2AA \
            --format json \
            --compliance-url ${{ vars.COMPLIANCE_URL }} \
            --jurisdictions EU,US,UK \
            --compliance-client-id ${{ secrets.COMPLIANCE_CLIENT_ID }} \
            --compliance-client-secret ${{ secrets.COMPLIANCE_CLIENT_SECRET }}
```

---

## Azure DevOps

```yaml
trigger:
  branches:
    include:
      - develop
      - master

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: |
      git clone https://github.com/alanna82/pally-agent.git $(Agent.TempDirectory)/pally-agent
      cd $(Agent.TempDirectory)/pally-agent
      npm install
      npm run build:all
      cd packages/core && npm link
    displayName: 'Install pally-agent'

  - script: |
      docker run -d --name pa11y -p 3000:3000 pally/webservice:latest
      sleep 5
    displayName: 'Start pa11y webservice'

  - script: |
      pally-agent scan $(STAGING_URL) \
        --standard WCAG2AA \
        --format both \
        --output $(Build.ArtifactStagingDirectory)/a11y-reports
    env:
      PALLY_WEBSERVICE_URL: http://localhost:3000
    displayName: 'Run accessibility scan'

  - task: PublishBuildArtifacts@1
    condition: always()
    inputs:
      pathToPublish: $(Build.ArtifactStagingDirectory)/a11y-reports
      artifactName: accessibility-report
```

---

## GitLab CI

```yaml
a11y-scan:
  stage: test
  image: node:20
  services:
    - name: pally/webservice:latest
      alias: pa11y

  variables:
    PALLY_WEBSERVICE_URL: http://pa11y:3000

  before_script:
    - git clone https://github.com/alanna82/pally-agent.git /tmp/pally-agent
    - cd /tmp/pally-agent && npm install && npm run build:all
    - cd packages/core && npm link

  script:
    - pally-agent scan $STAGING_URL
        --standard WCAG2AA
        --format both
        --output ./a11y-reports

  artifacts:
    when: always
    paths:
      - ./a11y-reports/
    expire_in: 30 days

  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_PIPELINE_SOURCE == "schedule"
```

---

## Compliance gate

To fail the pipeline only when **mandatory compliance violations** exist (rather than on any issue), parse the JSON report:

```bash
#!/bin/bash
# compliance-gate.sh — exit 1 only if mandatory violations exist

REPORT=$(ls -t ./a11y-reports/*.json | head -1)

if [ -z "$REPORT" ]; then
  echo "No report found"
  exit 3
fi

CONFIRMED=$(jq -r '.compliance.summary.totalConfirmedViolations // 0' "$REPORT")

if [ "$CONFIRMED" -gt 0 ]; then
  echo "FAIL: $CONFIRMED mandatory compliance violation(s) found"
  jq -r '.compliance.matrix | to_entries[] | select(.value.confirmedViolations > 0) | "\(.value.jurisdictionName): \(.value.confirmedViolations) violation(s)"' "$REPORT"
  exit 1
else
  echo "PASS: No mandatory compliance violations"
  exit 0
fi
```

Use this script as a separate pipeline step after the scan:

```yaml
      - name: Run scan
        run: pally-agent scan $URL --format json --compliance-url $COMPLIANCE_URL --jurisdictions EU,US
        continue-on-error: true  # Don't fail on issues alone

      - name: Compliance gate
        run: bash ./scripts/compliance-gate.sh
```

---

## JSON output for pipeline processing

The JSON report is designed for machine consumption. Key fields for pipeline processing:

```bash
# Total issues by severity
jq '.summary.byLevel' report.json
# → { "error": 8, "warning": 15, "notice": 24 }

# Exit code equivalent
jq '.summary.totalIssues' report.json
# → 47 (if > 0, the scan found issues)

# Failing jurisdictions
jq '[.compliance.matrix | to_entries[] | select(.value.status == "fail") | .value.jurisdictionName]' report.json
# → ["European Union", "United States"]

# Confirmed mandatory violations
jq '.compliance.summary.totalConfirmedViolations' report.json
# → 5

# Pages with most issues (top 5)
jq '[.pages | sort_by(-.issueCount) | limit(5;.[]) | {url, issueCount}]' report.json
```

---

## Scheduled scanning

Run scans on a schedule to catch regressions and track compliance over time:

### GitHub Actions schedule

```yaml
on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday at 06:00 UTC
```

### Azure DevOps schedule

```yaml
schedules:
  - cron: '0 6 * * 1'
    displayName: Weekly a11y scan
    branches:
      include: [master]
    always: true
```

### GitLab CI schedule

Configure in **Settings > CI/CD > Pipeline schedules** via the GitLab UI.

### Dashboard scheduled scans

The dashboard can be configured to run periodic scans through its webhook integration. Set up an external scheduler (cron, Azure Logic Apps, etc.) to POST to the scan endpoint.

---

## Best practices

1. **Scan staging, not production** — scan your staging environment so you catch issues before deployment.

2. **Start permissive, tighten over time** — begin by logging results without failing the build, then enable fail-on-violations once you have addressed the initial backlog.

3. **Use `--format both`** — generate both JSON (for machine processing) and HTML (for developer review). Upload both as pipeline artifacts.

4. **Pin the WCAG standard** — always specify `--standard WCAG2AA` explicitly rather than relying on the default. This prevents surprises if the default changes.

5. **Cache the pally-agent installation** — clone and build once, then cache the `node_modules` and `dist` directories to speed up subsequent pipeline runs.

6. **Archive reports** — keep reports for at least 30 days so you can compare results over time and demonstrate compliance progress.

7. **Separate scan and gate** — run the scan with `continue-on-error: true`, then use a separate compliance gate step. This ensures the report is always uploaded as an artifact even when the gate fails.

---

*See also: [scanning.md](scanning.md) | [compliance-check.md](compliance-check.md) | [reports.md](reports.md)*
