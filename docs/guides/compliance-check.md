[Docs](../README.md) > [Guides](../README.md#how-to-guides) > Compliance Checking Guide

# Compliance Checking Guide

How to map accessibility issues to legal obligations across jurisdictions and regulations.

---

## What compliance checking does

After scanning a website, luqen can enrich every issue with legal context by querying the compliance service. This tells you:

- Which **jurisdictions** (countries or regions) have laws requiring you to fix each issue.
- Which **regulations** (specific laws) apply, and whether compliance is mandatory, recommended, or optional.
- Whether your site **passes or fails** each jurisdiction's requirements.

---

## Key concepts

### Jurisdictions

A jurisdiction is a country, region, or supranational body that has accessibility legislation. Examples: `EU`, `US`, `UK`, `DE`, `AU`.

The compliance service ships with **58 jurisdictions** in its baseline seed data, covering all EU/EEA member states, major Anglophone countries, and key Asian and Latin American markets.

### Regulations

A regulation is a specific law or standard within a jurisdiction. Examples:

| Short name | Full name | Jurisdiction |
|------------|-----------|--------------|
| **EAA** | European Accessibility Act | EU |
| **WAD** | Web Accessibility Directive | EU |
| **ADA** | Americans with Disabilities Act | US |
| **Section 508** | Rehabilitation Act Section 508 | US |
| **EA 2010** | Equality Act 2010 | UK |
| **BITV 2.0** | Barrierefreie-Informationstechnik-Verordnung | DE |

The baseline seed data includes **62 regulations**.

### Obligation levels

Each regulation maps WCAG criteria to one of three obligation levels:

| Level | Colour | Meaning |
|-------|--------|---------|
| **Mandatory** | Red | Legally required. Confirmed violations (errors) against these criteria mean your site fails compliance. |
| **Recommended** | Amber | Officially recommended but not strictly enforceable. Warnings and notices are flagged for review. |
| **Optional** | Blue | Voluntary. Included for completeness. |

### Jurisdiction inheritance

Jurisdictions can inherit regulations from parent jurisdictions. For example:

- Selecting **Germany (DE)** automatically includes EU-level regulations (EAA, WAD) alongside Germany-specific regulations (BITV 2.0).
- Selecting **France (FR)** includes EU regulations plus RGAA.
- You do not need to add `EU` separately when checking an EU member state.

---

## Selecting jurisdictions

### In the CLI

Pass a comma-separated list of jurisdiction IDs:

```bash
luqen scan https://example.com \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU,US,UK,AU
```

Default: `EU,US` if `--jurisdictions` is not specified.

### In the dashboard

The scan form includes a **searchable jurisdiction picker**:

1. Click the jurisdiction dropdown.
2. Type to filter — the list narrows as you type (e.g., typing "ger" shows "Germany").
3. Click a jurisdiction to select it. Click again to deselect.
4. Selected jurisdictions appear as tags above the dropdown.
5. Maximum 50 jurisdictions per scan.

If the compliance service is unavailable, the picker is hidden and scans proceed without compliance enrichment.

---

## Reading the compliance matrix

When a scan includes jurisdictions, the report's **Compliance tab** shows a card for each jurisdiction:

```
┌─────────────────────────────────────────┐
│  European Union (EU)            FAIL    │
│  WCAG criteria violated: 3             │
│  ┌─────┐ ┌─────┐                      │
│  │ EAA │ │ WAD │  (mandatory)          │
│  └─────┘ └─────┘                      │
└─────────────────────────────────────────┘
```

### Status values

| Status | Meaning |
|--------|---------|
| **FAIL** | Confirmed WCAG errors violate at least one mandatory requirement in this jurisdiction. |
| **REVIEW** | No confirmed errors, but warnings or notices exist against mandatory criteria. Human review is needed. |
| **PASS** | No issues (errors, warnings, or notices) violate any mandatory requirement. |

### WCAG criteria violated count

The "WCAG criteria violated" count is **deduplicated across regulations**. If the same WCAG criterion (e.g., 1.1.1) is required by both EAA and WAD, it is counted once — not twice. This gives you the true number of distinct criteria you need to address.

---

## Regulation tags on issues

In the **Issues tab**, each issue group shows regulation badges:

```
1.1.1 Non-text Content                    [EAA] [ADA] [EA 2010]
├── Error: img element missing alt text
└── 3 pages affected
```

Badge colours reflect the obligation level:

- **Red badge** — mandatory regulation
- **Amber badge** — recommended regulation
- **Blue badge** — optional regulation

Clicking a badge opens the official legal text (where the compliance service has a URL on record).

---

## Confirmed vs. needs review

Luqen-agent distinguishes between confirmed violations and issues that need review:

| pa11y type | Compliance treatment |
|------------|---------------------|
| **Error** | Confirmed violation. If it maps to a mandatory requirement, the jurisdiction status is FAIL. |
| **Warning** | Needs review. A human must confirm whether this is a real violation. Jurisdiction status is REVIEW (not FAIL). |
| **Notice** | Needs review. Informational flag. Same treatment as warning for compliance purposes. |

This means a jurisdiction can only FAIL due to confirmed errors — never from warnings or notices alone.

---

## CLI compliance output

When compliance is enabled, the CLI prints a summary after scanning:

```
Compliance: 2 confirmed failure(s), 1 need review, 5 confirmed violations, 3 need review
```

This tells you:
- 2 jurisdictions have confirmed failures (errors against mandatory criteria)
- 1 jurisdiction has only warnings/notices against mandatory criteria (needs human review)
- 5 individual issue-jurisdiction pairs are confirmed violations
- 3 issue-jurisdiction pairs need review

---

## JSON report structure

The compliance data is included in the JSON report under the `compliance` key:

```json
{
  "compliance": {
    "summary": {
      "totalJurisdictions": 3,
      "passing": 1,
      "failing": 2,
      "totalConfirmedViolations": 5,
      "totalNeedsReview": 3
    },
    "matrix": {
      "EU": {
        "jurisdictionId": "EU",
        "jurisdictionName": "European Union",
        "status": "fail",
        "reviewStatus": "fail",
        "confirmedViolations": 3,
        "needsReview": 1,
        "regulations": [
          {
            "shortName": "EAA",
            "status": "fail",
            "violations": [
              { "wcagCriterion": "1.1.1", "obligation": "mandatory", "issueCount": 2 }
            ]
          }
        ]
      }
    },
    "annotatedIssues": [
      {
        "code": "WCAG2AA.Principle1.Guideline1_1.1_1_1.H37",
        "wcagCriterion": "1.1.1",
        "regulations": [
          { "shortName": "EAA", "obligation": "mandatory", "jurisdictionId": "EU" },
          { "shortName": "ADA", "obligation": "mandatory", "jurisdictionId": "US" }
        ]
      }
    ]
  }
}
```

---

## Setting up the compliance service

The compliance service (`@luqen/compliance`) must be running and seeded with jurisdiction/regulation data before compliance checking works.

```bash
# Generate encryption keys
node packages/compliance/dist/cli.js keys generate

# Seed baseline data (58 jurisdictions, 62 regulations)
node packages/compliance/dist/cli.js seed

# Start the service
COMPLIANCE_API_KEY=your-api-key node packages/compliance/dist/cli.js serve --port 4100
```

For detailed setup, see [QUICKSTART.md](../QUICKSTART.md).

---

## Managing compliance data

Dashboard administrators can manage jurisdictions, regulations, and requirements through the admin pages:

- **Admin > Jurisdictions** — add, edit, or disable jurisdictions
- **Admin > Regulations** — add or edit regulations within a jurisdiction
- **Admin > Requirements** — map WCAG criteria to regulations with obligation levels

See [dashboard-admin.md](dashboard-admin.md) for details.

---

*See also: [USER-GUIDE.md](../USER-GUIDE.md) | [scanning.md](scanning.md) | [reports.md](reports.md)*
