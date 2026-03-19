# Accessibility Analysis: kidhora.it

**Date:** 2026-03-19
**Tool:** pally-agent v0.1.0 + pally-compliance v0.1.0
**Standard:** WCAG 2.0 AA
**Pa11y Instance:** 192.168.3.90:4002

---

## Scan Summary

| Metric | Value |
|--------|-------|
| Pages scanned | 50 |
| Total issues | 6303 |
| Errors | 606 |
| Warnings | 1758 |
| Notices | 3939 |

## Top Accessibility Errors

| WCAG Rule | Occurrences | Description |
|-----------|-------------|-------------|
| `WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail` | 463 | This element has insufficient contrast at this conformance level. Expected a con |
| `WCAG2AA.Principle1.Guideline1_3.1_3_1.F92,ARIA4` | 82 | This element's role is "presentation" but contains child elements with semantic  |
| `WCAG2AA.Principle1.Guideline1_3.1_3_1.F68` | 20 | This form field should be labelled in some way. Use the label element (either wi |
| `WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.InputText.Name` | 14 | This textinput element does not have a name available to an accessibility API. V |
| `WCAG2AA.Principle1.Guideline1_4.1_4_3.G145.Fail` | 14 | This element has insufficient contrast at this conformance level. Expected a con |
| `WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.InputFile.Name` | 4 | This fileinput element does not have a name available to an accessibility API. V |
| `WCAG2AA.Principle3.Guideline3_2.3_2_2.H32.2` | 4 | This form does not contain a submit button, which creates issues for those who c |
| `WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.Button.Name` | 2 | This button element does not have a name available to an accessibility API. Vali |
| `WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.Select.Name` | 2 | This select element does not have a name available to an accessibility API. Vali |
| `WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.InputRange.Name` | 1 | This rangeinput element does not have a name available to an accessibility API.  |

---

## Compliance Matrix

**Jurisdictions checked:** 7
**Passing:** 0 | **Failing:** 7
**Total mandatory violations:** 896

| Jurisdiction | Status | Mandatory Violations | Regulations |
|-------------|--------|---------------------|-------------|
| European Union | **FAIL** | 128 | EAA (40 criteria), WAD (40 criteria) |
| United States | **FAIL** | 128 | Section 508 (40 criteria), ADA (40 criteria) |
| United Kingdom | **FAIL** | 128 | Equality Act (40 criteria), PSBAR (40 criteria) |
| Germany | **FAIL** | 192 | EAA (40 criteria), WAD (40 criteria), BITV 2.0 (40 criteria) |
| France | **FAIL** | 192 | EAA (40 criteria), WAD (40 criteria), RGAA (40 criteria) |
| Australia | **FAIL** | 64 | DDA (40 criteria) |
| Canada | **FAIL** | 64 | ACA (40 criteria) |

---

## Key Findings

1. **Color contrast failures** dominate (463 of 606 errors) — most pages have insufficient contrast ratios violating WCAG 1.4.3
2. **Form accessibility** — multiple form fields lack proper labels and accessible names (WCAG 1.3.1, 4.1.2)
3. **ARIA role violations** — incorrect use of heading roles (WCAG 1.3.1)
4. **All jurisdictions FAIL** — the site violates mandatory WCAG 2.0/2.1 AA requirements across EU (EAA, WAD), US (Section 508, ADA), UK (Equality Act, PSBAR), and national regulations (BITV, RGAA)
5. **EU EAA enforcement deadline** — June 28, 2025 — the site must remediate mandatory violations before this date

## Files in This Release

| File | Description |
|------|-------------|
| `ANALYSIS-SUMMARY.md` | This summary |
| `pally-report-*.json` | Full scan results (JSON) |
| `pally-report-*.html` | Interactive HTML report (open in browser) |
| `compliance-check-*.json` | Full compliance matrix with annotated issues |
