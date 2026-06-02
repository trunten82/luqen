# Design

Implementation contract for Luqen's visual system. Anchored to `PRODUCT.md` and the locked decisions in `.planning/design/UI-REVISION-PROPOSAL.md` (2026-05-22). When this file and PRODUCT.md disagree, PRODUCT.md wins.

All color values are OKLCH. All sizes are rem unless stated. All durations are milliseconds.

---

## Theme

Luqen ships **both modes** with different defaults per persona:

- **Dark by default** when the surface is developer-leaning (dashboard chrome, agent chat, fixes, scan-new, scan-progress, code-heavy admin pages).
- **Light by default** when the surface is compliance-officer-leaning or customer-shareable (reports, public report URLs, PDF, email, landing page, login).
- Honour `prefers-color-scheme` if the user has not chosen explicitly. User choice persists per device.

Neither mode is the "real" one. Tokens are defined for both and surfaces opt in.

The scene that forces this: a developer on a 27-inch monitor at 11pm reading a diff, and a compliance officer on a laptop at 9am reading a printed PDF in a meeting room. Both are real users. Neither default works for the other.

---

## Color tokens

All colors OKLCH. Neutrals tint toward the identity hue (warm red, hue 25) at chroma 0.005–0.015 so backgrounds never read as pure white or pure black.

### Identity

| Token | Light | Dark |
|---|---|---|
| `--id-accent` | `oklch(0.34 0.09 25)` | `oklch(0.78 0.08 25)` |
| `--id-accent-hover` | `oklch(0.28 0.09 25)` | `oklch(0.85 0.08 25)` |
| `--id-accent-tint` | `oklch(0.96 0.02 25)` | `oklch(0.22 0.03 25)` |
| `--id-evidence` | `oklch(0.84 0.18 105)` | `oklch(0.84 0.18 105)` |

`--id-evidence` (citron) is used **only** for evidence highlights: changed diff lines, focused row in a long list, AAA-pass strip on report rows. Never on buttons. Never as a status. Same value in both modes — flares against either canvas.

### Surfaces (light)

| Token | Value |
|---|---|
| `--bg-page` | `oklch(0.995 0.005 25)` |
| `--bg-surface` | `oklch(0.98 0.005 25)` |
| `--bg-surface-raised` | `oklch(0.96 0.005 25)` |
| `--bg-muted` | `oklch(0.94 0.008 25)` |
| `--bg-sidebar` | `oklch(0.18 0.04 25)` |
| `--bg-sidebar-hover` | `oklch(0.24 0.05 25)` |
| `--bg-sidebar-active` | `oklch(0.28 0.06 25)` |
| `--border-subtle` | `oklch(0.90 0.008 25)` |
| `--border-strong` | `oklch(0.82 0.012 25)` |

### Surfaces (dark)

| Token | Value |
|---|---|
| `--bg-page` | `oklch(0.14 0.012 25)` |
| `--bg-surface` | `oklch(0.18 0.012 25)` |
| `--bg-surface-raised` | `oklch(0.22 0.015 25)` |
| `--bg-muted` | `oklch(0.26 0.018 25)` |
| `--bg-sidebar` | `oklch(0.10 0.015 25)` |
| `--bg-sidebar-hover` | `oklch(0.16 0.02 25)` |
| `--bg-sidebar-active` | `oklch(0.22 0.04 25)` |
| `--border-subtle` | `oklch(0.28 0.015 25)` |
| `--border-strong` | `oklch(0.38 0.018 25)` |

### Text

| Token | Light | Dark | Min ratio on `--bg-page` |
|---|---|---|---|
| `--text-primary` | `oklch(0.18 0.015 25)` | `oklch(0.97 0.005 25)` | 13.2 : 1 (AAA) |
| `--text-secondary` | `oklch(0.42 0.012 25)` | `oklch(0.78 0.008 25)` | 7.4 : 1 (AAA) |
| `--text-muted` | `oklch(0.55 0.010 25)` | `oklch(0.62 0.010 25)` | 4.8 : 1 (AA only — use for de-emphasised meta, never for primary content) |
| `--text-on-accent` | `oklch(0.98 0.005 25)` | `oklch(0.14 0.012 25)` | 8.7 : 1 / 9.3 : 1 (AAA) |

### Status (semantic, universal — unchanged across both modes' meaning)

These are status colors, not brand. Same hue across modes; lightness retuned for AAA on each canvas.

| Token | Light fg / bg | Dark fg / bg |
|---|---|---|
| `--status-success-fg` / `-bg` | `oklch(0.42 0.13 150)` / `oklch(0.95 0.05 150)` | `oklch(0.82 0.16 150)` / `oklch(0.22 0.04 150)` |
| `--status-warning-fg` / `-bg` | `oklch(0.50 0.13 70)` / `oklch(0.95 0.05 80)` | `oklch(0.82 0.16 80)` / `oklch(0.22 0.04 70)` |
| `--status-error-fg` / `-bg` | `oklch(0.48 0.20 27)` / `oklch(0.94 0.05 27)` | `oklch(0.78 0.18 27)` / `oklch(0.22 0.05 27)` |
| `--status-info-fg` / `-bg` | `oklch(0.42 0.14 250)` / `oklch(0.95 0.04 250)` | `oklch(0.82 0.13 250)` / `oklch(0.22 0.04 250)` |

Status-error uses high chroma (0.20) and is hue-distinct from identity oxblood (chroma 0.09, hue 25). The two never collide in context: identity is chrome (sidebar, links, headlines), error is content (alerts, badges, banners).

**Status is never conveyed by color alone.** Every status pairing has a paired icon and label.

### Focus

| Token | Value |
|---|---|
| `--focus-ring` | `0 0 0 3px oklch(0.84 0.18 105 / 0.55)` (citron, 55% alpha) |
| `--focus-ring-offset` | 2px |

Citron focus rings (the evidence color) read against both light and dark canvases. The 3px solid ring is per WCAG 2.2 SC 2.4.13 (Focus Appearance).

---

## Typography

Three self-hosted families, SIL Open Font License, loaded via `@font-face` with `font-display: swap`. Subset to Latin + Latin-Extended. Total budget: **120KB woff2**.

```
Inter Display      — 700, 600           (display ≥20px)
Inter              — 400, 500, 600, 700 (body, UI)
IBM Plex Mono      — 400, 500           (code, selectors, mono columns)
```

### Stacks

```css
--font-display: 'Inter Display', 'Inter', system-ui, sans-serif;
--font-sans:    'Inter', system-ui, -apple-system, sans-serif;
--font-mono:    'IBM Plex Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
```

### Scale (1.333 ratio, base 1rem = 16px)

| Token | Size | Weight | Family | Use |
|---|---|---|---|---|
| `--type-display-1` | 2.986rem (47.8px) | 700 | display | landing hero only |
| `--type-display-2` | 2.241rem (35.9px) | 700 | display | report title, page H1 |
| `--type-display-3` | 1.682rem (26.9px) | 600 | display | section H1 in dense views |
| `--type-h1` | 1.5rem (24px) | 600 | sans | dashboard page H1 |
| `--type-h2` | 1.25rem (20px) | 600 | sans | card / panel headings |
| `--type-h3` | 1.125rem (18px) | 600 | sans | subsection |
| `--type-body` | 1rem (16px) | 400 | sans | body, line-height 1.55 |
| `--type-body-strong` | 1rem (16px) | 500 | sans | emphasised body |
| `--type-small` | 0.875rem (14px) | 400 | sans | secondary UI |
| `--type-meta` | 0.8125rem (13px) | 500 | sans | timestamps, IDs, badges (tracking +0.02em) |
| `--type-mono` | 0.875rem (14px) | 400 | mono | code, selectors |
| `--type-mono-emphasis` | 0.875rem (14px) | 500 | mono | active diff line, focused selector |

### Letter-spacing

- Display sizes: `-0.022em`
- H1–H3: `-0.012em`
- Body and below: 0
- Meta / uppercase eyebrows: `+0.02em`

### Line-length

Body text capped at **68ch** in long-form contexts (report summaries, plain-language panels, landing copy). Dense tables and dashboards are exempt.

---

## Spacing

8-step scale. Use rhythm — never the same padding on every component.

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 48px |
| `--space-8` | 72px |

Vertical rhythm: pages compose in `--space-5` / `--space-6` / `--space-7` blocks. Cards do **not** sit inside other cards. Most surfaces don't need a card at all — use a thin top border + heading instead.

---

## Radii

Three steps. Most things are rectangles.

| Token | Value |
|---|---|
| `--radius-sm` | 4px |
| `--radius-md` | 6px |
| `--radius-lg` | 10px |

No pill buttons. No fully-rounded cards. The product is a document, not a toy.

---

## Elevation

Two shadows. Used sparingly.

| Token | Light | Dark |
|---|---|---|
| `--shadow-sm` | `0 1px 2px oklch(0.10 0.02 25 / 0.06)` | `0 1px 2px oklch(0.04 0.01 25 / 0.40)` |
| `--shadow-md` | `0 4px 10px oklch(0.10 0.02 25 / 0.08)` | `0 4px 10px oklch(0.04 0.01 25 / 0.50)` |

Default elevation for surfaces is **0** — separation by border, not shadow. Shadow appears on modals, popovers, and the active item in a few specific contexts.

---

## Motion

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quart) | default for all UI |
| `--duration-fast` | 120ms | hover, focus state |
| `--duration-base` | 180ms | reveal, dismiss |
| `--duration-slow` | 280ms | drawer, sidebar, larger reveals |

No bounce. No elastic. No spring physics. Animation never carries information.

Honour `prefers-reduced-motion`: when set, all transitions drop to `0ms` (not "shorter"). Opacity fades may persist at 80ms when essential for state communication.

---

## Components — primitives

These are spec hints, not the full source. The implementation lives in `packages/dashboard/src/static/style.css` (refactored in R1). Component files map 1:1 to partials in `packages/dashboard/src/views/partials/`.

### Button

| Variant | Surface | Border | Use |
|---|---|---|---|
| `primary` | `--id-accent` bg, `--text-on-accent` fg | none | the single primary action per surface |
| `secondary` | transparent bg, `--text-primary` fg | 1px `--border-strong` | every other action |
| `quiet` | transparent bg, `--text-secondary` fg | none | nav links, list-row actions |
| `danger` | transparent bg, `--status-error-fg` fg | 1px `--status-error-fg` | destructive (delete org, revoke key) |

- Height: 36px default, 28px compact, 44px touch.
- Padding: 0 `--space-4`, mono-tabular numerals if numeric.
- Focus: `--focus-ring` always.
- No icon-only buttons without an `aria-label`. No gradient backgrounds. No drop-shadow.

### Input

- Height: 36px default, 44px touch.
- Border: 1px `--border-strong`. On focus, border becomes `--id-accent` plus `--focus-ring`.
- Label sits **above** the input, never inside (no placeholder-as-label).
- Error state: `--status-error-fg` border + a one-line error message below, paired with an alert icon.

### Card

- Use only when the contents truly need a separated affordance. Default is **no card** — use a thin top border + heading.
- When used: `--bg-surface` background, 1px `--border-subtle`, `--radius-md`, padding `--space-5`.
- **Cards never nest.** A card inside a card is a bug.

### Table (data dense)

- Row height: 40px default, 32px in `dense` mode.
- Header: `--type-meta` uppercase, `--text-muted`, tracking +0.02em, 1px bottom border `--border-strong`.
- Row borders: 1px `--border-subtle`, only between rows.
- Hover: `--bg-muted` row.
- Active / selected: `--id-accent-tint` row with 2px left edge in `--id-evidence` (citron) — note this is a 2px utility mark on a row, not a coloured side-stripe ≥1px on a card or callout (which is banned). The distinction is deliberate.
- Sort indicators: arrows in `--text-secondary`, with `aria-sort`.

### Badge

- Padding: 2px `--space-2`.
- `--radius-sm`.
- `--type-meta` weight 500.
- Always paired with text. Color comes from semantic status tokens. No "default" gray badge — if there's no status, don't use a badge.

### Alert

- Full-width banner: 1px `--border-strong` (full border, never side-stripe), `--space-4` padding.
- Icon left (16px), title (body-strong), description (body or small), action right.
- Background uses status-bg token at low chroma.

### Modal

- Last resort. Inline disclosure first, side-panel second, modal third.
- When used: max-width 520px, `--bg-surface-raised`, `--shadow-md`, `--radius-lg`, padding `--space-6`.
- Escape closes; focus trapped; focus returns to the trigger.
- Mobile: full-sheet from bottom, drag-handle, never centered on mobile.

### Sidebar (`partials/sidebar.hbs`)

- Width: 260px desktop. Slide-over with backdrop on mobile.
- Canvas: `--bg-sidebar` (oxblood-deep). Text: `oklch(0.78 0.04 25)`. Active text: `oklch(0.97 0.005 25)`.
- Active item: 1px right-edge mark in `--id-evidence` + weight bump to 600. No background fill change beyond `--bg-sidebar-active`. **No 3px left-edge accent bar** (current style.css:409 — to be retired).
- Section dividers: 1px `--border-strong` at 30% alpha.
- Locale + org switcher at bottom, separated by a thin divider.

---

## Patterns

### The verdict line

The primary unit of evidence display. One sentence in body-strong type, followed by a meta line with provenance. Used on report headers, agent share view, badge previews, email subjects, PDF cover.

```
acme.com is partially compliant with WCAG 2.2 AA across 47 pages.
Scanned 2026-05-22 at 14:02 UTC · rule set v2.11.0 · 12 blocking issues
```

No icon. No badge. Type carries the weight. Citron strip appears on the *next* row only if it needs attention.

### The two-column docket (home)

Left rail (260px fixed): typographic org-posture block — one score number (`--type-display-3`), one plain-language verdict sentence, three sub-numbers (`--type-meta` labels above `--type-h3` values). Total height fits above the fold.

Right column (fluid): a vertically scrolling activity stream, each row a typographic block of timestamp + actor + event + one-line detail. Rows needing attention carry a 2px left-edge citron mark. **No cards. No icons. No avatars.** Mono timestamp column aligned right.

On mobile: rail collapses above stream, score becomes 48px display-2, stream rows stay full-width.

### Plain / Dense toggle

A top-bar segmented control: **Dense** (default for dev persona) / **Plain** (default for compliance officer). Persists per user.

- Dense: tighter line-height, full mono columns visible, legal terminology shown verbatim.
- Plain: line-height 1.65, legal terms wrapped in a `<dfn>` element styled with a dotted underline that reveals the definition inline on hover and on focus. Plain-language summary appears above any dense data table.

The toggle is **not** themeable per-organisation — it is per-user, surfaced everywhere, and the choice is the user's, not the admin's. Compliance officers reading dev-shared screens, and devs reading compliance-shared screens, are first-class.

### Evidence highlight

Citron (`--id-evidence`) appears on, and only on:

- The changed lines in a code diff (`background-color: oklch(0.96 0.10 105)` in light mode, `oklch(0.30 0.10 105)` in dark).
- The active focused row in a long list or table (2px left-edge mark).
- The AAA-pass strip on a report row (full-row 2px top border).
- The focus ring (always).
- The "Verified by Luqen" mark on customer-shareable artifacts (a single citron rectangle, 4×16px).

Used anywhere else, it's a bug.

---

## Accessibility Conformance Report (ACR) — single source

The ACR (VPAT®) is the customer-shareable artifact a compliance officer prints for a regulator or a CFO. It is a transparency and remediation-planning document, never a certificate. The type carries the authority; decoration does not.

**One document, two renderers.** The ACR template and stylesheet are authored once in `shared/acr/` (`acr.template.html` + `acr.css`) and rendered by every surface that produces an ACR:

- **Dashboard** — `acr-view.ts` maps a built VPAT report onto the template's view shape, `acr-render.ts` renders it with mustache.js, inlines `acr.css` and the four self-hosted fonts as data URIs, and prints to PDF through headless Chromium (the browser the scanner already runs). The PDFKit path (`pdf/generator.ts`) stays only as a degrade fallback for hosts that cannot launch Chromium.
- **WordPress plugin** — `Luqen_Vpat::build_acr_view` builds the same view shape, and a tiny dependency-free PHP port (`Luqen_Mustache`) renders the *same* template. The port matches mustache.js byte for byte: identical HTML escaping (`& < > " ' / \` =`) and the standalone-tag whitespace rule. Rendering the same view data through both renderers diffs clean.

Edit the template or the stylesheet once and both surfaces change. Never fork the rendered markup into a consumer.

**Token basis.** Built strictly on the identity tokens above: oxblood identity (hue 25), citron reserved for the "Verified by Luqen" mark only, Inter + Inter Display + IBM Plex Mono. Light canvas, AAA contrast, because it is customer-shareable. Borderless tables, row separators only. The verdict line leads (see [The verdict line](#the-verdict-line)); the conformance tally is typographic, not cards; status rides on colour plus a word, never colour alone.

**Conservative by construction.** The verdict line claims "conforms" only when every assessed criterion supports. Criteria automation cannot confirm read "Not Evaluated" until a manual test is recorded; they are never assumed to pass.

**Sync mechanism.** `shared/acr/` in the dashboard monorepo is canonical. The WordPress plugin (separate repo) vendors a synced copy under `includes/acr/` plus the four TTFs under `assets/fonts/`. `scripts/sync-acr-template.sh` copies canonical → plugin; the vendored files are never hand-edited. Workflow: edit `shared/acr`, run the sync script in the plugin repo, commit the vendored copy with a CHANGELOG entry.

---

## Imagery and iconography

- **Icon set:** Phosphor Icons (open source, SIL OFL). Weight: `regular` only — no duotone, no filled, no thin. Always 16px or 20px or 24px, inline with text.
- **No stock photography.** Anywhere. Including marketing.
- **Logo:** wordmark in Inter Display 700, with a single rectangular notch in the `u`. Black on light, identity-accent on dark, never gradient. Favicon scales the wordmark to 16px (drops to just the marked `u`).
- **No checkmark icon in the logo or identity surfaces.** Checkmarks may appear in status badges.

---

## Accessibility contract

Tied to PRODUCT.md but enforced here.

- All text meets WCAG 2.2 AA at minimum on every surface. Customer-shareable surfaces (PDF, email, public report URL, embeddable badge) meet AAA.
- Focus ring (`--focus-ring`) is **always** visible — no `outline: none` without a replacement.
- All status colors paired with icon + label.
- Reduced motion respected; motion never carries information.
- Touch targets ≥44×44px on touch surfaces.
- Locale picker reachable from every screen.
- The CI pipeline runs Luqen against itself on every PR. AA failures block merge; AAA failures block merge on shareable surfaces.

---

## What this contract does **not** define

- Page-level layouts for new surfaces. Those live in per-phase plans under `.planning/phases/`.
- Marketing-site visual language. `luqen.dev` runs on the same tokens but is allowed brand-register expression per page (larger display sizes, single committed-color sections). It does not violate the bans; it does break the "restraint" Principle in service of brand expression. Documented per page.
- Per-plugin visual rules. Plugins (WordPress block, verdict badge) inherit identity tokens through a published CSS file and must not introduce new ones.
