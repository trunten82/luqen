# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full visual redesign of the Luqen dashboard with Emerald Professional palette, reusable partials library, dedicated error pages, sidebar fixes, and dark mode toggle — maintaining WCAG 2.1 AA compliance and zero RBAC regression.

**Architecture:** Server-rendered Handlebars + HTMX (no framework change). Redesign touches only the view layer: CSS design tokens, `.hbs` templates, `app.js`, and Fastify error handlers. All route handlers, permissions.ts, and middleware remain untouched.

**Tech Stack:** Handlebars, CSS custom properties, vanilla JS, Fastify (error handlers only), HTMX

**Spec:** `docs/superpowers/specs/2026-03-27-frontend-redesign.md`

---

## File Map

### New Files
- `src/views/partials/page-header.hbs` — reusable page title + subtitle + actions
- `src/views/partials/data-table.hbs` — reusable responsive table with empty state
- `src/views/partials/form-group.hbs` — reusable form field with label, hint, error, ARIA
- `src/views/partials/stat-card.hbs` — value + label + accent border card
- `src/views/partials/empty-state.hbs` — icon + message + action
- `src/views/partials/modal.hbs` — confirmation dialog with focus trap
- `src/views/partials/badge.hbs` — status badge with icon
- `src/views/partials/login-form.hbs` — parameterized auth form (password/API key)
- `src/views/partials/pagination.hbs` — load more / page controls
- `src/views/partials/alert.hbs` — banner alert with icon
- `src/views/errors/403.hbs` — access denied page
- `src/views/errors/404.hbs` — not found page
- `src/views/errors/429.hbs` — rate limited page with countdown
- `src/views/errors/500.hbs` — server error page

### Modified Files
- `src/static/style.css` — full rewrite (design tokens, components, layout)
- `src/static/app.js` — dark mode toggle, sidebar collapse/persist, minor cleanup
- `src/views/layouts/main.hbs` — dark mode script, sidebar collapse support
- `src/views/partials/sidebar.hbs` — Emerald palette, section labels, collapse toggle, dark mode toggle
- `src/views/partials/reports-table.hbs` — use data-table partial or restyle
- `src/views/login.hbs` — use login-form partial, reduce duplication
- `src/views/home.hbs` — use stat-card, data-table partials
- All 35 admin templates in `src/views/admin/` — use partials, restyle
- All core page templates — restyle to new design system
- `src/server.ts` — register new partials, add error handlers, update version string

---

## Task 1: CSS Design Tokens & Foundation

**Files:**
- Modify: `src/static/style.css` (lines 1-157 — design tokens, dark mode, reduced motion, reset)

This task replaces the design token layer and dark mode mechanism. The rest of the CSS file stays intact until later tasks restyle components.

- [ ] **Step 1: Replace light mode tokens**

Replace lines 8-97 in `style.css` with the Emerald Professional palette:

```css
:root {
  /* Background */
  --bg-primary: #ffffff;
  --bg-secondary: #fafafa;
  --bg-tertiary: #f3f4f6;
  --bg-sidebar: #14532d;
  --bg-sidebar-hover: #166534;
  --bg-sidebar-active: #15803d;

  /* Text */
  --text-primary: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --text-inverse: #ffffff;
  --text-sidebar: #bbf7d0;
  --text-sidebar-active: #ffffff;

  /* Accent / Brand */
  --accent: #16a34a;
  --accent-hover: #15803d;
  --accent-light: #f0fdf4;

  /* Status colours — always paired with icons/text, never colour-only */
  --status-success: #16a34a;
  --status-success-bg: #dcfce7;
  --status-warning: #d97706;
  --status-warning-bg: #fef3c7;
  --status-error: #dc2626;
  --status-error-bg: #fee2e2;
  --status-info: #2563eb;
  --status-info-bg: #dbeafe;
  --status-running: #2563eb;
  --status-running-bg: #dbeafe;
  --status-queued: #d97706;
  --status-queued-bg: #fef3c7;

  /* Borders */
  --border-color: #e5e7eb;
  --border-color-strong: #d1d5db;
  --border-radius: 8px;
  --border-radius-sm: 4px;
  --border-radius-lg: 10px;

  /* Focus */
  --focus-outline: 3px solid #16a34a;
  --focus-outline-offset: 2px;

  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;

  /* Typography */
  --font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: 'Fira Code', 'Cascadia Code', 'Consolas', 'Liberation Mono', monospace;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
  --font-size-3xl: 1.875rem;

  /* Sidebar */
  --sidebar-width: 260px;
  --sidebar-collapsed-width: 0px;

  /* Template accent */
  --accent-template: #7c3aed;
  --accent-template-light: #f3eaff;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-base: 250ms ease;

  /* Danger hover */
  --status-error-hover: #b91c1c;

  /* Line heights */
  --leading-tight: 1.2;
  --leading-normal: 1.5;
  --leading-relaxed: 1.6;
}
```

- [ ] **Step 2: Replace dark mode tokens**

Replace the `@media (prefers-color-scheme: dark)` block (lines 100-147) with a `[data-theme="dark"]` selector:

```css
[data-theme="dark"] {
  --bg-primary: #1f2937;
  --bg-secondary: #111827;
  --bg-tertiary: #374151;
  --bg-sidebar: #052e16;
  --bg-sidebar-hover: #14532d;
  --bg-sidebar-active: #166534;

  --text-primary: #f3f4f6;
  --text-secondary: #d1d5db;
  --text-muted: #9ca3af;
  --text-inverse: #111827;
  --text-sidebar: #86efac;
  --text-sidebar-active: #ffffff;

  --accent: #4ade80;
  --accent-hover: #22c55e;
  --accent-light: #052e16;

  --status-success: #4ade80;
  --status-success-bg: #052e16;
  --status-warning: #fbbf24;
  --status-warning-bg: #451a03;
  --status-error: #f87171;
  --status-error-bg: #450a0a;
  --status-info: #60a5fa;
  --status-info-bg: #172554;
  --status-running: #60a5fa;
  --status-running-bg: #172554;
  --status-queued: #fbbf24;
  --status-queued-bg: #451a03;

  --accent-template: #a78bfa;
  --accent-template-light: #2d1854;

  --border-color: #374151;
  --border-color-strong: #4b5563;

  --focus-outline: 3px solid #4ade80;

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);

  --status-error-hover: #ef4444;
}
```

- [ ] **Step 3: Verify build compiles**

Run: `cd /root/luqen && npm run build -w packages/dashboard`
Expected: Build succeeds. No functional changes yet — tokens only affect computed styles.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/static/style.css
git commit -m "feat: replace design tokens with Emerald Professional palette and data-theme dark mode"
```

---

## Task 2: Dark Mode Toggle — JS & Layout

**Files:**
- Modify: `src/views/layouts/main.hbs`
- Modify: `src/static/app.js`

- [ ] **Step 1: Add dark mode detection script to main.hbs `<head>`**

Add this script immediately after the `<link rel="stylesheet">` tag in `main.hbs`. This runs before paint to prevent flash of wrong theme:

```html
<script>
(function(){
  var s=localStorage.getItem('luqen-theme');
  if(s==='dark'||(s!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)){
    document.documentElement.setAttribute('data-theme','dark');
  }
})();
</script>
```

- [ ] **Step 2: Add theme toggle function to app.js**

Add at the end of `app.js`, before the `window` exports block:

```javascript
// Dark mode toggle — cycles: auto → light → dark → auto
function getThemePreference() {
  return localStorage.getItem('luqen-theme') || 'auto';
}

function applyTheme(pref) {
  var isDark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  // Update toggle button label
  var btn = document.getElementById('theme-toggle');
  if (btn) {
    var label = pref === 'auto' ? 'Auto' : pref === 'dark' ? 'Dark' : 'Light';
    btn.setAttribute('aria-label', 'Theme: ' + label + '. Click to change.');
    btn.setAttribute('title', 'Theme: ' + label);
    btn.textContent = isDark ? '\u263E' : '\u2600'; // ☾ or ☀
  }
}

function toggleTheme() {
  var current = getThemePreference();
  var next = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
  localStorage.setItem('luqen-theme', next);
  applyTheme(next);
}

// Listen for OS theme changes (applies when preference is 'auto')
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
  if (getThemePreference() === 'auto') applyTheme('auto');
});

// Apply on load
document.addEventListener('DOMContentLoaded', function() {
  applyTheme(getThemePreference());
});
```

- [ ] **Step 3: Export toggleTheme in window exports block**

Add `toggleTheme` to the existing window exports at the end of `app.js`:

```javascript
window.toggleTheme = toggleTheme;
```

- [ ] **Step 4: Verify build compiles**

Run: `cd /root/luqen && npm run build -w packages/dashboard`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/views/layouts/main.hbs packages/dashboard/src/static/app.js
git commit -m "feat: add dark mode toggle with localStorage persistence and flash prevention"
```

---

## Task 3: Sidebar Collapse — JS & CSS

**Files:**
- Modify: `src/static/app.js`
- Modify: `src/static/style.css` (sidebar section)

- [ ] **Step 1: Add sidebar collapse functions to app.js**

Add before the window exports block:

```javascript
// Sidebar collapse (desktop) — persists to localStorage
function collapseSidebar() {
  document.body.classList.add('sidebar-collapsed');
  localStorage.setItem('luqen-sidebar', 'collapsed');
}

function expandSidebar() {
  document.body.classList.remove('sidebar-collapsed');
  localStorage.setItem('luqen-sidebar', 'expanded');
}

function toggleCollapse() {
  if (document.body.classList.contains('sidebar-collapsed')) {
    expandSidebar();
  } else {
    collapseSidebar();
  }
}

// Restore sidebar state on load (desktop only)
document.addEventListener('DOMContentLoaded', function() {
  if (window.innerWidth > 768 && localStorage.getItem('luqen-sidebar') === 'collapsed') {
    document.body.classList.add('sidebar-collapsed');
  }
});
```

- [ ] **Step 2: Export collapse functions**

Add to window exports:

```javascript
window.collapseSidebar = collapseSidebar;
window.expandSidebar = expandSidebar;
window.toggleCollapse = toggleCollapse;
```

- [ ] **Step 3: Add sidebar collapse CSS**

Add after the existing sidebar CSS block in `style.css`:

```css
/* Sidebar collapse (desktop) */
@media (min-width: 768px) {
  .sidebar-collapsed .sidebar {
    display: none;
  }
  .sidebar-collapsed .main-content {
    margin-left: 0;
  }
  .sidebar-collapsed .app-header {
    left: 0;
  }
  .sidebar-collapsed .menu-toggle {
    display: flex;
  }
}

/* Show collapse toggle on desktop sidebar */
@media (min-width: 768px) {
  .sidebar__collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--text-sidebar);
    cursor: pointer;
    border-radius: var(--border-radius-sm);
    transition: background var(--transition-fast);
  }
  .sidebar__collapse-btn:hover {
    background: var(--bg-sidebar-hover);
  }
}
@media (max-width: 767px) {
  .sidebar__collapse-btn {
    display: none;
  }
}
```

- [ ] **Step 4: Verify build compiles**

Run: `cd /root/luqen && npm run build -w packages/dashboard`

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/static/app.js packages/dashboard/src/static/style.css
git commit -m "feat: add sidebar collapse with localStorage persistence for desktop"
```

---

## Task 4: Register New Partials in Server

**Files:**
- Modify: `src/server.ts` (Handlebars registration block)

- [ ] **Step 1: Add all new partials to the partials registration**

Find the `partials` object in the `@fastify/view` registration (around line 210-215) and add:

```typescript
partials: {
  sidebar: 'partials/sidebar.hbs',
  'reports-table': 'partials/reports-table.hbs',
  'page-header': 'partials/page-header.hbs',
  'data-table': 'partials/data-table.hbs',
  'form-group': 'partials/form-group.hbs',
  'stat-card': 'partials/stat-card.hbs',
  'empty-state': 'partials/empty-state.hbs',
  'modal-confirm': 'partials/modal.hbs',
  'badge': 'partials/badge.hbs',
  'login-form': 'partials/login-form.hbs',
  'pagination': 'partials/pagination.hbs',
  'alert': 'partials/alert.hbs',
},
```

- [ ] **Step 2: Create placeholder partials so build doesn't break**

Create each partial as a minimal placeholder. Each file just needs:

`src/views/partials/page-header.hbs`:
```handlebars
{{! page-header partial — placeholder }}
<header class="page-header">
  <h1 class="page-header__title">{{title}}</h1>
  {{#if subtitle}}<p class="page-header__subtitle">{{subtitle}}</p>{{/if}}
</header>
```

`src/views/partials/data-table.hbs`:
```handlebars
{{! data-table partial — placeholder }}
<div class="table-responsive" role="region" aria-label="{{caption}}" tabindex="0">
  <table class="data-table" aria-label="{{caption}}">
    <caption class="sr-only">{{caption}}</caption>
    {{{tableContent}}}
  </table>
</div>
```

`src/views/partials/form-group.hbs`:
```handlebars
{{! form-group partial — placeholder }}
<div class="form-group">
  <label for="{{inputId}}">
    {{label}}
    {{#if required}}<span class="required" aria-hidden="true">*</span>{{/if}}
  </label>
  {{{inputHtml}}}
  {{#if hint}}<p id="{{inputId}}-hint" class="form-hint">{{hint}}</p>{{/if}}
</div>
```

`src/views/partials/stat-card.hbs`:
```handlebars
{{! stat-card partial }}
<article class="stat-card" role="listitem" {{#if accentColor}}style="border-left: 3px solid {{accentColor}}"{{/if}}>
  <span class="stat-card__value" aria-label="{{value}} {{label}}">{{value}}</span>
  <span class="stat-card__label">{{label}}</span>
</article>
```

`src/views/partials/empty-state.hbs`:
```handlebars
{{! empty-state partial }}
<div class="empty-state" role="status">
  {{#if icon}}<div class="empty-state__icon" aria-hidden="true">{{{icon}}}</div>{{/if}}
  <p class="empty-state__message">{{message}}</p>
  {{#if actionUrl}}<a href="{{actionUrl}}" class="btn btn--primary">{{actionLabel}}</a>{{/if}}
</div>
```

`src/views/partials/modal.hbs`:
```handlebars
{{! modal partial }}
<div class="modal-overlay" data-action="closeModal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <div class="modal">
    <div class="modal__header">
      <h2 class="modal__title" id="modal-title">{{title}}</h2>
      <button class="modal__close close-modal-btn" aria-label="Close dialog">&times;</button>
    </div>
    <div class="modal__body">{{{body}}}</div>
    <div class="modal__footer">{{{footer}}}</div>
  </div>
</div>
```

`src/views/partials/badge.hbs`:
```handlebars
{{! badge partial }}
<span class="badge badge--{{status}}" aria-label="Status: {{label}}">
  {{label}}
</span>
```

`src/views/partials/login-form.hbs`:
```handlebars
{{! login-form partial — placeholder, will be filled in Task 8 }}
<p>Login form placeholder</p>
```

`src/views/partials/pagination.hbs`:
```handlebars
{{! pagination partial }}
{{#if hasMore}}
<div class="pagination">
  <button class="btn btn--ghost btn--sm load-more"
    hx-get="{{nextUrl}}" hx-target="{{target}}" hx-swap="beforeend">
    Load more
  </button>
</div>
{{/if}}
```

`src/views/partials/alert.hbs`:
```handlebars
{{! alert partial }}
<div class="alert alert--{{type}}" role="alert" aria-live="assertive">
  <svg class="alert__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
    <path d="M10 6v4M10 13v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
  <div class="alert__body">
    {{#if title}}<div class="alert__title">{{title}}</div>{{/if}}
    {{message}}
  </div>
</div>
```

- [ ] **Step 3: Verify build compiles**

Run: `cd /root/luqen && npm run build -w packages/dashboard`

- [ ] **Step 4: Run tests to verify no regression**

Run: `cd /root/luqen && npm test -w packages/dashboard 2>&1 | tail -20`
Expected: All tests pass — we haven't changed any template behavior yet.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/server.ts packages/dashboard/src/views/partials/
git commit -m "feat: register new partial templates and create placeholders"
```

---

## Task 5: Error Pages — Templates

**Files:**
- Create: `src/views/errors/403.hbs`
- Create: `src/views/errors/404.hbs`
- Create: `src/views/errors/429.hbs`
- Create: `src/views/errors/500.hbs`

Each error page is standalone (no main layout dependency) and includes its own CSS inline to work even if the stylesheet fails to load.

- [ ] **Step 1: Create 403 error page**

`src/views/errors/403.hbs`:
```handlebars
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Access Denied — Luqen</title>
  <link rel="stylesheet" href="/static/style.css">
  <script>
  (function(){
    var s=localStorage.getItem('luqen-theme');
    if(s==='dark'||(s!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)){
      document.documentElement.setAttribute('data-theme','dark');
    }
  })();
  </script>
  <style>
    .error-page{display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg-secondary);padding:var(--space-lg)}
    .error-card{background:var(--bg-primary);border-radius:var(--border-radius-lg);box-shadow:var(--shadow-lg);padding:var(--space-2xl);max-width:480px;width:100%;text-align:center}
    .error-card__logo{font-size:var(--font-size-xl);font-weight:700;color:var(--accent);margin-bottom:var(--space-xl);display:flex;align-items:center;justify-content:center;gap:var(--space-sm)}
    .error-card__illustration{margin:var(--space-lg) auto;color:var(--status-warning)}
    .error-card__title{font-size:var(--font-size-2xl);font-weight:700;color:var(--text-primary);margin-bottom:var(--space-sm)}
    .error-card__code{font-size:var(--font-size-3xl);font-weight:800;color:var(--text-muted);margin-bottom:var(--space-sm)}
    .error-card__desc{color:var(--text-secondary);line-height:var(--leading-relaxed);margin-bottom:var(--space-xl)}
    .error-card__actions{display:flex;gap:var(--space-md);justify-content:center;flex-wrap:wrap}
  </style>
</head>
<body>
  <main class="error-page" role="main">
    <div class="error-card">
      <div class="error-card__logo" aria-label="Luqen">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Luqen
      </div>

      <div class="error-card__illustration" aria-hidden="true">
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
          <rect x="20" y="15" width="40" height="50" rx="4" stroke="currentColor" stroke-width="2.5"/>
          <circle cx="40" cy="35" r="8" stroke="currentColor" stroke-width="2.5"/>
          <rect x="34" y="45" width="12" height="8" rx="2" stroke="currentColor" stroke-width="2.5"/>
          <path d="M30 55h20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </div>

      <div class="error-card__code">403</div>
      <h1 class="error-card__title">Access Denied</h1>
      <p class="error-card__desc">You don't have permission to view this page. Contact your organization admin if you believe this is a mistake.</p>

      <div class="error-card__actions">
        <a href="/" class="btn btn--primary">Go Home</a>
        <button onclick="history.back()" class="btn btn--ghost">Go Back</button>
      </div>
    </div>
  </main>
</body>
</html>
```

- [ ] **Step 2: Create 404 error page**

`src/views/errors/404.hbs`:
```handlebars
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Not Found — Luqen</title>
  <link rel="stylesheet" href="/static/style.css">
  <script>
  (function(){
    var s=localStorage.getItem('luqen-theme');
    if(s==='dark'||(s!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)){
      document.documentElement.setAttribute('data-theme','dark');
    }
  })();
  </script>
  <style>
    .error-page{display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg-secondary);padding:var(--space-lg)}
    .error-card{background:var(--bg-primary);border-radius:var(--border-radius-lg);box-shadow:var(--shadow-lg);padding:var(--space-2xl);max-width:480px;width:100%;text-align:center}
    .error-card__logo{font-size:var(--font-size-xl);font-weight:700;color:var(--accent);margin-bottom:var(--space-xl);display:flex;align-items:center;justify-content:center;gap:var(--space-sm)}
    .error-card__illustration{margin:var(--space-lg) auto;color:var(--status-info)}
    .error-card__title{font-size:var(--font-size-2xl);font-weight:700;color:var(--text-primary);margin-bottom:var(--space-sm)}
    .error-card__code{font-size:var(--font-size-3xl);font-weight:800;color:var(--text-muted);margin-bottom:var(--space-sm)}
    .error-card__desc{color:var(--text-secondary);line-height:var(--leading-relaxed);margin-bottom:var(--space-xl)}
    .error-card__actions{display:flex;gap:var(--space-md);justify-content:center;flex-wrap:wrap}
  </style>
</head>
<body>
  <main class="error-page" role="main">
    <div class="error-card">
      <div class="error-card__logo" aria-label="Luqen">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Luqen
      </div>

      <div class="error-card__illustration" aria-hidden="true">
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
          <circle cx="40" cy="40" r="24" stroke="currentColor" stroke-width="2.5"/>
          <line x1="56" y1="56" x2="68" y2="68" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <text x="33" y="46" font-size="20" font-weight="bold" fill="currentColor">?</text>
        </svg>
      </div>

      <div class="error-card__code">404</div>
      <h1 class="error-card__title">Page Not Found</h1>
      <p class="error-card__desc">The page you're looking for doesn't exist or has been moved.</p>

      <div class="error-card__actions">
        <a href="/" class="btn btn--primary">Go Home</a>
        <button onclick="history.back()" class="btn btn--ghost">Go Back</button>
      </div>
    </div>
  </main>
</body>
</html>
```

- [ ] **Step 3: Create 429 error page**

`src/views/errors/429.hbs`:
```handlebars
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Too Many Requests — Luqen</title>
  <link rel="stylesheet" href="/static/style.css">
  <script>
  (function(){
    var s=localStorage.getItem('luqen-theme');
    if(s==='dark'||(s!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)){
      document.documentElement.setAttribute('data-theme','dark');
    }
  })();
  </script>
  <style>
    .error-page{display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg-secondary);padding:var(--space-lg)}
    .error-card{background:var(--bg-primary);border-radius:var(--border-radius-lg);box-shadow:var(--shadow-lg);padding:var(--space-2xl);max-width:480px;width:100%;text-align:center}
    .error-card__logo{font-size:var(--font-size-xl);font-weight:700;color:var(--accent);margin-bottom:var(--space-xl);display:flex;align-items:center;justify-content:center;gap:var(--space-sm)}
    .error-card__illustration{margin:var(--space-lg) auto;color:var(--status-warning)}
    .error-card__title{font-size:var(--font-size-2xl);font-weight:700;color:var(--text-primary);margin-bottom:var(--space-sm)}
    .error-card__code{font-size:var(--font-size-3xl);font-weight:800;color:var(--text-muted);margin-bottom:var(--space-sm)}
    .error-card__desc{color:var(--text-secondary);line-height:var(--leading-relaxed);margin-bottom:var(--space-lg)}
    .error-card__countdown{font-size:var(--font-size-xl);font-weight:600;color:var(--accent);margin-bottom:var(--space-xl)}
    .error-card__actions{display:flex;gap:var(--space-md);justify-content:center;flex-wrap:wrap}
  </style>
</head>
<body>
  <main class="error-page" role="main">
    <div class="error-card">
      <div class="error-card__logo" aria-label="Luqen">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Luqen
      </div>

      <div class="error-card__illustration" aria-hidden="true">
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
          <circle cx="40" cy="40" r="24" stroke="currentColor" stroke-width="2.5"/>
          <path d="M40 24v18l10 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>

      <div class="error-card__code">429</div>
      <h1 class="error-card__title">Too Many Requests</h1>
      <p class="error-card__desc">You've made too many requests. Please wait and try again.</p>

      <div class="error-card__countdown" id="countdown" aria-live="polite" aria-atomic="true">
        Please wait...
      </div>

      <div class="error-card__actions">
        <button id="retry-btn" class="btn btn--primary" disabled onclick="location.reload()">
          Retry
        </button>
        <a href="/" class="btn btn--ghost">Go Home</a>
      </div>
    </div>
  </main>

  <script>
  (function() {
    var retryAfter = parseInt('{{retryAfter}}', 10) || 60;
    var remaining = retryAfter;
    var countdown = document.getElementById('countdown');
    var retryBtn = document.getElementById('retry-btn');

    function tick() {
      if (remaining <= 0) {
        countdown.textContent = 'You can retry now.';
        retryBtn.disabled = false;
        return;
      }
      var mins = Math.floor(remaining / 60);
      var secs = remaining % 60;
      countdown.textContent = 'Retry in ' + (mins > 0 ? mins + 'm ' : '') + secs + 's';
      remaining--;
      setTimeout(tick, 1000);
    }
    tick();
  })();
  </script>
</body>
</html>
```

- [ ] **Step 4: Create 500 error page**

`src/views/errors/500.hbs`:
```handlebars
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Something Went Wrong — Luqen</title>
  <link rel="stylesheet" href="/static/style.css">
  <script>
  (function(){
    var s=localStorage.getItem('luqen-theme');
    if(s==='dark'||(s!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)){
      document.documentElement.setAttribute('data-theme','dark');
    }
  })();
  </script>
  <style>
    .error-page{display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg-secondary);padding:var(--space-lg)}
    .error-card{background:var(--bg-primary);border-radius:var(--border-radius-lg);box-shadow:var(--shadow-lg);padding:var(--space-2xl);max-width:480px;width:100%;text-align:center}
    .error-card__logo{font-size:var(--font-size-xl);font-weight:700;color:var(--accent);margin-bottom:var(--space-xl);display:flex;align-items:center;justify-content:center;gap:var(--space-sm)}
    .error-card__illustration{margin:var(--space-lg) auto;color:var(--status-error)}
    .error-card__title{font-size:var(--font-size-2xl);font-weight:700;color:var(--text-primary);margin-bottom:var(--space-sm)}
    .error-card__code{font-size:var(--font-size-3xl);font-weight:800;color:var(--text-muted);margin-bottom:var(--space-sm)}
    .error-card__desc{color:var(--text-secondary);line-height:var(--leading-relaxed);margin-bottom:var(--space-xl)}
    .error-card__actions{display:flex;gap:var(--space-md);justify-content:center;flex-wrap:wrap}
  </style>
</head>
<body>
  <main class="error-page" role="main">
    <div class="error-card">
      <div class="error-card__logo" aria-label="Luqen">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Luqen
      </div>

      <div class="error-card__illustration" aria-hidden="true">
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
          <path d="M40 18L66 62H14L40 18z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M40 36v12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="40" cy="54" r="1.5" fill="currentColor"/>
        </svg>
      </div>

      <div class="error-card__code">500</div>
      <h1 class="error-card__title">Something Went Wrong</h1>
      <p class="error-card__desc">An unexpected error occurred. Our team has been notified.</p>

      <div class="error-card__actions">
        <button onclick="location.reload()" class="btn btn--primary">Try Again</button>
        <a href="/" class="btn btn--ghost">Go Home</a>
      </div>
    </div>
  </main>
</body>
</html>
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/views/errors/
git commit -m "feat: add styled error pages for 403, 404, 429 (with countdown), and 500"
```

---

## Task 6: Error Pages — Server Integration

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Read current error handling in server.ts**

Read `src/server.ts` to find existing error handler and not-found handler setup. Look for `setErrorHandler`, `setNotFoundHandler`, and the rate limit configuration.

- [ ] **Step 2: Add error template rendering helper**

Add a helper function near the top of the route setup section in `server.ts`:

```typescript
function wantsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept || '';
  const isHtmx = request.headers['hx-request'] === 'true';
  return !isHtmx && accept.includes('text/html');
}
```

- [ ] **Step 3: Add setNotFoundHandler**

```typescript
server.setNotFoundHandler((request, reply) => {
  if (wantsHtml(request)) {
    return reply.status(404).view('errors/404.hbs');
  }
  return reply.status(404).send({ error: 'Not Found' });
});
```

- [ ] **Step 4: Add setErrorHandler**

```typescript
server.setErrorHandler((error, request, reply) => {
  const status = error.statusCode || 500;

  if (status === 403 && wantsHtml(request)) {
    return reply.status(403).view('errors/403.hbs');
  }

  if (status === 429 && wantsHtml(request)) {
    const retryAfter = reply.getHeader('retry-after') || '60';
    return reply.status(429).view('errors/429.hbs', { retryAfter });
  }

  if (status >= 500 && wantsHtml(request)) {
    request.log.error(error);
    return reply.status(500).view('errors/500.hbs');
  }

  // JSON fallback for API requests
  return reply.status(status).send({
    error: error.message || 'Internal Server Error',
  });
});
```

- [ ] **Step 5: Configure rate limit to use error handler**

Find the `@fastify/rate-limit` registration and add `errorResponseBuilder` if not present:

```typescript
errorResponseBuilder: (_request, context) => {
  const error = new Error('Too Many Requests') as any;
  error.statusCode = 429;
  error.retryAfter = context.ttl;
  throw error;
},
```

Note: If the rate limiter uses a different error mechanism, adjust to ensure 429 errors flow through `setErrorHandler`.

- [ ] **Step 6: Register error templates with view engine**

The error pages are standalone (full HTML documents), but Fastify's `reply.view()` needs them accessible. Verify the views root directory includes `errors/` — since the root is set to `viewsDir` which is `src/views/`, the `errors/` subdirectory should be found automatically.

If `reply.view('errors/404.hbs')` renders inside the main layout (which we don't want for error pages since they're full documents), we need to bypass the layout. Check if `@fastify/view` supports a `layout: false` option:

```typescript
return reply.status(404).view('errors/404.hbs', {}, { layout: false });
```

If not supported, read the error template with `fs.readFileSync` and send as raw HTML instead.

- [ ] **Step 7: Verify build compiles and run tests**

Run: `cd /root/luqen && npm run build -w packages/dashboard && npm test -w packages/dashboard 2>&1 | tail -20`
Expected: Build succeeds, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/server.ts
git commit -m "feat: integrate error pages with Fastify error handlers and rate limiter"
```

---

## Task 7: Sidebar Redesign

**Files:**
- Modify: `src/views/partials/sidebar.hbs` (340 lines → ~250 lines)
- Modify: `src/static/style.css` (sidebar section)

**CRITICAL: Preserve ALL permission guards.** Before editing, extract the complete list of conditions from the current sidebar. Every `{{#if perm.*}}` must appear in the new version.

- [ ] **Step 1: Read current sidebar.hbs fully**

Read `src/views/partials/sidebar.hbs` and document every `{{#if}}` condition.

- [ ] **Step 2: Rewrite sidebar.hbs with Emerald styling and section labels**

Preserve every permission guard. Key changes:
- Add collapse toggle button at top (desktop)
- Add section labels ("Scanning", "Compliance", "Administration", "System")
- Add dark mode toggle in footer
- Clean up markup for consistency

```handlebars
<nav class="sidebar" id="sidebar" role="navigation" aria-label="Main navigation">
  <div class="sidebar__header">
    <a href="/" class="sidebar__logo" aria-label="Luqen — Home">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
        <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Luqen</span>
    </a>
    <button class="sidebar__collapse-btn" data-action="toggleCollapse" aria-label="Collapse sidebar">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M10 4L6 8l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>

  <div class="sidebar__nav">
    {{! ---- Scanning ---- }}
    <div class="sidebar__section-label">Scanning</div>
    <a href="/" class="sidebar__item {{#if (eq currentPath '/')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 10h14M10 3v14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.home"}}
    </a>
    {{#if perm.scansCreate}}
    <a href="/scan/new" class="sidebar__item {{#if (eq currentPath '/scan/new')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M10 7v6M7 10h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.newScan"}}
    </a>
    {{/if}}
    {{#if perm.scansSchedule}}
    <a href="/schedules" class="sidebar__item {{#if (eq currentPath '/schedules')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {{t "nav.schedules"}}
    </a>
    {{/if}}
    <a href="/reports" class="sidebar__item {{#if (startsWith currentPath '/reports')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4" y="3" width="12" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.reports"}}
    </a>
    <a href="/trends" class="sidebar__item {{#if (eq currentPath '/trends')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 17l5-5 3 3 6-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {{t "nav.trends"}}
    </a>
    {{#if perm.scansCreate}}
    <a href="/bookmarklet" class="sidebar__item {{#if (eq currentPath '/bookmarklet')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 3v14l5-3 5 3V3H5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      {{t "nav.bookmarklet"}}
    </a>
    {{/if}}
    <a href="/assignments" class="sidebar__item {{#if (eq currentPath '/assignments')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 10l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {{t "nav.assignments"}}
    </a>
    <a href="/fixes" class="sidebar__item {{#if (eq currentPath '/fixes')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M14 6L6 14M6 6l8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.fixes"}}
    </a>

    {{! ---- Compliance ---- }}
    {{#if perm.complianceView}}
    <div class="sidebar__section-label">Compliance</div>
    <a href="/admin/jurisdictions" class="sidebar__item {{#if (startsWith currentPath '/admin/jurisdictions')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M3 10h14M10 3a14 14 0 010 14M10 3a14 14 0 000 14" stroke="currentColor" stroke-width="1.5"/></svg>
      {{t "nav.jurisdictions"}}
    </a>
    <a href="/admin/regulations" class="sidebar__item {{#if (startsWith currentPath '/admin/regulations')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4" y="2" width="12" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 6h6M7 9h6M7 12h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.regulations"}}
    </a>
    <a href="/admin/proposals" class="sidebar__item {{#if (startsWith currentPath '/admin/proposals')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 4h12v12H4z" stroke="currentColor" stroke-width="1.5"/><path d="M8 8h4M8 11h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.proposals"}}
    </a>
    <a href="/admin/sources" class="sidebar__item {{#if (startsWith currentPath '/admin/sources')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><ellipse cx="10" cy="6" rx="6" ry="3" stroke="currentColor" stroke-width="1.5"/><path d="M4 6v8c0 1.66 2.69 3 6 3s6-1.34 6-3V6" stroke="currentColor" stroke-width="1.5"/></svg>
      {{t "nav.sources"}}
    </a>
    <a href="/admin/monitor" class="sidebar__item {{#if (eq currentPath '/admin/monitor')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="4" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 17h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.monitor"}}
    </a>
    {{#if perm.complianceManage}}
    <a href="/admin/clients" class="sidebar__item {{#if (startsWith currentPath '/admin/clients')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 9h6M7 12h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.oauthClients"}}
    </a>
    {{/if}}
    {{/if}}

    {{! ---- Plugins (admin) ---- }}
    {{#if perm.adminPlugins}}
    <div class="sidebar__section-label">Plugins</div>
    <a href="/admin/plugins" class="sidebar__item {{#if (eq currentPath '/admin/plugins')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>
      {{t "nav.plugins"}}
    </a>
    {{#each pluginAdminPages}}
    <a href="/admin/plugins/{{this.pluginId}}" class="sidebar__item {{#if (eq ../currentPath (concat '/admin/plugins/' this.pluginId))}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        {{#if (eq this.pluginId 'email-plugin')}}
        <rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3 7l7 4 7-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        {{else}}
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 7h6M7 10h6M7 13h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        {{/if}}
      </svg>
      {{this.label}}
    </a>
    {{/each}}
    {{/if}}

    {{! ---- Administration ---- }}
    {{#if perm.usersManageAny}}
    <div class="sidebar__section-label">Administration</div>
    <a href="/admin/dashboard-users" class="sidebar__item {{#if (startsWith currentPath '/admin/dashboard-users')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="7" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M3 17c0-3.31 3.13-6 7-6s7 2.69 7 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.dashboardUsers"}}
    </a>
    {{#if perm.adminTeams}}
    <a href="/admin/teams" class="sidebar__item {{#if (startsWith currentPath '/admin/teams')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="14" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M2 17c0-2.76 2.24-5 5-5s5 2.24 5 5M9 17c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.teams"}}
    </a>
    {{/if}}
    {{#if perm.adminRoles}}
    <a href="/admin/roles" class="sidebar__item {{#if (startsWith currentPath '/admin/roles')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2l7 4v6c0 3.87-3 7.22-7 8-4-.78-7-4.13-7-8V6l7-4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      {{t "nav.roles"}}
    </a>
    {{/if}}
    {{#if perm.adminOrg}}
    {{#if orgContext.currentOrg}}
    <a href="/admin/organizations/{{orgContext.currentOrg.id}}/members" class="sidebar__item {{#if (startsWith currentPath '/admin/organizations')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M7 10h6M10 7v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.myOrganization"}}
    </a>
    {{/if}}
    {{/if}}
    {{/if}}

    {{! ---- System (admin only) ---- }}
    {{#if perm.adminSystem}}
    <div class="sidebar__section-label">System</div>
    <a href="/admin/organizations" class="sidebar__item {{#if (eq currentPath '/admin/organizations')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="6" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M6 6V4a4 4 0 018 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.allOrganizations"}}
    </a>
    <a href="/admin/api-keys" class="sidebar__item {{#if (startsWith currentPath '/admin/api-keys')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="7" cy="10" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M11 10h6M14 8v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.apiKeys"}}
    </a>
    <a href="/admin/users" class="sidebar__item {{#if (startsWith currentPath '/admin/users')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 17v-1a4 4 0 014-4h4a4 4 0 014 4v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.5"/></svg>
      {{t "nav.apiUsers"}}
    </a>
    <a href="/admin/repos" class="sidebar__item {{#if (startsWith currentPath '/admin/repos')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 4h12v12H4z" stroke="currentColor" stroke-width="1.5"/><path d="M4 10h12" stroke="currentColor" stroke-width="1.5"/></svg>
      {{t "nav.repos"}}
    </a>
    <a href="/admin/webhooks" class="sidebar__item {{#if (startsWith currentPath '/admin/webhooks')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 2v4M10 14v4M2 10h4M14 10h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.webhooks"}}
    </a>
    <a href="/admin/system" class="sidebar__item {{#if (eq currentPath '/admin/system')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 1v3M10 16v3M1 10h3M16 10h3M4.2 4.2l2.1 2.1M13.7 13.7l2.1 2.1M4.2 15.8l2.1-2.1M13.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.system"}}
    </a>
    {{#if perm.auditView}}
    <a href="/admin/audit-log" class="sidebar__item {{#if (eq currentPath '/admin/audit-log')}}is-active{{/if}}">
      <svg class="sidebar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4" y="2" width="12" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 6h6M7 9h6M7 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      {{t "nav.auditLog"}}
    </a>
    {{/if}}
    {{/if}}
  </div>

  {{! ---- Footer ---- }}
  <div class="sidebar__footer">
    {{! Org switcher }}
    {{#if orgContext.availableOrgs.length}}
    <div class="sidebar__org-switcher">
      <form method="POST" action="/account/switch-org">
        <input type="hidden" name="_csrf" value="{{csrfToken}}">
        <select name="orgId" data-action-change="formAutoSubmit" aria-label="Switch organization">
          <option value="" {{#unless orgContext.currentOrg}}selected{{/unless}}>System (no org)</option>
          {{#each orgContext.availableOrgs}}
          <option value="{{this.id}}" {{#if (eq this.id ../orgContext.currentOrg.id)}}selected{{/if}}>{{this.name}}</option>
          {{/each}}
        </select>
      </form>
    </div>
    {{/if}}

    {{! Locale selector }}
    {{#if locales.length}}
    <div class="sidebar__locale">
      <form method="POST" action="/account/locale">
        <input type="hidden" name="_csrf" value="{{csrfToken}}">
        <select name="locale" data-action-change="formAutoSubmit" aria-label="Language">
          {{#each locales}}
          <option value="{{this}}" {{#if (eq this ../locale)}}selected{{/if}}>{{lookup ../localeLabels this}}</option>
          {{/each}}
        </select>
      </form>
    </div>
    {{/if}}

    <div class="sidebar__footer-row">
      <a href="/account/profile" class="sidebar__footer-user" aria-label="Profile: {{user.displayName}}">
        {{user.displayName}}
      </a>
      <button id="theme-toggle" class="sidebar__theme-btn" data-action="toggleTheme" aria-label="Toggle theme" title="Theme">
        &#9788;
      </button>
      <form method="POST" action="/logout" style="display:inline">
        <input type="hidden" name="_csrf" value="{{csrfToken}}">
        <button type="submit" class="sidebar__footer-logout" aria-label="Sign out">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l3-3-3-3M14 8H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </form>
    </div>
  </div>
</nav>
```

**Note:** The implementer MUST cross-reference this with the actual current sidebar.hbs to ensure every permission guard, every route, and every feature (org switcher, locale, plugin admin pages loop) is present. The template above covers all guards identified in the inventory but the exact `{{t "..."}}` keys and `currentPath` comparisons must match what the routes actually set.

- [ ] **Step 3: Update sidebar CSS in style.css**

Replace the existing sidebar CSS section with styles matching the Emerald palette. Key changes:
- Section labels: uppercase, small, muted green text
- Active item: 3px left border in `--accent` + lighter bg
- Theme toggle button styling
- Desktop: always visible (remove any `display:none` on desktop)
- Collapse button visible on desktop only

- [ ] **Step 4: Update main.hbs header for collapsed state**

Ensure the burger menu button in `main.hbs` header is visible when sidebar is collapsed on desktop (controlled by `.sidebar-collapsed .menu-toggle { display: flex }` from Task 3).

- [ ] **Step 5: Verify build and run tests**

Run: `cd /root/luqen && npm run build -w packages/dashboard && npm test -w packages/dashboard 2>&1 | tail -20`

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/views/partials/sidebar.hbs packages/dashboard/src/static/style.css packages/dashboard/src/views/layouts/main.hbs
git commit -m "feat: redesign sidebar with Emerald palette, section labels, collapse toggle, and dark mode button"
```

---

## Task 8: Login Page Redesign

**Files:**
- Modify: `src/views/login.hbs` (283 → ~80 lines)
- Modify: `src/views/partials/login-form.hbs`

- [ ] **Step 1: Create the login-form partial**

`src/views/partials/login-form.hbs`:
```handlebars
{{! Login form partial — reusable across solo/team/enterprise modes }}
<form method="POST" action="/login" novalidate>
  <input type="hidden" name="_csrf" value="{{csrfToken}}">
  {{#if showUsername}}
  <div class="form-group">
    <label for="{{usernameId}}">
      {{t "auth.usernameLabel"}}
      <span class="required" aria-hidden="true">*</span>
    </label>
    <input
      type="text"
      id="{{usernameId}}"
      name="username"
      autocomplete="username"
      autocapitalize="none"
      autocorrect="off"
      spellcheck="false"
      required
      aria-required="true"
      {{#if error}}aria-invalid="true" aria-describedby="login-error"{{/if}}
      value="{{username}}"
    >
  </div>

  <div class="form-group">
    <label for="{{passwordId}}">
      {{t "auth.passwordLabel"}}
      <span class="required" aria-hidden="true">*</span>
    </label>
    <input
      type="password"
      id="{{passwordId}}"
      name="password"
      autocomplete="current-password"
      required
      aria-required="true"
      {{#if error}}aria-invalid="true" aria-describedby="login-error"{{/if}}
    >
  </div>
  {{/if}}

  {{#if showApiKey}}
  <div class="form-group">
    <label for="{{apiKeyId}}">
      {{t "auth.apiKeyLabel"}}
      <span class="required" aria-hidden="true">*</span>
    </label>
    <input
      type="password"
      id="{{apiKeyId}}"
      name="apiKey"
      autocomplete="off"
      required
      aria-required="true"
      {{#if error}}aria-invalid="true" aria-describedby="login-error"{{/if}}
    >
  </div>
  {{/if}}

  <div class="form-group" style="margin-top: var(--space-lg)">
    <button type="submit" class="btn btn--primary btn--full btn--lg">
      {{buttonLabel}}
    </button>
  </div>
</form>
```

- [ ] **Step 2: Rewrite login.hbs using the partial**

```handlebars
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Sign in to Luqen">
  <title>{{t "auth.signInTitle"}} — {{t "common.appName"}}</title>
  <link rel="stylesheet" href="/static/style.css">
  <script>
  (function(){
    var s=localStorage.getItem('luqen-theme');
    if(s==='dark'||(s!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)){
      document.documentElement.setAttribute('data-theme','dark');
    }
  })();
  </script>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>

  <main id="main-content" class="login-page" role="main">
    <div class="login-card">
      <div class="login-card__logo" aria-label="Luqen">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="display:inline-block;vertical-align:middle;margin-right:8px">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        {{t "common.appName"}}
      </div>

      <h1 class="login-card__title">{{t "auth.signInTitle"}}</h1>
      <p class="login-card__subtitle">
        {{#if (eq mode "solo")}}{{t "auth.soloSubtitle"}}{{/if}}
        {{#if (eq mode "team")}}{{t "auth.teamSubtitle"}}{{/if}}
        {{#if (eq mode "enterprise")}}{{t "auth.enterpriseSubtitle"}}{{/if}}
        {{#unless mode}}{{t "auth.teamSubtitle"}}{{/unless}}
      </p>

      {{#if error}}
      {{> alert type="error" title=(t "auth.signInFailed") message=error}}
      {{/if}}

      {{! Solo mode: API key only }}
      {{#if (eq mode "solo")}}
      {{> login-form showApiKey=true apiKeyId="apiKey" buttonLabel=(t "auth.signInButton") csrfToken=csrfToken error=error}}
      {{/if}}

      {{! Enterprise mode: SSO + fallbacks }}
      {{#if (eq mode "enterprise")}}
      <div class="login-sso" style="margin-bottom: var(--space-lg)">
        {{#each loginMethods}}
          {{#if (eq this.type "sso")}}
          <a href="/auth/sso/{{this.pluginId}}" class="btn btn--primary btn--full btn--lg" style="margin-bottom: var(--space-sm); display: block; text-align: center; text-decoration: none;">
            Sign in with {{this.label}}
          </a>
          {{/if}}
        {{/each}}
      </div>
      <details class="login-password-fallback">
        <summary>{{t "auth.signInWithPassword"}}</summary>
        {{> login-form showUsername=true usernameId="username" passwordId="password" buttonLabel=(t "auth.signInButton") csrfToken=csrfToken error=error username=username}}
      </details>
      <details class="login-apikey-fallback" style="margin-top: var(--space-md)">
        <summary>{{t "auth.signInWithApiKey"}}</summary>
        {{> login-form showApiKey=true apiKeyId="apiKeyEnterprise" buttonLabel=(t "auth.signInWithApiKey") csrfToken=csrfToken error=error}}
      </details>
      {{/if}}

      {{! Team mode (or fallback) }}
      {{#if (eq mode "team")}}
      {{> login-form showUsername=true usernameId="username" passwordId="password" buttonLabel=(t "auth.signInButton") csrfToken=csrfToken error=error username=username}}
      <details class="login-apikey-fallback" style="margin-top: var(--space-lg)">
        <summary>{{t "auth.signInWithApiKey"}}</summary>
        {{> login-form showApiKey=true apiKeyId="apiKeyTeam" buttonLabel=(t "auth.signInWithApiKey") csrfToken=csrfToken error=error}}
      </details>
      {{/if}}

      {{! No mode fallback }}
      {{#unless mode}}
      {{> login-form showUsername=true usernameId="username" passwordId="password" buttonLabel=(t "auth.signInButton") csrfToken=csrfToken error=error username=username}}
      {{/unless}}
    </div>
  </main>
</body>
</html>
```

- [ ] **Step 3: Verify build and run tests**

Run: `cd /root/luqen && npm run build -w packages/dashboard && npm test -w packages/dashboard 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/views/login.hbs packages/dashboard/src/views/partials/login-form.hbs
git commit -m "refactor: deduplicate login page using login-form partial (283 → ~80 lines)"
```

---

## Task 9: CSS Component Restyle

**Files:**
- Modify: `src/static/style.css` (component sections: buttons, forms, tables, cards, badges, modals, toasts, etc.)

This task updates all component styles to match the Emerald Professional design. The tokens from Task 1 handle colors; this task adjusts border-radius, spacing, hover effects, and component-specific styling.

- [ ] **Step 1: Update button styles**

Key changes:
- `--border-radius-sm` (4px) for buttons
- Primary button uses `--accent` (green) bg with `--text-inverse` text
- Ensure primary button text contrast: use `--accent-hover` (`#15803d`) as button bg for 4.6:1 white text contrast
- Ghost button: transparent bg, `--border-color-strong` border
- All focus states use `--focus-outline` (green)

- [ ] **Step 2: Update form styles**

Key changes:
- Input border-radius: `--border-radius-sm` (4px)
- Focus ring: green outline
- Error state: red border + error bg
- Select custom arrow updated to match palette

- [ ] **Step 3: Update table styles**

Key changes:
- Table header: `--bg-tertiary` background
- Row hover: `--accent-light` tint
- Border color: `--border-color`
- Cell padding consistent

- [ ] **Step 4: Update card/stat-card styles**

Key changes:
- Stat cards: white bg, 3px left border in accent color
- Card border-radius: `--border-radius` (8px)
- Subtle shadow: `--shadow-sm`

- [ ] **Step 5: Update badge styles**

Key changes:
- Border-radius: `--border-radius-sm` (4px)
- Font-weight: 600
- Font-size: `--font-size-xs`
- Status badges use status token pairs

- [ ] **Step 6: Update modal, toast, alert styles**

Key changes:
- Modal border-radius: `--border-radius-lg`
- Toast uses status colors
- Alerts follow badge color pattern

- [ ] **Step 7: Update login page styles**

Key changes:
- Login card: emerald-tinted background (`--accent-light`)
- Card shadow: `--shadow-lg`
- Logo color: `--accent`

- [ ] **Step 8: Update sidebar styles**

Ensure sidebar CSS matches the Emerald palette:
- Background: `--bg-sidebar` (Forest-900)
- Active item: 3px left border `--accent`, lighter bg
- Section labels: uppercase, `--font-size-xs`, `--text-sidebar` with 60% opacity
- Desktop: always visible (`display: flex` at min-width 768px)
- Sidebar footer: darker bg strip

- [ ] **Step 9: Fix desktop sidebar visibility**

Ensure this CSS is present:
```css
@media (min-width: 768px) {
  .sidebar {
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    left: 0;
    width: var(--sidebar-width);
    height: 100vh;
    z-index: 100;
  }
  .menu-toggle {
    display: none;
  }
}
```

Remove any CSS that hides the sidebar on desktop.

- [ ] **Step 10: Verify build**

Run: `cd /root/luqen && npm run build -w packages/dashboard`

- [ ] **Step 11: Commit**

```bash
git add packages/dashboard/src/static/style.css
git commit -m "feat: restyle all CSS components to Emerald Professional design system"
```

---

## Task 10: Main Layout Update

**Files:**
- Modify: `src/views/layouts/main.hbs`

- [ ] **Step 1: Update main.hbs**

Key changes:
- Update CSS version string (`style.css?v=1.0.0`)
- Ensure dark mode script is in `<head>` (added in Task 2)
- Add `data-theme` to `<html>` tag: `<html lang="{{locale}}" data-theme="light">`
- Ensure header includes sidebar expand button for collapsed state

Updated header section:
```handlebars
<header class="app-header" role="banner">
  <button class="menu-toggle" id="mobile-menu-btn" data-action="toggleSidebar" aria-label="Toggle navigation menu" aria-expanded="false">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>
  <span class="app-header__brand">{{t "common.appName"}}</span>
  {{#if user}}
  <span class="app-header__user">{{user.displayName}}</span>
  {{/if}}
</header>
```

- [ ] **Step 2: Verify build**

Run: `cd /root/luqen && npm run build -w packages/dashboard`

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/views/layouts/main.hbs
git commit -m "feat: update main layout with dark mode support and version bump"
```

---

## Task 11: Home Page Redesign

**Files:**
- Modify: `src/views/home.hbs`

- [ ] **Step 1: Read current home.hbs**

- [ ] **Step 2: Refactor to use stat-card partial**

Replace the inline stat card markup with:
```handlebars
<div class="stats-grid" role="list" aria-label="Summary statistics">
  {{> stat-card value=stats.totalScans label=(t "home.totalScans") accentColor="var(--accent)"}}
  {{> stat-card value=stats.scansThisWeek label=(t "home.scansThisWeek") accentColor="var(--status-info)"}}
  {{> stat-card value=stats.pagesScanned label=(t "home.pagesScanned") accentColor="var(--accent)"}}
  {{> stat-card value=stats.issuesFound label=(t "home.issuesFound") accentColor="var(--status-error)"}}
</div>
```

- [ ] **Step 3: Preserve all permission guards**

Ensure `{{#if perm.scansCreate}}`, `{{#unless isExecutiveView}}`, `{{#if isExecutiveView}}`, and `{{#if jurisdictions.length}}` are preserved in the correct structural locations.

- [ ] **Step 4: Verify build and run tests**

Run: `cd /root/luqen && npm run build -w packages/dashboard && npm test -w packages/dashboard 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/views/home.hbs
git commit -m "refactor: redesign home page using stat-card partials"
```

---

## Task 12: Admin Pages Redesign (Batch)

**Files:**
- Modify: All 35 admin templates in `src/views/admin/`

This is the largest task. Each admin page follows one of two patterns:
1. **List page**: Page header + data table (+ optional create button)
2. **Form page**: Page header + form fields

The implementer should work through these systematically, one page at a time, preserving all permission guards.

- [ ] **Step 1: Redesign list pages**

For each list page (dashboard-users.hbs, teams.hbs, roles.hbs, organizations.hbs, api-keys.hbs, users.hbs, webhooks.hbs, clients.hbs, jurisdictions.hbs, regulations.hbs, sources.hbs, proposals.hbs, plugins.hbs, email-reports.hbs):

1. Read the current template
2. Extract all `{{#if perm.*}}` guards
3. Rewrite using `page-header` partial for the header section
4. Restyle table markup to match new design (keep inline — the data-table partial is for simple cases; complex tables with action buttons stay inline but use consistent CSS classes)
5. Verify all guards present
6. Build and test

- [ ] **Step 2: Redesign form pages**

For each form page (dashboard-user-form.hbs, role-form.hbs, organization-form.hbs, team-detail.hbs, api-key-form.hbs, api-key-view.hbs, user-form.hbs, webhook-form.hbs, client-form.hbs, jurisdiction-form.hbs, jurisdiction-view.hbs, regulation-form.hbs, regulation-view.hbs, source-form.hbs, source-view.hbs):

1. Read the current template
2. Rewrite form fields using consistent markup (use `form-group` partial where appropriate)
3. Ensure all ARIA attributes are present
4. Build and test

- [ ] **Step 3: Redesign remaining admin pages**

Handle special pages: audit-log.hbs, monitor.hbs, system.hbs, organization-members.hbs, roles-global-panel.hbs, roles-org-panel.hbs

- [ ] **Step 4: Verify all tests pass**

Run: `cd /root/luqen && npm test -w packages/dashboard 2>&1 | tail -30`
Expected: All 800+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/views/admin/
git commit -m "refactor: redesign all admin pages with consistent Emerald styling and partials"
```

---

## Task 13: Core Pages Redesign

**Files:**
- Modify: `src/views/scan-new.hbs`, `scan-progress.hbs`, `reports-list.hbs`, `report-detail.hbs`, `report-compare.hbs`, `report-print.hbs`, `trends.hbs`, `schedules.hbs`, `assignments.hbs`, `manual-tests.hbs`, `repos.hbs`, `bookmarklet.hbs`, `fixes.hbs`, `account/profile.hbs`

- [ ] **Step 1: Redesign scan pages**

Read and restyle `scan-new.hbs` and `scan-progress.hbs`. Preserve the SSE progress connection and all form elements.

- [ ] **Step 2: Redesign report pages**

Read and restyle `reports-list.hbs`, `report-detail.hbs`, `report-compare.hbs`, `report-print.hbs`. The report detail page is the most complex (~400 lines) with extensive permission guards (`perm.issuesAssign`, `perm.issuesFix`, `perm.reportsViewTechnical`, `perm.manualTesting`). Preserve all of them.

- [ ] **Step 3: Redesign remaining core pages**

Restyle trends, schedules, assignments, manual-tests, repos, bookmarklet, fixes, profile. Each page: read current, identify guards, restyle, verify.

- [ ] **Step 4: Update reports-table.hbs partial**

Restyle the shared reports table partial to match new design.

- [ ] **Step 5: Verify all tests pass**

Run: `cd /root/luqen && npm test -w packages/dashboard 2>&1 | tail -30`

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/views/
git commit -m "refactor: redesign all core pages with Emerald Professional styling"
```

---

## Task 14: Final CSS Cleanup

**Files:**
- Modify: `src/static/style.css`

- [ ] **Step 1: Remove dead CSS**

After all templates are updated, search for CSS classes that are no longer used. Remove them to reduce file size.

- [ ] **Step 2: Verify dark mode works across all components**

Check every component section has appropriate token usage — no hardcoded colors remaining.

- [ ] **Step 3: Verify responsive design**

Ensure all pages work at mobile breakpoint (<=767px). Tables should stack to card layout, sidebar hides, forms go full-width.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/static/style.css
git commit -m "chore: remove dead CSS and verify dark mode/responsive coverage"
```

---

## Task 15: Full Test Suite & Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `cd /root/luqen && npm run build -w packages/dashboard`
Expected: Clean build, no TypeScript errors.

- [ ] **Step 2: Run full test suite**

Run: `cd /root/luqen && npm test -w packages/dashboard`
Expected: All 800+ tests pass. Zero failures.

- [ ] **Step 3: Check for permission guard completeness**

Search all new/modified templates for permission flags. Compare with the inventory from the exploration phase:

```bash
grep -rn '{{#if perm\.' packages/dashboard/src/views/ | sort
```

Verify the count and locations match expectations.

- [ ] **Step 4: Verify HTMX interactions still work**

Spot-check that `hx-get`, `hx-post`, `hx-target`, `hx-swap` attributes are preserved in all templates. HTMX partial rendering (toast responses, inline updates) should continue working.

- [ ] **Step 5: Commit any fixes**

If any issues found, fix and commit:
```bash
git add -A && git commit -m "fix: address test failures and permission guard gaps after redesign"
```

---

## Task 16: WCAG Compliance Self-Scan

**Files:** None (validation only)

- [ ] **Step 1: Build and deploy locally**

```bash
cd /root/luqen && npm run build -w packages/dashboard
```

Start the server locally for scanning.

- [ ] **Step 2: Run Luqen's compliance scanner against itself**

Use the dashboard to start a new scan:
- URL: `http://localhost:<port>` (the dashboard's own URL)
- Standard: WCAG 2.1 AA
- Jurisdictions: EU
- Scan mode: Full site

- [ ] **Step 3: Review scan results**

Check the scan report for:
- Contrast ratio failures
- Missing ARIA labels
- Missing alt text
- Form label associations
- Focus management issues

- [ ] **Step 4: Fix any WCAG issues found**

Address each issue in the templates or CSS. Re-scan after fixes.

- [ ] **Step 5: Commit fixes**

```bash
git add -A && git commit -m "fix: address WCAG 2.1 AA issues found by self-scan"
```

---

## Task 17: Final Commit & PR

- [ ] **Step 1: Verify clean git status**

```bash
git status
git diff --stat develop..HEAD
```

- [ ] **Step 2: Push and create PR**

```bash
git push origin develop
```

Create PR targeting master with summary of all changes.
