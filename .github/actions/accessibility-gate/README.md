# Luqen Accessibility Gate — Composite Action

A composite GitHub Action that runs the Luqen accessibility scan against a URL,
diffs the findings against a committed baseline, and posts a single sticky PR
comment summarising new vs fixed findings — each new finding annotated with its
WCAG criterion and jurisdiction context.

## Usage

```yaml
# .github/workflows/accessibility-gate.yml

name: Accessibility gate

on:
  pull_request:

permissions:
  pull-requests: write    # Required to post/update the sticky PR comment

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: ./github/actions/accessibility-gate   # path reference (in-repo)
        with:
          url: 'https://staging.example.com'
          baseline-path: '.luqen/baseline.json'
          fail-on: 'new'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `url` | Yes | — | URL of the site to scan |
| `baseline-path` | No | `.luqen/baseline.json` | Path to the committed baseline JSON file |
| `fail-on` | No | `new` | Gate failure mode: `new` (fail only when there are new findings), `none` (report only, always succeed), `all` (fail if any error-level finding exists regardless of baseline) |
| `min-severity` | No | `error` | Minimum finding severity that counts toward the gate: `error` or `warning`. Notices never fail the gate. |
| `compliance-url` | No | `''` | URL of the Luqen compliance service; when set, each new finding in the PR comment is annotated with its WCAG criterion and jurisdiction context |
| `github-token` | Yes | — | GitHub token with `pull-requests: write` scope. Use `secrets.GITHUB_TOKEN`. |

## PR Check Status

The Action's check status follows the same `--fail-on` semantics as the CLI:

| `--fail-on` | Exit condition | PR check |
|-------------|---------------|----------|
| `new` (default) | new findings > 0 | Fail |
| `new` | new findings = 0 | Pass |
| `none` | always | Pass |
| `all` | any error-level finding | Fail |
| infra error (any mode) | scan/baseline unavailable | Fail |

## PR Comment

The Action posts a single sticky PR comment identified by the `<!-- luqen-gate -->` HTML
marker. On every run the same comment is updated (never duplicated). The comment includes:

- A counts table: New findings / Fixed findings / Unchanged
- A disclaimer: *Not legal advice. This report identifies new accessibility findings vs
  the stored baseline. A zero-new result does not assert conformance.*
- A collapsible section for new findings, each row showing: Severity, WCAG criterion,
  Selector, Finding message, and Jurisdiction context (when `compliance-url` is set)
- A collapsible section for fixed findings
- On a clean run (zero new): a "No new findings vs baseline." headline

## Permissions

The workflow job that uses this Action requires:

```yaml
permissions:
  pull-requests: write
```

Without this permission the comment step will be skipped with a `::warning::` message
(the gate scan still runs and the PR check reflects the gate result).

## Fork PRs

For pull requests from forks, `GITHUB_TOKEN` is read-only by default. The Action detects
a 403 response from the GitHub API and downgrades to a `::warning::` — the comment is
not posted, but the build is not failed. The PR check status is still set correctly.

To enable PR comments from forks, use a workflow with `pull_request_target` (be aware of
the [security implications](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/))
or a repository secret with a PAT that has `pull-requests: write`.

## Baseline Management

Create or update a baseline:

```bash
npx luqen scan https://example.com --update-baseline --baseline .luqen/baseline.json
```

Commit the resulting `.luqen/baseline.json` file to the repository. The Action reads it
read-only during gate runs; it is never automatically updated.
