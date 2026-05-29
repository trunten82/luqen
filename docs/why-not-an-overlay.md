# Why not an overlay?

Accessibility **overlays** (also called widgets or "accessibility plugins" in the marketing sense) are third-party scripts you add to a site with one line of code. They promise to make a site WCAG- and ADA-compliant automatically. Luqen is deliberately **not** an overlay. This page explains the difference and why it matters.

## The short version

| | Accessibility overlay / widget | Luqen (genuine remediation) |
|---|---|---|
| **How it works** | A script loads on top of the live site and tries to patch the rendered page in the visitor's browser | Scans the site, identifies specific WCAG violations, and helps you fix the underlying source — content, markup, theme, palette |
| **Where the fix lives** | In the overlay vendor's script, re-applied on every page load | In your actual website — durable, version-controlled, yours |
| **Assistive-tech reality** | Many screen-reader users disable or distrust overlays; some overlays interfere with the AT users already run | Fixes are in the real DOM/source, so every assistive technology sees them natively |
| **Legal posture** | Marketed as instant compliance; regulators and courts disagree (see below) | Produces evidence of real conformance work — the issue list, the fixes, the audit trail |
| **If you stop paying** | The "fixes" disappear with the script | The fixes remain in your site |

## The evidence

**Overlays do not deliver compliance.** In January 2025 the U.S. Federal Trade Commission announced an order requiring a leading overlay vendor (accessiBe) to pay **$1,000,000** to settle allegations that it falsely claimed its AI-powered `accessWidget` could make any website compliant with WCAG. The FTC found the product "did not make all user websites WCAG compliant" and that the claims were "false, misleading, or unsubstantiated."
— FTC, *FTC Order Requires Online Marketer to Pay $1 Million for Deceptive Claims that Its AI Product Could Make Websites Compliant* (2025). https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-order-requires-online-marketer-pay-1-million-deceptive-claims-its-ai-product-could-make-websites

**Overlays do not stop lawsuits.** In 2025, **983 U.S. web-accessibility lawsuits — about 24.9% of all filings — targeted websites that already had an accessibility widget installed**, up from 722 (22.65%) in 2024. A widget is not a legal shield.
— EcomBack, *Annual 2025 ADA Website Accessibility Lawsuit Report*. https://www.ecomback.com/annual-2025-ada-website-accessibility-lawsuit-report

**The disability community has objected.** The U.S. National Federation of the Blind — the largest organization of blind Americans — revoked the overlay vendor's convention sponsorship on 22 June 2021, stating the company "engages in behavior harmful to blind people" and "fails to acknowledge that blind experts and regular screen reader users know what is accessible."
— National Federation of the Blind, *National Convention Sponsorship Statement Regarding accessiBe* (2021). https://nfb.org/about-us/press-room/national-convention-sponsorship-statement-regarding-accessibe

## Why this is the right time to do it properly

Enforcement is rising on both sides of the Atlantic, and only genuine remediation answers it:

- **US:** Federal ADA Title III website-accessibility lawsuits reached **3,117 in 2025 (+27% year over year)** — 36% of all Title III filings.
  — Seyfarth Shaw, ADA Title III tracker. https://www.adatitleiii.com/2026/03/federal-court-website-accessibility-lawsuit-filings-bounce-back-in-2025/
- **EU:** The **European Accessibility Act became enforceable on 28 June 2025**, covering e-commerce websites and mobile apps.
  — European Commission, AccessibleEU. https://accessible-eu-centre.ec.europa.eu/content-corner/news/eaa-comes-effect-june-2025-are-you-ready-2025-01-31_en

## What Luqen does instead

Luqen scans your whole site, maps each WCAG violation to the specific laws that require fixing it across 58 jurisdictions, and helps your team correct the real source — with AI-assisted fix suggestions, an issue-assignment workflow, and an audit trail you can show a regulator. The result is a site that is actually more accessible to real users of assistive technology, not a script that claims it is.

---

*Sources above were fact-checked against primary documents (FTC, NFB, EU AccessibleEU) and the cited litigation trackers. Overlay-criticism advocacy sites exist (e.g. overlayfalseclaims.com) and aggregate much of this data, but every claim here is anchored to a primary or first-party litigation source.*
