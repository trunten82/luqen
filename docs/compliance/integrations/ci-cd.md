# CI/CD Integration

Run accessibility compliance checks in CI/CD pipelines to block deployments when mandatory legal violations are found.

## Overview

The compliance check can be integrated into any CI/CD pipeline that supports shell scripts or HTTP requests. The core pattern is:

1. Run a pa11y scan
2. Feed the issues to `POST /compliance/check`
3. Exit non-zero if mandatory violations exist (blocks the pipeline)

## Exit code strategy

| Exit code | Meaning |
|-----------|---------|
| `0` | No mandatory violations — pipeline proceeds |
| `1` | Mandatory violations found — pipeline fails |
| `2` | Compliance service unreachable or scan failed |

## Shell script

`scripts/compliance-check.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Configuration
COMPLIANCE_URL="${COMPLIANCE_URL:-http://localhost:4000}"
COMPLIANCE_CLIENT_ID="${COMPLIANCE_CLIENT_ID:?COMPLIANCE_CLIENT_ID is required}"
COMPLIANCE_CLIENT_SECRET="${COMPLIANCE_CLIENT_SECRET:?COMPLIANCE_CLIENT_SECRET is required}"
TARGET_URL="${1:?Usage: $0 <target-url>}"
JURISDICTIONS="${JURISDICTIONS:-EU,US,UK}"

echo "=== Pally Compliance Check ==="
echo "Target: $TARGET_URL"
echo "Jurisdictions: $JURISDICTIONS"

# Step 1: Obtain access token
echo "Obtaining access token..."
TOKEN_RESPONSE=$(curl -sf -X POST "$COMPLIANCE_URL/api/v1/oauth/token" \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"$COMPLIANCE_CLIENT_ID\",\"client_secret\":\"$COMPLIANCE_CLIENT_SECRET\",\"scope\":\"read\"}" \
  2>/dev/null) || {
  echo "ERROR: Could not connect to compliance service at $COMPLIANCE_URL" >&2
  exit 2
}

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')
if [ "$ACCESS_TOKEN" = "null" ] || [ -z "$ACCESS_TOKEN" ]; then
  echo "ERROR: Failed to obtain access token" >&2
  echo "$TOKEN_RESPONSE" >&2
  exit 2
fi

# Step 2: Run pa11y scan (requires pa11y-ci or pa11y CLI)
echo "Running accessibility scan..."
PA11Y_OUTPUT=$(pa11y "$TARGET_URL" --reporter json 2>/dev/null) || true
ISSUES=$(echo "$PA11Y_OUTPUT" | jq '[.[] | {code:.code,type:.type,message:.message,selector:.selector,context:.context}]' 2>/dev/null || echo "[]")
ISSUE_COUNT=$(echo "$ISSUES" | jq 'length')
echo "Found $ISSUE_COUNT accessibility issues"

if [ "$ISSUE_COUNT" = "0" ]; then
  echo "No accessibility issues found. Compliance check skipped."
  exit 0
fi

# Step 3: Check compliance
echo "Checking compliance..."
JURISDICTIONS_JSON=$(echo "$JURISDICTIONS" | jq -Rc 'split(",")')

COMPLIANCE_RESULT=$(curl -sf -X POST "$COMPLIANCE_URL/api/v1/compliance/check" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jurisdictions\":$JURISDICTIONS_JSON,\"issues\":$ISSUES}" \
  2>/dev/null) || {
  echo "ERROR: Compliance check request failed" >&2
  exit 2
}

# Step 4: Parse results
FAILING=$(echo "$COMPLIANCE_RESULT" | jq '.summary.failing')
MANDATORY_VIOLATIONS=$(echo "$COMPLIANCE_RESULT" | jq '.summary.totalMandatoryViolations')
PASSING=$(echo "$COMPLIANCE_RESULT" | jq '.summary.passing')
TOTAL=$(echo "$COMPLIANCE_RESULT" | jq '.summary.totalJurisdictions')

echo ""
echo "=== Compliance Results ==="
echo "Jurisdictions: $PASSING/$TOTAL passing"
echo "Mandatory violations: $MANDATORY_VIOLATIONS"

# Step 5: Print per-jurisdiction summary
echo ""
echo "=== Per-Jurisdiction Breakdown ==="
echo "$COMPLIANCE_RESULT" | jq -r '
  .matrix | to_entries[] |
  "  \(.value.jurisdictionId): \(.value.status | ascii_upcase) " +
  "(mandatory: \(.value.mandatoryViolations), recommended: \(.value.recommendedViolations))"
'

# Step 6: Print affected regulations if failing
if [ "$FAILING" -gt 0 ]; then
  echo ""
  echo "=== Failing Regulations ==="
  echo "$COMPLIANCE_RESULT" | jq -r '
    .matrix | to_entries[] |
    select(.value.status == "fail") |
    .value.regulations[] |
    select(.status == "fail") |
    "  \(.shortName) (\(.regulationId)): \(.violations | length) criteria violated"
  '
fi

# Step 7: Save report
echo "$COMPLIANCE_RESULT" > compliance-report.json
echo ""
echo "Full report saved to: compliance-report.json"

# Step 8: Exit code
if [ "$MANDATORY_VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "FAIL: $MANDATORY_VIOLATIONS mandatory violations found across $FAILING jurisdiction(s)."
  exit 1
else
  echo ""
  echo "PASS: No mandatory violations found."
  exit 0
fi
```

Make it executable:
```bash
chmod +x scripts/compliance-check.sh
```

## GitHub Actions

`.github/workflows/compliance.yml`:

```yaml
name: Accessibility Compliance Check

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop]
  schedule:
    # Run weekly on Mondays at 9am UTC
    - cron: '0 9 * * 1'

jobs:
  compliance-check:
    runs-on: ubuntu-latest
    name: Check accessibility compliance

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install pa11y
        run: npm install -g pa11y

      - name: Install jq
        run: sudo apt-get install -y jq

      - name: Run compliance check
        env:
          COMPLIANCE_URL: ${{ vars.COMPLIANCE_URL }}
          COMPLIANCE_CLIENT_ID: ${{ secrets.COMPLIANCE_CLIENT_ID }}
          COMPLIANCE_CLIENT_SECRET: ${{ secrets.COMPLIANCE_CLIENT_SECRET }}
          JURISDICTIONS: "EU,US,UK"
          TARGET_URL: ${{ vars.TARGET_URL || 'https://staging.example.com' }}
        run: |
          bash scripts/compliance-check.sh "$TARGET_URL"

      - name: Upload compliance report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: compliance-report
          path: compliance-report.json
          retention-days: 30

      - name: Comment PR with results
        if: github.event_name == 'pull_request' && always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            let report;
            try {
              report = JSON.parse(fs.readFileSync('compliance-report.json', 'utf-8'));
            } catch {
              await github.rest.issues.createComment({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                body: '⚠️ Compliance check could not complete. Check the workflow logs.'
              });
              return;
            }

            const { summary, matrix } = report;
            const status = summary.failing > 0 ? '❌ FAILING' : '✅ PASSING';
            const rows = Object.values(matrix).map(j =>
              `| ${j.jurisdictionId} | ${j.status === 'fail' ? '❌' : '✅'} | ${j.mandatoryViolations} | ${j.recommendedViolations} |`
            ).join('\n');

            const body = `## Accessibility Compliance Check ${status}

            **Summary:** ${summary.passing}/${summary.totalJurisdictions} jurisdictions passing
            **Mandatory violations:** ${summary.totalMandatoryViolations}

            | Jurisdiction | Status | Mandatory | Recommended |
            |---|---|---|---|
            ${rows}

            ${summary.failing > 0 ? '> This PR has mandatory compliance violations. Fix them before merging.' : '> All jurisdiction checks pass.'}
            `;

            await github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body
            });
```

### Required secrets and variables

In GitHub repository settings, add:

**Secrets:**
- `COMPLIANCE_CLIENT_ID` — OAuth client ID
- `COMPLIANCE_CLIENT_SECRET` — OAuth client secret

**Variables:**
- `COMPLIANCE_URL` — `https://compliance.example.com`
- `TARGET_URL` — `https://staging.example.com` (URL to check)

## Interpreting results

### Exit codes

```bash
./scripts/compliance-check.sh https://example.com
echo "Exit code: $?"
# 0 = pass, 1 = mandatory violations, 2 = service/scan error
```

### JSON output format

The `compliance-report.json` artifact contains the full `ComplianceCheckResponse`:

```json
{
  "matrix": {
    "EU": {
      "status": "fail",
      "mandatoryViolations": 3,
      "regulations": [...]
    }
  },
  "annotatedIssues": [...],
  "summary": {
    "totalJurisdictions": 3,
    "passing": 1,
    "failing": 2,
    "totalMandatoryViolations": 5,
    "totalOptionalViolations": 0
  }
}
```

### Filtering by sector in CI

For e-commerce sites, you may want to fail only on regulations that apply to e-commerce:

```bash
curl -X POST "$COMPLIANCE_URL/api/v1/compliance/check" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jurisdictions": ["EU", "US"],
    "issues": '"$ISSUES"',
    "sectors": ["e-commerce", "digital"]
  }'
```

### Blocking vs. warning

For initial rollout, you may want to warn rather than block. Use exit code 0 while still printing violations:

```bash
# Replace the final exit logic in the script:
if [ "$MANDATORY_VIOLATIONS" -gt 0 ]; then
  echo "WARNING: $MANDATORY_VIOLATIONS mandatory violations found."
  echo "These will block the pipeline starting $ENFORCEMENT_DATE."
  # exit 0 instead of exit 1 — warning only
fi
```

Gradually change to `exit 1` once the team has had time to fix violations.

## Caching tokens between steps

If your CI pipeline runs multiple compliance checks, cache the token to avoid repeated round-trips:

```bash
# Fetch token once and save to file
curl -sf -X POST "$COMPLIANCE_URL/api/v1/oauth/token" \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"$COMPLIANCE_CLIENT_ID\",\"client_secret\":\"$COMPLIANCE_CLIENT_SECRET\",\"scope\":\"read\"}" \
  | jq -r '.access_token' > /tmp/compliance-token.txt

# Use in subsequent steps
ACCESS_TOKEN=$(cat /tmp/compliance-token.txt)
```

Tokens expire after 1 hour (configurable). For pipelines longer than 1 hour, refresh the token as needed.
