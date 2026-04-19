/**
 * Phase 31.1 Plan 02 D-23 — Render the OAuth consent screen to a standalone
 * HTML file so pa11y can scan it against WCAG 2.1 AA.
 *
 * Output: /tmp/pa11y-consent/consent.html
 *
 * Run:
 *   tsx packages/dashboard/scripts/render-consent-for-pa11y.mts
 *   pa11y --standard WCAG2AA --reporter cli /tmp/pa11y-consent/consent.html
 *
 * The HTML includes a minimal inline stylesheet that mirrors the dashboard's
 * design-system tokens so pa11y sees real contrast ratios. This is a
 * verification artefact — it is NOT shipped. Production rendering uses the
 * full dashboard layout + style.css via the server's handlebars engine.
 */

import Handlebars from 'handlebars';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const viewsDir = new URL('../src/views/', import.meta.url).pathname;
const consent = readFileSync(join(viewsDir, 'oauth-consent.hbs'), 'utf8');

Handlebars.registerHelper('t', (k: string) => String(k));
Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

const template = Handlebars.compile(consent);
const rendered = template({
  csrfToken: 'test-csrf-token-xyz',
  adminScopeBlocked: false,
  client: { clientName: 'Claude Desktop (Test)' },
  user: { username: 'alice', role: 'admin' },
  orgName: 'Acme Org',
  clientId: 'dcr_test_client',
  redirectUri: 'https://app.example.com/callback',
  requestedScope: 'read write',
  requestedResource: 'https://mcp.example.com/mcp',
  resources: ['https://mcp.example.com/mcp'],
  scopeDescriptions: [
    { scope: 'read', description: 'Read scan reports, brand scores, and similar view-only data' },
    { scope: 'write', description: 'Trigger scans and make writes' },
  ],
  state: 'abc123',
  codeChallenge: 'a'.repeat(43),
});

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Authorize — Luqen</title>
<style>
  /* Dashboard design-system tokens (subset mirroring style.css) */
  :root {
    --color-bg: #f6f7f9;
    --color-surface: #ffffff;
    --color-text: #111418;
    --color-text-muted: #5a636d;
    --color-border: #cfd4da;
    --color-primary: #0b57c2;
    --color-primary-text: #ffffff;
    --color-secondary-bg: #e4e7eb;
    --color-secondary-text: #111418;
    --color-danger-bg: #fce3e4;
    --color-danger-text: #4f0b0d;
    --color-danger-border: #a10c13;
  }
  body { font-family: system-ui, sans-serif; margin: 0; background: var(--color-bg); color: var(--color-text); }
  .content-narrow { max-width: 720px; margin: 2rem auto; padding: 1rem; }
  .card { background: var(--color-surface); padding: 2rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  h1 { margin-top: 0; color: var(--color-text); }
  .muted { color: var(--color-text-muted); }
  dl.kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.5rem 1.25rem; }
  dl.kv dt { font-weight: 600; color: var(--color-text); }
  dl.kv dd { margin: 0; color: var(--color-text); }
  code { background: #ebeef2; padding: 2px 6px; border-radius: 3px; color: var(--color-text); }
  ul { margin: 0; padding-left: 1.25rem; }
  .btn { padding: 0.75rem 1.5rem; border-radius: 4px; border: 1px solid var(--color-border); cursor: pointer; font-weight: 600; margin-right: 0.5rem; font-size: 1rem; }
  .btn-primary { background: var(--color-primary); color: var(--color-primary-text); border-color: var(--color-primary); }
  .btn-secondary { background: var(--color-secondary-bg); color: var(--color-secondary-text); }
  .alert { padding: 1rem; border-radius: 4px; margin: 1rem 0; }
  .alert-danger { background: var(--color-danger-bg); color: var(--color-danger-text); border: 1px solid var(--color-danger-border); }
  .actions { margin-top: 1.5rem; }
  *:focus-visible { outline: 3px solid var(--color-primary); outline-offset: 2px; }
</style>
</head><body>${rendered}</body></html>`;

mkdirSync('/tmp/pa11y-consent', { recursive: true });
writeFileSync('/tmp/pa11y-consent/consent.html', html);
console.log(`wrote /tmp/pa11y-consent/consent.html (${html.length} bytes)`);

// Also render the adminScopeBlocked variant for pa11y coverage.
const blockedTemplate = template({
  csrfToken: 'test-csrf-token-xyz',
  adminScopeBlocked: true,
  client: { clientName: 'Claude Desktop (Test)' },
  user: { username: 'alice', role: 'viewer' },
});
const blockedHtml = html.replace(rendered, blockedTemplate);
writeFileSync('/tmp/pa11y-consent/consent-blocked.html', blockedHtml);
console.log(`wrote /tmp/pa11y-consent/consent-blocked.html (${blockedHtml.length} bytes)`);
