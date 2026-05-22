# Product

## Register

product

## Users

Luqen serves two co-equal personas who share the same screens but read them differently. Designs must work for both without forcing either into the other's vocabulary.

**Developer / engineer.** Runs scans, reads issue details, accepts AI fix proposals, wires Luqen into CI/CD and Git hosts. Lives in keyboard shortcuts, CLI, JSON, and code diffs. Wants speed, precise references (selector + line), copyable commands, dark mode, and zero ceremony. Will judge the product on whether it respects their flow.

**Compliance officer / accessibility lead.** Reads reports, tracks legal-risk posture across orgs and sites, hands findings to engineering, presents to non-technical stakeholders. Lives in dashboards, exported artifacts, jurisdiction matrices, and email digests. Wants evidence, plain-language summaries, defensible audit trails, and shareable PDFs that look authoritative outside the tool. Will judge the product on whether the regulator and the CFO would respect what they print.

Both share one job: **prove and improve WCAG compliance with as little friction as possible.** Every surface must answer "what is broken, how bad, what do I do next, and can I trust this?" without making either persona translate.

## Product Purpose

Luqen is the operator's seat for WCAG accessibility compliance. It scans web properties, scores them against jurisdictional rules, generates AI-assisted fixes, and produces evidence-grade reports. Success looks like: a developer ships a fix proposal within minutes of a scan, a compliance officer sends a board-ready PDF the same hour, and both trust the same numbers.

The product replaces the patchwork of open-source scanners + spreadsheets + manual axe runs + ad-hoc legal research that most teams stitch together. Its moat is **evidence with provenance**: every claim links back to a rule, a selector, a code snippet, and a fix path.

## Brand Personality

**Calm authority.** Trusted, evidence-led, regulator-grade. Three words: **precise, plain-spoken, unhurried.**

The voice never sells; it states. Headings are nouns and short verbs, not promises. Numbers carry weight on their own; we do not dress them up. Where competitors lean on shields, checkmarks, and accessibility-green to signal trust, Luqen earns trust through restraint: small, defensible claims, consistent typography, and the absence of decoration.

Tone in copy: closer to a court transcript than a marketing email. We say "47 issues, 12 blocking" before we say "great progress!". We never use exclamation marks in product chrome. Empty states explain, not delight.

## Anti-references

Reject in this order — each is a reflex the category falls into.

- **Generic accessibility-checker green-and-checkmark.** axe DevTools, WAVE, accessiBe overlays. Saturated mint-green, shield-tick logos, "100% accessible" badges. Luqen will not use accessibility-green as its identity color, and the logo will not be a shield or a checkmark.
- **Compliance-software navy + gold.** OneTrust, TrustArc, LogicGate. Corporate gradients, stock-photo heroes, dense badge strips, "Enterprise-Grade Compliance Platform" subheaders. Luqen will not use navy as its identity color and will not use gold as an accent.
- **Generic Bootstrap admin theme.** AdminLTE, Material Dashboard, every paid theme. Identical card grids, four hero-metric tiles on every dashboard, primary-blue everywhere, sidebar with stock icons. Luqen's home screen will not be a four-card stat header followed by a generic table.
- **AI-slop dashboards.** Gradient text, glassmorphism panels, animated background blobs, purple-pink gradients, big-number-with-tiny-label hero metrics, "Powered by AI" badges. The AI capabilities are present; they are never the visual hook.

## Design Principles

1. **Practice what you preach.** Every shipped Luqen surface passes our own scanner at WCAG 2.2 AA, and every artifact a customer can share (PDF, email report, public report URL, embeddable widget) targets AAA. A failure on our own UI is a P0 bug. The product is its own reference implementation.

2. **Dual-fluent by default.** Every screen serves the developer and the compliance officer in the same layout. We do this through progressive disclosure (dense by default for power users, plain-language summaries one click away), parallel artifacts (the same finding rendered as JSON, as a code diff, and as a regulator-readable sentence), and shared vocabulary (one canonical name per concept, mapped to legal and technical synonyms in a glossary).

3. **Evidence over polish.** Numbers must carry provenance: every score links to its inputs, every issue to its rule and selector, every fix to its diff. We do not soften, round, or visualise data in ways that obscure the chain. Sparklines are allowed; gradient-filled hero metrics are not. If a number cannot be defended, it does not ship.

4. **Distinctive but quiet.** Luqen owns one identity color that is neither accessibility-green nor compliance-navy nor admin-blue, and one typographic voice that survives in a screenshot. Restraint is the brand. Color appears where it carries meaning (status, attention, identity moments); chrome stays neutral. No surface uses more than one accent at a time.

5. **Keyboard-first, screen-reader-true.** Semantic structure decides layout, not the reverse. Every interactive element is reachable, labelled, and announces state changes. Focus order matches reading order. Skip links and landmarks are non-negotiable. Reduced-motion is the default for users who request it, and animation never carries information.

## Accessibility & Inclusion

**Floor: WCAG 2.2 AA across every shipped Luqen surface.** This includes the dashboard, all admin pages, the agent chat, login, OAuth consent, and every error state. CI gates on our own scanner; we do not ship UI that fails its own audit.

**Ceiling: WCAG 2.2 AAA on customer-shareable artifacts.** PDF reports, email digests, public report URLs, and any embeddable widget target AAA: 7:1 normal-text contrast, no reliance on color alone, full keyboard operability, complete screen-reader semantics, and reduced-motion safe.

**Screen-reader-first verification on critical flows.** Scan submission, report reading, and fix acceptance are designed and tested with NVDA and VoiceOver before visual sign-off, not after. Semantic structure (headings, landmarks, live regions, table semantics) is decided at the design stage, not retrofitted.

**Cognitive load and plain language.** Compliance officers are not developers; developers are not lawyers. Every dense view offers a plain-language summary; every legal term links to a glossary entry; every error message states what happened, why, and what to do. We support a "dense" mode for power users and a "plain" mode that strips jargon and exposes definitions inline. Copy targets a Flesch reading ease appropriate for the surface (product chrome: ≥60; report summaries: ≥50; legal text: as-is, with summaries).

**Reduced motion, color independence, internationalisation.** All motion respects `prefers-reduced-motion`. No status is conveyed by color alone — icons and labels always accompany. All UI strings are translatable, and the locale picker is reachable from every screen.
