[Docs](../README.md) > [Guides](./) > Reports

# Reports Guide

Understanding JSON and HTML report formats, template deduplication, and WCAG/regulation hyperlinks.

---

## Output files

Reports are written to `outputDir` (default: `./pally-reports/`) with timestamped filenames:

```
pally-report-2026-03-18T120000Z.json
pally-report-2026-03-18T120000Z.html
```

The directory is created if it does not exist. If a file with the same timestamp already exists, a counter suffix is appended (no overwriting).

The filename includes the website hostname:

```
pally-report-example.com-2026-03-18T120000Z.json
```

---

## JSON report structure

```typescript
{
  summary: {
    url: string;              // Root URL scanned
    pagesScanned: number;
    pagesFailed: number;
    totalIssues: number;
    byLevel: {
      error: number;          // Confirmed violations
      warning: number;        // Needs review
      notice: number;         // Informational
    };
  };

  pages: Array<{
    url: string;
    discoveryMethod: "sitemap" | "crawl";
    issueCount: number;
    issues: Array<{
      code: string;           // WCAG rule code
      type: "error" | "warning" | "notice";
      message: string;
      selector: string;       // CSS selector of the element
      context: string;        // HTML snippet
      fixSuggestion?: string;
      wcagInfo?: {            // v0.3.0+
        criterion: string;    // e.g. "1.1.1"
        title: string;        // e.g. "Non-text Content"
        level: string;        // "A", "AA", or "AAA"
        url: string;          // W3C Understanding WCAG 2.1 link
      };
      regulations?: Array<{   // Present when compliance enabled (v0.2.0+)
        regulationId: string;
        shortName: string;    // e.g. "EAA", "ADA"
        jurisdictionId: string;
        obligation: "mandatory" | "recommended";
        url?: string;         // Official legal text link (v0.3.0+)
      }>;
    }>;
    sourceMap?: {             // Present when --repo used
      file: string;
      line?: number;
      confidence: "high" | "low" | "none";
    };
    error?: {                 // Present for failed pages
      code: "TIMEOUT" | "WEBSERVICE_ERROR" | "HTTP_ERROR" | "WAF_BLOCKED" | "UNKNOWN";
      message: string;
      retried: boolean;
    };
  }>;

  templateIssues?: Array<{   // v0.3.0+ — deduplicated across 3+ pages
    code: string;
    type: "error" | "warning" | "notice";
    message: string;
    selector: string;
    context: string;
    affectedPages: string[];
    affectedPageCount: number;
    fixSuggestion?: string;
    wcagInfo?: WcagCriterionInfo;
    regulations?: RegulationAnnotation[];
  }>;

  compliance?: {              // Present when compliance enabled (v0.2.0+)
    summary: {
      totalJurisdictions: number;
      passing: number;
      failing: number;
      totalMandatoryViolations: number;
    };
    matrix: Record<string, {
      status: "pass" | "fail";
      mandatoryViolations: number;
      regulations: Array<{
        regulationId: string;
        shortName: string;
        status: "pass" | "fail";
        enforcementDate: string;
        url?: string;
      }>;
    }>;
  };

  errors: ScanError[];        // Pages that failed to scan
  reportPath: string;         // Absolute path to this file
}
```

---

## Template issue deduplication (v0.3.0)

Shared components (headers, footers, navigation) produce identical issues on every page. Without deduplication, a single missing `alt` on a logo could appear 50+ times.

**How it works:**

After scanning, pally-agent identifies issues where `code + selector + context` is identical across **3 or more pages**. These are extracted from individual page results and grouped into the top-level `templateIssues` array.

Each entry records `affectedPageCount` and `affectedPages` so you know the full scope.

**Result:** Eliminates approximately 84% of duplicate noise on sites with shared layouts.

**Example:**

```json
{
  "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
  "type": "error",
  "message": "Img element missing an alt attribute.",
  "selector": "header > nav > a > img",
  "context": "<img src=\"/logo.svg\">",
  "affectedPageCount": 42,
  "affectedPages": ["https://example.com/", "https://example.com/about", "..."]
}
```

Fix the issue once in the shared component to resolve it on all 42 pages.

---

## HTML report features

HTML reports (`pally-report-*.html`) are:

- **Self-contained** — a single file with all CSS inlined; no external dependencies; safe to email or archive
- **Filterable** — filter by severity (error / warning / notice), page URL, and rule code
- **Collapsible** — each page section is collapsible; summary statistics are always visible
- **Colour-coded** — errors in red, warnings in yellow, notices in blue
- **WCAG hyperlinks** — every WCAG criterion links to the W3C Understanding WCAG 2.1 page
- **Regulation badges** — when compliance is enabled, each issue shows clickable regulation badges (EAA, ADA, etc.) linking to official legal texts
- **Compliance matrix** — when compliance is enabled, a per-jurisdiction pass/fail table at the top
- **Template issues section** — deduplicated issues in a dedicated "Template & Layout Issues" section before the per-page breakdown
- **Print-friendly** — print CSS produces a clean full-width layout

---

## WCAG hyperlinks

Every WCAG criterion in the HTML report is a clickable link to the W3C Understanding WCAG 2.1 page for that criterion. For example, criterion 1.1.1 links to:

```
https://www.w3.org/WAI/WCAG21/Understanding/non-text-content
```

This is also included in the JSON under `wcagInfo.url` on each issue.

---

## Regulation hyperlinks

When compliance integration is enabled, regulation badges are clickable links to official legal texts:

| Regulation | Official source |
|-----------|----------------|
| EAA | EUR-Lex (eur-lex.europa.eu) |
| ADA | govinfo.gov |
| Section 508 | govinfo.gov |
| UK Equality Act | legislation.gov.uk |
| BITV 2.0 | gesetze-im-internet.de |
| RGAA | numerique.gouv.fr |

The URL is included in the JSON under `regulations[].url` on each issue and in the compliance matrix.

---

*See also: [guides/scanning.md](scanning.md) | [guides/compliance-check.md](compliance-check.md) | [integrations/api-reference.md](../integrations/api-reference.md)*
