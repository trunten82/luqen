[Docs](README.md) > User Guide

# User Guide

A plain-language guide to understanding and using pally-agent.

---

## What pally-agent does

Pally-agent visits every page on your website and checks each one for accessibility problems — things that make a site difficult or impossible to use for people with disabilities. It then tells you:

1. **What problems exist** — each issue is described in plain language with the HTML it came from.
2. **Where in your code the problem lives** — if you provide your source code, pally-agent points to the specific file and line.
3. **What fix to apply** — for common problems, it generates a code diff you can apply with a single keypress.
4. **Which laws require you to fix it** — the compliance service tells you whether each issue is a legal obligation in the EU, US, UK, or 55 other jurisdictions.

---

## How accessibility scanning works

Pally-agent uses a tool called **pa11y**, which controls a headless browser to load each page and run automated accessibility checks based on WCAG (Web Content Accessibility Guidelines).

**Discovery:** Before scanning, pally-agent reads your site's `sitemap.xml` to find all pages. If there is no sitemap, it crawls the site by following links. You can also combine both methods with `--also-crawl`.

**Scanning:** Each page is loaded in the browser, and pa11y checks it against the WCAG standard you choose (WCAG 2.1 AA is the legal standard in most jurisdictions).

**Reporting:** Results are saved as a timestamped JSON file and, optionally, a self-contained HTML file you can open in any browser.

---

## Understanding scan results

### Issue types

| Type | What it means |
|------|---------------|
| **Error** | A confirmed accessibility violation. The element fails a WCAG success criterion. This is the one to fix first. |
| **Warning** | A potential issue that requires human judgement to confirm. The automated check flagged it but cannot be certain. |
| **Notice** | Informational. Draws your attention to something worth checking manually — not a confirmed violation. |

**Errors are confirmed violations.** Warnings and notices are flagged for review. The compliance matrix only counts errors as mandatory violations — warnings and notices are never treated as legal failures.

### What WCAG rule codes mean

Each issue has a code like `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37`. Breaking it down:

- `WCAG2AA` — the standard being tested
- `Principle1` — Perceivable (one of four WCAG principles)
- `Guideline1_1` — Text Alternatives
- `1_1_1` — Success Criterion 1.1.1 "Non-text Content"
- `H37` — the specific technique being checked (img alt attribute)

Reports link every criterion to the W3C's explanation page so you can read the full requirement.

---

## Understanding the compliance matrix

When you run a compliance-enriched scan, the report shows a per-jurisdiction table:

| Jurisdiction | Status | Mandatory violations |
|--------------|--------|---------------------|
| EU | FAIL | 3 |
| US | FAIL | 3 |
| UK | PASS | 0 |

**FAIL** means the site has confirmed WCAG errors that a specific law in that jurisdiction requires you to fix. **PASS** means no confirmed errors violate any mandatory requirement in that jurisdiction.

Each issue in the report shows regulation badges (e.g. `EAA`, `ADA`) linking to the official legal text. Click a badge to read the regulation.

**Jurisdiction inheritance:** Checking Germany (`DE`) automatically includes EU-level regulations (EAA, WAD) in addition to Germany-specific ones (BITV 2.0). You don't need to add `EU` separately when checking a member state.

---

## Template issues

Many pages share the same header, footer, or navigation. If a shared component has an accessibility problem, it appears identically on every page — a single missing `alt` attribute on a logo could show up 50 times across a large site.

Pally-agent detects this: any issue appearing on 3 or more pages with the same selector and context is moved to a **Template & Layout Issues** section. The entry shows how many pages are affected. Fix it once in the shared component and all occurrences resolve.

This deduplication removes approximately 84% of duplicate noise on typical sites.

---

## Common WCAG issues and how to fix them

### Missing image alt text (1.1.1)

**Problem:** `<img src="logo.svg">` — no `alt` attribute.

**Fix:** Add `alt=""` for decorative images, or descriptive text for informative ones:
```html
<img src="logo.svg" alt="Company logo">
<img src="divider.svg" alt="">   <!-- decorative: empty alt -->
```

### Unlabelled form inputs (1.3.1, 4.1.2)

**Problem:** An `<input>` has no associated `<label>`.

**Fix:**
```html
<label for="email">Email address</label>
<input id="email" type="email">
```
Or use `aria-label` when a visible label is not appropriate:
```html
<input type="search" aria-label="Search the site">
```

### Missing page language (3.1.1)

**Problem:** `<html>` has no `lang` attribute.

**Fix:** `<html lang="en">`

### Insufficient colour contrast (1.4.3)

**Problem:** Text colour does not contrast enough with the background. Minimum ratio: 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold).

**Fix:** Use a contrast checker tool and adjust the text or background colour until the ratio meets the threshold.

### Empty link text (4.1.2)

**Problem:** `<a href="..."><img src="icon.svg"></a>` — the link has no text alternative.

**Fix:** Add `aria-label` to the link or `alt` to the image:
```html
<a href="/home" aria-label="Go to home page"><img src="icon.svg" alt=""></a>
```

---

## Using the dashboard

The dashboard provides a browser interface for starting scans, watching progress live, and browsing reports — without using the command line.

Start it with Docker Compose from the monorepo root:

```bash
export DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)"
docker compose up -d
```

Open `http://localhost:5000` and log in with a compliance service user account.

For a complete reference, see [guides/dashboard-admin.md](guides/dashboard-admin.md).

---

## What pally-agent cannot check automatically

Automated tools catch approximately 30–40% of accessibility issues. Things that require human review:

- **Meaningful alt text** — `alt=""` removes the error, but a human must write the correct description.
- **Reading order** — whether content appears in a logical sequence when read by a screen reader.
- **Focus indicators** — whether keyboard focus is visible and obvious.
- **Cognitive accessibility** — plain language, consistent navigation, error prevention.
- **Complex interactions** — carousels, drag-and-drop, custom widgets.

Use pally-agent to find and fix the issues it can confirm automatically, then do a manual review for the rest.

---

*See also: [QUICKSTART.md](QUICKSTART.md) | [guides/scanning.md](guides/scanning.md) | [guides/compliance-check.md](guides/compliance-check.md) | [guides/reports.md](guides/reports.md)*
