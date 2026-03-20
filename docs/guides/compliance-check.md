[Docs](../README.md) > [Guides](./) > Compliance Checking

# Compliance Checking Guide

How to use the compliance service to map WCAG violations to legal obligations.

---

## Overview

Running a plain accessibility scan produces WCAG rule codes. The compliance service answers: "Which laws require this to be fixed, and in which countries?"

```
pally-agent scan → WCAG violations
                        ↓
              compliance check
                        ↓
         per-jurisdiction pass/fail matrix
         legal obligation levels per issue
         clickable regulation badge links
```

---

## Run a compliance-enriched scan

```bash
pally-agent scan https://example.com \
  --format both \
  --compliance-url http://localhost:4000 \
  --jurisdictions EU,US,UK \
  --compliance-client-id $CLIENT_ID \
  --compliance-client-secret $CLIENT_SECRET
```

Or in `.pally-agent.json`:

```json
{
  "compliance": {
    "url": "http://localhost:4000",
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "jurisdictions": ["EU", "US", "UK"]
  }
}
```

---

## Choosing jurisdictions

| If your users are in... | Check jurisdictions |
|------------------------|---------------------|
| European Union | `EU` (covers all member states via EAA/WAD) |
| Germany specifically | `DE`, `EU` (BITV 2.0 + EAA/WAD) |
| France specifically | `FR`, `EU` (RGAA + EAA/WAD) |
| United States | `US` (Section 508 + ADA) |
| United Kingdom | `UK` (Equality Act + PSBAR) |
| Australia | `AU` (DDA) |
| Canada | `CA` (ACA) |
| Japan | `JP` (JIS X 8341-3) |
| Global public-facing site | `EU`, `US`, `UK`, `AU`, `CA`, `JP` |

**Jurisdiction inheritance:** Checking a member state automatically includes its parent jurisdiction's regulations. Checking `DE` includes both German (BITV 2.0) and EU-level (EAA, WAD) requirements — you do not need to add `EU` separately.

---

## Reading the compliance matrix

The HTML report shows a table like this at the top:

| Jurisdiction | Status | Mandatory violations |
|--------------|--------|---------------------|
| EU | FAIL | 3 |
| US | FAIL | 3 |
| UK | PASS | 0 |

**FAIL** means the site has confirmed WCAG errors (`type: "error"`) that at least one mandatory regulation in that jurisdiction requires to be fixed.

**PASS** means no confirmed errors violate any mandatory requirement.

**Warnings and notices are never counted as violations.** Only errors (`type: "error"`) can cause a jurisdiction to FAIL.

### In the JSON report

```json
{
  "compliance": {
    "summary": {
      "totalJurisdictions": 3,
      "passing": 1,
      "failing": 2,
      "totalMandatoryViolations": 6
    },
    "matrix": {
      "EU": {
        "status": "fail",
        "mandatoryViolations": 3,
        "regulations": [
          {
            "regulationId": "EU-EAA",
            "regulationName": "European Accessibility Act",
            "shortName": "EAA",
            "status": "fail",
            "enforcementDate": "2025-06-28",
            "url": "https://eur-lex.europa.eu/..."
          }
        ]
      }
    }
  }
}
```

---

## Understanding obligation levels

| Level | Meaning |
|-------|---------|
| `mandatory` | Legally required. Failure means non-compliance with the law. |
| `recommended` | Strongly advised by the regulation but not strictly required. |
| `optional` | Informational best practice. Not a legal requirement. |

Only `mandatory` violations cause a jurisdiction to FAIL. Recommended and optional violations are included in the annotation but do not affect the matrix status.

---

## Regulation badges in reports

Each issue in the HTML report shows clickable badges for the regulations it violates:

```
[EAA] [ADA]
```

Clicking a badge opens the official legal text (EUR-Lex, govinfo.gov, legislation.gov.uk, etc.).

In the JSON, each issue has a `regulations` array:

```json
{
  "regulations": [
    {
      "regulationId": "EU-EAA",
      "shortName": "EAA",
      "jurisdictionId": "EU",
      "obligation": "mandatory",
      "url": "https://eur-lex.europa.eu/..."
    }
  ]
}
```

---

## Confirmed violations vs needs-review

| Issue type | Compliance counting |
|------------|---------------------|
| `error` | Confirmed violation — counted as a mandatory violation |
| `warning` | Flagged for review — annotated with regulations but NOT counted as a violation |
| `notice` | Informational only — annotated but NOT counted as a violation |

This distinction matters: a site with zero errors but many warnings is legally **PASS** in the compliance matrix.

---

## Sector filtering

Some regulations apply only to specific sectors (banking, e-commerce, government). Filter by sector to narrow results:

```json
{
  "compliance": {
    "sectors": ["banking"]
  }
}
```

Only regulations with `"banking"` in their `sectors` array are included in the check.

---

## Wildcard criterion matching

Most regulations require all WCAG criteria at a given level, not individual ones. These are stored with `wcagCriterion: "*"`.

A wildcard at level `AA` matches all WCAG 2.1 A and AA criteria. This is how EAA, ADA, and most other regulations are represented — one requirement covers the entire standard.

---

## Baseline data

The compliance service ships with data for 8 baseline jurisdictions covering 10 regulations:

| Jurisdiction | Regulations |
|-------------|-------------|
| EU | EAA (European Accessibility Act), WAD (Web Accessibility Directive) |
| US | Section 508, ADA |
| UK | Equality Act 2010, PSBAR |
| DE | BITV 2.0 |
| FR | RGAA 4.1 |
| AU | DDA |
| CA | ACA |
| JP | JIS X 8341-3 |

The full seeded dataset covers 58 jurisdictions and 62 regulations. Load it with:

```bash
pally-compliance seed
```

---

*See also: [USER-GUIDE.md](../USER-GUIDE.md) | [guides/reports.md](reports.md) | [compliance/README.md](../compliance/README.md) | [configuration/compliance.md](../configuration/compliance.md)*
