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

**Scanning:** Each page is loaded in the browser, and pa11y checks it against the WCAG standard you choose (WCAG 2.1 AA is the legal standard in most jurisdictions). You can select the test runner — HTML_CodeSniffer (default) or axe-core — via the `--runner` flag, `DASHBOARD_SCANNER_RUNNER` env var, or the scan form dropdown.

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

Pally-agent detects this: any issue appearing on 3 or more pages with the same selector and context is deduplicated and grouped by **inferred component**. The system analyses selectors, DOM context, and page positions to assign each template issue to a named component — Navigation, Footer, Cookie Banner, Form, Header, or a general Layout group. Each component group shows its affected page count and severity breakdown.

In the dashboard, template issues appear in a dedicated **Templates** tab (only visible on full-site scans). Fix an issue once in the shared component and all occurrences resolve across the site.

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

Open `http://localhost:5000` and log in with a Dashboard User account (or an API key in solo mode).

### Scan scheduling

The dashboard supports recurring scans. From the scan form, enable **Schedule** and choose a frequency:

- **Daily** — runs at the configured time each day
- **Weekly** — runs on a chosen day of the week
- **Monthly** — runs on a chosen day of the month

Scheduled scans use the same settings (URL, standard, jurisdictions, runner) as the original scan. View and manage schedules from **Settings > Schedules** in the sidebar.

### Teams

Teams let you organise dashboard users into groups for issue assignment and collaboration. Manage teams at **Admin > Teams**:

- **Create a team** — give it a name and optional description.
- **Add/remove members** — use the user picker dropdown to add members; click **Remove** to take them off the team.
- **IdP group mapping** — when using SSO (e.g., Azure Entra ID), map IdP groups to dashboard teams so membership stays in sync with your identity provider.

Teams appear in the assignee picker when assigning issues, so you can assign work to a team rather than an individual.

### Issue assignments

Each issue in a report can be assigned to a user or team and tracked through a lifecycle:

| Status | Meaning |
|--------|---------|
| **Open** | New issue, not yet assigned |
| **Assigned** | Assigned to a user or team |
| **In Progress** | Developer is working on the fix |
| **Fixed** | Fix applied, awaiting verification |
| **Verified** | Re-scanned and confirmed resolved |

**Assigning from the Issues tab:** Each unassigned issue group has an **Assign** button that opens a user/team picker dropdown. Once assigned, the button is replaced by an **assigned badge** showing the assignee. Click the badge and confirm to unassign. Assigned items cannot be re-assigned — no picker or checkbox appears on them.

**Bulk assign (Issues tab):** Click the **Bulk Assign** toggle to enter bulk mode. Checkboxes appear on unassigned groups only. Use **Select All Visible** or pick individual groups, choose an assignee from the user/team picker (required), and click **Assign**. The page reloads after completion.

**Assignments page:** Each assignment card has **Save** and **Remove** buttons. Enter **Bulk Actions** mode to select multiple cards for bulk reassign (pick a new user/team) or bulk remove (with confirmation). The page reloads after bulk actions.

**Roles:** Admin, Developer, and User roles can manage assignments; the Executive role has read-only access.

### Connected repositories

Link GitHub or GitLab repositories under **Settings > Connected Repos**. When a scan completes, pally-agent analyses the issues against connected repo source files and generates fix proposals (up to 21 suggestion types) via MCP/A2A integration. View proposals in the report under the **Fixes** tab or at `/admin/proposals`.

### Role-based experience

The dashboard adapts its navigation and default views based on the user's role and permissions. Four default roles are provided, and admins can create custom roles with any combination of 15 granular permissions via **Admin > Roles**:

| Role | Default view | Tailored experience |
|------|-------------|---------------------|
| **Admin** | System overview | Full settings, user management, role management, connected repos |
| **Developer** | Issue list | Fix proposals, code diffs, assignment queue |
| **User** | Report list | Scan creation, report browsing, manual testing |
| **Executive** | Org score dashboard | Aggregated score, trends, compliance summary |

> **Dashboard Users vs API Users (Compliance):** Dashboard Users log in to the web UI and are managed at `/admin/users`. API Users are accounts on the compliance service for direct API access, managed via `pally-compliance users create`. These are separate user stores.

### Scan modes

The scan form offers two modes:

- **Single Page** (default) — scans only the URL you enter. Fastest option for checking a single page.
- **Full Site** — discovers all pages via sitemap/crawl and scans each one. Enables template issue detection and the Templates tab.

The scan form also offers:

- **Runner** dropdown — choose between HTML_CodeSniffer (`htmlcs`) and axe-core (`axe`) test runners.
- **Incremental scan** checkbox — when enabled, pally-agent computes a SHA-256 content hash for each page and only re-scans pages whose content has changed since the last scan. Unchanged pages reuse their previous results. This is tracked in a `page_hashes` database table.

### Report layout

Reports use a tabbed layout with a **summary bar** at the top showing total errors, warnings, and notices. The tabs are:

- **Compliance** — jurisdiction cards showing the number of WCAG criteria violated per jurisdiction. Each card links to the relevant regulations. Only appears when jurisdictions were selected for the scan.
- **Issues** — all issues grouped by WCAG criterion (e.g. "1.1.1 Non-text Content"). Each criterion group shows a severity breakdown (error/warning/notice counts). The WCAG standard displays as "WCAG 2.1 Level AA" rather than a raw code.
- **Templates** — issues grouped by inferred component (Navigation, Footer, Cookie Banner, Form, etc.) with affected page counts. This tab only appears on full-site scans where template issues were detected.
- **Pages** — per-page issue list for full-site scans.

### Filtering issues

The Issues tab provides a multi-select filter system:

- **Severity filters** — toggle Errors, Warnings, and Notices independently. Each filter shows a live count.
- **Category filters** — toggle Regulatory (issues linked to a regulation) and Template (issues detected as cross-page duplicates).
- Filters with zero matching results are automatically hidden.
- Counts update live as filters are toggled.

For a complete reference, see [guides/dashboard-admin.md](guides/dashboard-admin.md).

### Trend tracking

The dashboard tracks scan results over time. Visit `/reports/trends` to see Chart.js line charts showing error, warning, and notice counts across scans for each URL. The home page displays executive summary cards with trend indicators — whether issues are increasing, decreasing, or stable compared to previous scans.

### Email reports

The dashboard can send scheduled accessibility reports and event notifications by email, powered by the `@pally-agent/plugin-notify-email` plugin.

1. **Install the plugin** — go to **Admin > Plugins**, find **Email Notifications**, and click **Install**.
2. **Configure SMTP** — open the plugin settings and enter your mail server host, port, TLS setting, credentials, and "from" address. Activate the plugin to verify connectivity.
3. **Create a schedule** — go to **Admin > Email Reports**, give it a name, enter the site URL, add one or more recipient addresses, and choose a frequency (daily, weekly, or monthly) and format (PDF, CSV, or both).
4. **Manage schedules** — enable/disable, send immediately, or delete from the schedule list.

The plugin also supports event notifications (`scan.complete`, `scan.failed`) — configure subscribed events in the plugin settings. The legacy `smtp_config` table in the dashboard database still works as a fallback if the plugin is not installed.

The email body contains an inline-styled HTML summary with key metrics. PDF attachments use the same print template as the browser export; CSV attachments use the same export logic as the Data API.

### Print / PDF export

Each report has a print-friendly view at `/reports/:id/print`. This is a standalone page optimized for `window.print()` — open it and use your browser's Print dialog to save as PDF or send to a printer. The layout removes navigation and interactive elements for a clean printed output.

### Manual testing checklists

Automated scanning catches approximately 30-40% of accessibility issues. For the rest, the dashboard provides manual testing checklists at `/reports/:id/manual`. These cover 27 WCAG 2.1 AA criteria that require human judgement (e.g., meaningful alt text, reading order, focus indicators). Each criterion now includes step-by-step testing guides with annotated good and bad examples. For each criterion, testers can record a pass, fail, or N/A result. Results are saved per scan and appear alongside automated findings in the report.

### Browser bookmarklet

Visit `/tools/bookmarklet` in the dashboard to find a drag-to-install bookmarklet. Drag it to your browser's bookmarks bar. When viewing any web page, click the bookmarklet to open the dashboard scan form with the current page's URL pre-filled — a quick way to scan pages you encounter during browsing.

---

## Data API and CSV export

The dashboard exposes a read-only JSON API and CSV download endpoints for external tools.

### REST API

Five JSON endpoints are available at `http://localhost:5000/api/v1`:

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/scans` | List scans with filters (siteUrl, date range, pagination) |
| `GET /api/v1/scans/:id` | Single scan detail |
| `GET /api/v1/scans/:id/issues` | Issues for a scan (filter by severity or WCAG criterion) |
| `GET /api/v1/trends` | Time-series issue counts per site |
| `GET /api/v1/compliance-summary` | Latest compliance status per jurisdiction |

Authentication: pass your API key in the `X-API-Key` header. Generate a key at **Settings > API Keys** in the dashboard. Rate limit: 60 requests per minute.

### CSV export

Download scan data as CSV for use in spreadsheets or BI tools:

- `GET /api/v1/export/scans.csv` — scans list
- `GET /api/v1/export/scans/:id/issues.csv` — issues for a scan
- `GET /api/v1/export/trends.csv` — trend data

Download buttons are available on the reports list, report detail, and trends pages in the dashboard.

### Power BI

Connect Power BI to the data API using **Get Data > Web** (Advanced mode). Enter the endpoint URL and add an `X-API-Key` header with your API key. See [API Reference — Power BI Integration](reference/api-reference.md#power-bi-integration) for step-by-step instructions.

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
