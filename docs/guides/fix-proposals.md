[Docs](../README.md) > [Guides](./) > Fix Proposals

# Fix Proposals Guide

How to generate and apply auto-fix proposals for accessibility issues.

---

## Overview

Pally-agent can generate code fixes for common accessibility issues. It reads the scan report, maps issues to your source files, and produces `oldText` / `newText` pairs — unified diffs you can review and apply.

**Fix proposals are never applied without explicit confirmation.** You review each one before it is applied.

---

## Auto-fixable patterns

| Issue | WCAG rule | Fix applied |
|-------|-----------|-------------|
| `<img>` missing `alt` | `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37` | Adds `alt=""` (decorative) — you write the description |
| `<input>` missing label | `WCAG2AA.Principle1.Guideline1_3.1_3_1.F68` | Adds `aria-label` attribute |
| `<html>` missing `lang` | `WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2` | Adds `lang="en"` |
| Empty link text | `WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.A.NoContent` | Flagged for human review |
| Missing heading hierarchy | `WCAG2AA.Principle1.Guideline1_3.1_3_1` | Flagged with recommendation |

Issues requiring human judgement (empty link text, colour contrast, keyboard navigation, ARIA roles) appear in the `unfixable` count with a textual `fixSuggestion` but no code diff.

---

## Interactive CLI fix flow

### Step 1: Scan (or load an existing report)

```bash
# Scan and get fixes in one step
pally-agent fix https://example.com --repo ./my-project

# Or load an existing report to skip re-scanning
pally-agent fix --from-report ./pally-reports/pally-report-2026-03-18T120000Z.json \
  --repo ./my-project
```

### Step 2: Review each fix interactively

For each proposed fix, you see:

```
File: app/about/page.tsx (line 24)
Issue: WCAG2AA.Principle1.Guideline1_1.1_1_1.H37
Description: img element missing alt attribute
Confidence: high
Apply fix? [y]es / [n]o / [s]how diff / [a]bort all:
```

| Key | Action |
|-----|--------|
| `y` | Apply the fix immediately, move to the next |
| `n` | Skip this fix, move to the next |
| `s` | Print a unified diff, then prompt again |
| `a` | Stop processing all remaining fixes |

Already-applied fixes are **not rolled back** if you abort.

---

## MCP fix flow (Claude Code)

In MCP mode, proposal and application are separate steps — the agent shows you the changes before applying them.

### Step 1: Get proposals

```
// Claude calls:
pally_propose_fixes({ reportPath: "./pally-reports/report.json", repoPath: "/path/to/project" })

// Returns:
{
  "fixable": 5,
  "unfixable": 2,
  "fixes": [
    {
      "file": "/path/to/project/app/about/page.tsx",
      "line": 24,
      "issue": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
      "description": "img element missing alt attribute",
      "oldText": "<img src=\"/hero.jpg\">",
      "newText": "<img alt=\"\" src=\"/hero.jpg\">",
      "confidence": "high"
    }
  ]
}
```

### Step 2: Review and apply

Claude presents each fix and waits for your confirmation:

```
Fix 1 of 5: app/about/page.tsx (line 24)
  img element missing alt attribute
  Before: <img src="/hero.jpg">
  After:  <img alt="" src="/hero.jpg">
  Confidence: high

Shall I apply this fix?
```

After confirmation, Claude calls `pally_apply_fix` for each approved fix.

### Step 3: Verify

```
// Scan again to confirm fixes resolved the issues
pally_scan({ url: "https://example.com" })
```

---

## Confidence levels

| Level | Meaning |
|-------|---------|
| `high` | Unique element match found in source — line number is reliable |
| `low` | Multiple candidates matched — file is correct, line number may not be |

Fix proposals are generated for any confidence level. With `low` confidence, review the diff carefully before applying.

---

## What requires human judgement

These issues are flagged but not auto-fixed:

| Issue | Why |
|-------|-----|
| Empty link text | Correct text depends on context and purpose |
| Missing heading hierarchy | Restructuring headings may affect page design |
| Colour contrast | Requires design decisions |
| Keyboard navigation | Often requires JavaScript changes or structural rework |
| ARIA roles | Incorrect ARIA usage may need architectural fixes |

These appear in the `unfixable` count with a textual `fixSuggestion` describing what needs to be done.

---

## Source mapping prerequisites

Fix proposals require `--repo <path>` pointing to your source repository. Without it, pally-agent cannot map issues to source files.

Supported frameworks:

| Framework | Detection markers |
|-----------|------------------|
| Next.js (App Router) | `app/` + `next.config.*` |
| Next.js (Pages Router) | `pages/` + `next.config.*` |
| Nuxt | `nuxt.config.*` |
| SvelteKit | `svelte.config.*` + `src/routes/` |
| Angular | `angular.json` |
| Plain HTML | `index.html` in root |

For monorepos, point `--repo` at the specific app directory, not the monorepo root.

---

*See also: [guides/scanning.md](scanning.md) | [guides/reports.md](reports.md) | [integrations/claude-code.md](../integrations/claude-code.md)*
