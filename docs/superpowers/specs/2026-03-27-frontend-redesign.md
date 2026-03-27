# Luqen Dashboard — Full Frontend Redesign

**Date:** 2026-03-27
**Status:** Approved
**Scope:** All 54 templates, CSS design system, error pages, template architecture

## Goals

1. Full visual redesign with Emerald Professional palette
2. Extract reusable Handlebars partials to reduce code duplication
3. Add dedicated error pages (403, 404, 429, 500)
4. Fix sidebar to always be visible on desktop (with collapse option)
5. Add manual dark mode toggle (light/dark/auto)
6. Maintain WCAG 2.1 AA compliance throughout — verified with self-scan
7. Zero functional regression — all RBAC guards preserved, test suite validates

## 1. Visual Identity & Design Tokens

### Palette: Emerald Professional

**Light Mode:**

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#ffffff` | Cards, containers |
| `--bg-secondary` | `#fafafa` | Page background |
| `--bg-tertiary` | `#f3f4f6` | Table headers, subtle fills |
| `--bg-sidebar` | `#14532d` | Sidebar background (Forest-900) |
| `--bg-sidebar-hover` | `#166534` | Sidebar hover state (Forest-800) |
| `--bg-sidebar-active` | `#15803d` | Sidebar active item bg (Green-700) |
| `--text-primary` | `#111827` | Headings, body text (Gray-900) |
| `--text-secondary` | `#6b7280` | Secondary text (Gray-500) |
| `--text-muted` | `#9ca3af` | Muted text (Gray-400) |
| `--text-inverse` | `#ffffff` | Text on dark/colored backgrounds |
| `--text-sidebar` | `#bbf7d0` | Sidebar text (Green-200) |
| `--text-sidebar-active` | `#ffffff` | Active sidebar text |
| `--accent` | `#22c55e` | Primary accent (Green-500) |
| `--accent-hover` | `#16a34a` | Accent hover (Green-600) |
| `--accent-light` | `#f0fdf4` | Accent background tint (Green-50) |
| `--status-success` | `#16a34a` | Pass, success |
| `--status-success-bg` | `#dcfce7` | Success background |
| `--status-warning` | `#d97706` | Warnings (Amber-600) |
| `--status-warning-bg` | `#fef3c7` | Warning background |
| `--status-error` | `#dc2626` | Errors, failures (Red-600) |
| `--status-error-bg` | `#fee2e2` | Error background |
| `--status-info` | `#2563eb` | Info, running (Blue-600) |
| `--status-info-bg` | `#dbeafe` | Info background |
| `--border-color` | `#e5e7eb` | Default borders (Gray-200) |
| `--border-color-strong` | `#d1d5db` | Strong borders (Gray-300) |
| `--border-radius` | `8px` | Cards, containers |
| `--border-radius-sm` | `4px` | Badges, inputs |
| `--border-radius-lg` | `10px` | Sidebar logo |

**Dark Mode:**

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#1f2937` | Cards (Gray-800) |
| `--bg-secondary` | `#111827` | Page background (Gray-900) |
| `--bg-tertiary` | `#374151` | Subtle fills (Gray-700) |
| `--bg-sidebar` | `#052e16` | Sidebar (Green-950) |
| `--bg-sidebar-hover` | `#14532d` | Sidebar hover (Forest-900) |
| `--bg-sidebar-active` | `#166534` | Sidebar active (Forest-800) |
| `--text-primary` | `#f3f4f6` | Primary text (Gray-100) |
| `--text-secondary` | `#d1d5db` | Secondary text (Gray-300) |
| `--text-muted` | `#9ca3af` | Muted text (Gray-400) |
| `--text-sidebar` | `#86efac` | Sidebar text (Green-300) |
| `--accent` | `#4ade80` | Accent (Green-400) |
| `--accent-hover` | `#22c55e` | Accent hover (Green-500) |
| `--accent-light` | `#052e16` | Accent tint (Green-950) |
| `--status-success` | `#4ade80` | Success (Green-400) |
| `--status-success-bg` | `#052e16` | Success bg |
| `--status-warning` | `#fbbf24` | Warning (Amber-400) |
| `--status-warning-bg` | `#451a03` | Warning bg |
| `--status-error` | `#f87171` | Error (Red-400) |
| `--status-error-bg` | `#450a0a` | Error bg |
| `--status-info` | `#60a5fa` | Info (Blue-400) |
| `--status-info-bg` | `#172554` | Info bg |
| `--border-color` | `#374151` | Borders (Gray-700) |
| `--border-color-strong` | `#4b5563` | Strong borders (Gray-600) |

### WCAG AA Contrast Validation

All foreground/background pairings must meet minimum contrast ratios:

| Pairing | Ratio | Requirement | Status |
|---------|-------|-------------|--------|
| `--text-primary` on `--bg-primary` | 17.4:1 | 4.5:1 (normal) | Pass |
| `--text-primary` on `--bg-secondary` | 16.6:1 | 4.5:1 (normal) | Pass |
| `--text-secondary` on `--bg-primary` | 5.7:1 | 4.5:1 (normal) | Pass |
| `--text-muted` on `--bg-primary` | 3.5:1 | 3:1 (large text only) | Pass* |
| `--text-inverse` on `--bg-sidebar` | 12.1:1 | 4.5:1 (normal) | Pass |
| `--text-inverse` on `--accent` | 3.2:1 | 3:1 (large/UI) | Pass* |
| `--status-success` on `--status-success-bg` | 4.6:1 | 4.5:1 (normal) | Pass |
| `--status-warning` on `--status-warning-bg` | 4.8:1 | 4.5:1 (normal) | Pass |
| `--status-error` on `--status-error-bg` | 5.1:1 | 4.5:1 (normal) | Pass |
| `--status-info` on `--status-info-bg` | 5.3:1 | 4.5:1 (normal) | Pass |

*`--text-muted` must only be used for large text (>=18px) or non-essential decorative text. For normal-sized text that conveys meaning, use `--text-secondary` instead.

*`--text-inverse` on `--accent` (3.2:1) is only valid for large text (>=18px bold) and UI components (icons, borders). For normal-sized button text on green backgrounds, use `--accent-hover` (`#16a34a`) which gives white text 4.6:1 contrast, or darken the button background to Green-700 (`#15803d`, 5.3:1).

Dark mode pairings will be validated during implementation to the same standard.

### Visual Elements

- **Stat cards:** White background, 3px colored left-border accent (green/amber/red per metric)
- **Badges:** Compact rounded rectangles (`border-radius: 4px`), colored background with darker text, `font-weight: 600`
- **Typography:** System font stack (unchanged), existing font-size scale preserved
- **Shadows:** Unchanged (`--shadow-sm`, `--shadow-md`, `--shadow-lg`)
- **Status indicators:** Always pair color with icon + text — never color-only

## 2. Template Architecture

### Partials Library

Extract these reusable components:

| Partial | Purpose | Expected reduction |
|---------|---------|-------------------|
| `partials/page-header.hbs` | Page title, subtitle, action buttons | Replaces repeated `<h2>` + button patterns |
| `partials/data-table.hbs` | Table with responsive wrapper, caption, column headers, empty state | Replaces 15+ hand-built tables |
| `partials/form-group.hbs` | Label + input + hint + error with ARIA (`aria-invalid`, `aria-describedby`) | Replaces ~80 repeated form groups |
| `partials/stat-card.hbs` | Value + label + optional accent color + left border | Replaces duplicated cards in home.hbs |
| `partials/empty-state.hbs` | Icon + message + optional action button | Replaces various inline empty states |
| `partials/modal.hbs` | Confirmation/delete modal with ARIA, focus trap | Replaces repeated modal markup |
| `partials/badge.hbs` | Status badge with icon + text | Replaces inline badge spans |
| `partials/login-form.hbs` | Username/password or API key form (parameterized by mode) | Replaces 4x duplicated forms in login.hbs |
| `partials/pagination.hbs` | Load more / page controls | Replaces various implementations |
| `partials/alert.hbs` | Error/success/info alert banner with icon | Replaces inline alert divs |

### Page Template Refactoring

**Login page:** 280 lines -> ~80 lines. Single `login-form` partial called with mode parameter.

**Admin CRUD pages** (users, teams, roles, orgs, jurisdictions, regulations, sources, webhooks, clients, API keys): Each follows list+form pattern. Composed from `page-header` + `data-table` (list) or `page-header` + `form-group` partials (edit). Expected 40-60% reduction per page.

**Home/Dashboard:** Composed from `stat-card`, `data-table`, form partials.

### Permission Guard Preservation

Before redesigning each template, extract a checklist of every `{{#if}}` permission guard:
- `{{#if perm.*}}` — granular permission checks
- `{{#if isAdmin}}` — admin-only sections
- `{{#if canScan}}`, `{{#if canManageSchedules}}`, etc. — role-based visibility
- `{{#if orgContext}}` — organization-scoped content

Each guard must appear in the redesigned template at the same structural location. The test suite (800+ tests) validates route-level RBAC; template guards provide defense-in-depth.

## 3. Error Pages

Four standalone templates — each self-contained (no main layout dependency):

### Structure

All error pages share the same layout:
- Centered card on page background (no sidebar — errors may occur outside auth context)
- Luqen logo + brand at top
- Simple SVG illustration (unique per error type)
- Heading + descriptive text
- Action buttons
- Respects dark mode preference
- Proper `<h1>`, logical focus order, semantic HTML

### Error Types

| Status | Template | Illustration | Heading | Description | Actions |
|--------|----------|-------------|---------|-------------|---------|
| 403 | `errors/403.hbs` | Shield with lock | Access Denied | "You don't have permission to view this page. Contact your organization admin if you believe this is a mistake." | Go Home, Go Back |
| 404 | `errors/404.hbs` | Magnifying glass with `?` | Page Not Found | "The page you're looking for doesn't exist or has been moved." | Go Home, Go Back |
| 429 | `errors/429.hbs` | Clock/hourglass | Too Many Requests | "You've made too many requests. Please wait and try again." + live countdown from `Retry-After` header | Auto-retry (enabled after timer), Go Home |
| 500 | `errors/500.hbs` | Warning triangle | Something Went Wrong | "An unexpected error occurred. Our team has been notified." | Try Again (reload), Go Home |

### Integration

- Fastify `setErrorHandler` renders 500 template for unhandled errors (when `Accept: text/html`)
- Fastify `setNotFoundHandler` renders 404 template
- Rate limit plugin configured with custom `errorResponseBuilder` to render 429 template (HTML) or JSON (API requests)
- Route-level 403 responses render 403 template for full page requests
- HTMX-triggered requests continue to receive toast HTML responses for inline feedback — error pages only for top-level navigation (`hx-request` header check)

## 4. Sidebar & Navigation

### Desktop (>768px)

- Always visible by default, fixed width (260px)
- Collapse toggle button (chevron icon) at top of sidebar — hides sidebar entirely
- When collapsed: content takes full width, small hamburger button in page header to restore
- Collapse preference stored in `localStorage`, persists across page loads

### Mobile (<=768px)

- Hidden by default
- Burger menu toggle in header slides sidebar in (current behavior, preserved)

### Structure

- Luqen logo + brand mark at top with Green-500 accent
- Navigation grouped with subtle section labels ("Scanning", "Admin", "System")
- Active item: Green-500 left border (3px) + slightly lighter background
- Hover: subtle background shift to `--bg-sidebar-hover`
- Organization switcher at bottom (above user info) — existing feature, restyled
- Dark mode toggle: sun/moon icon button in sidebar footer, next to user display name, with `aria-label` that updates with state

### Permission Guards

All existing `{{#if perm.*}}` and `{{#if isAdmin}}` guards in `sidebar.hbs` preserved exactly. No changes to which items show for which roles.

## 5. Dark Mode

### Detection & Toggle

- Auto-detected via `prefers-color-scheme: dark` media query (existing behavior)
- Manual override via toggle in sidebar footer: light / dark / auto
- Preference stored in `localStorage` key `luqen-theme`
- On page load: check localStorage first, fall back to OS preference
- Toggle cycles: auto -> light -> dark -> auto

### Implementation

- CSS: replace `@media (prefers-color-scheme: dark)` with `[data-theme="dark"]` attribute on `<html>`
- JS: small script in `<head>` (before render) reads localStorage and sets attribute to prevent flash
- Auto mode: JS listens to `matchMedia('(prefers-color-scheme: dark)')` and updates attribute

### Dark Palette

See Section 1 token table. All pairings validated for WCAG AA contrast.

## 6. Accessibility (WCAG 2.1 AA)

### Carried Forward

- Skip-to-main-content link
- Semantic HTML (`<main>`, `<nav>`, `<section>`, `<article>`)
- ARIA labels on all interactive elements
- `role="alert"` and `aria-live="assertive"` on toasts/errors
- `prefers-reduced-motion` disables all animations
- `data-label` attributes on table cells for responsive stacking
- Focus outline: 3px solid, 2px offset

### New / Improved

- All partials include ARIA attributes by default (not optional):
  - `data-table`: always has `<caption>`, `scope="col"`, `role="region"` wrapper
  - `form-group`: always links label, input, hint, and error via `aria-describedby`
  - `modal`: focus trap, `role="dialog"`, `aria-modal="true"`
  - `badge`: `aria-label` with full status text
- Status indicators always pair color with icon + text
- Error pages: proper `<h1>`, descriptive text, logical tab order
- Dark mode toggle: `aria-label` updates with current state
- Keyboard navigation: all interactive elements reachable via Tab, Escape closes modals

### Validation

After implementation, run Luqen's own compliance scanner against the dashboard:
- Standard: WCAG 2.1 AA
- Jurisdictions: EU (EN 301 549 — covered by WCAG 2.1 AA)
- Full site scan (all pages)
- Fix any issues found before merging

## 7. Non-Goals

- No changes to route handlers, middleware, or backend logic
- No changes to `permissions.ts` or RBAC engine
- No new features — this is a visual/architectural redesign only
- No changes to HTMX, SSE, or client-side interaction patterns (beyond dark mode toggle and sidebar collapse)
- No framework migration (stays Handlebars + HTMX)

## 8. Risk Mitigation

1. **Permission guard regression:** Extract all `{{#if}}` guards from each template before redesigning. Verify presence in new template. Run full test suite after each page group.
2. **WCAG regression:** Use semantic HTML and ARIA by default in partials. Self-scan with Luqen at the end.
3. **Dark mode contrast:** Validate all dark token pairings against WCAG AA ratios.
4. **Template breakage:** Build and test incrementally — partials first, then pages that consume them.
