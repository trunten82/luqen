import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';

// Register the helpers the sidebar uses. These mirror the production
// registrations in src/server.ts — if a helper is missing the template
// render will throw, catching any future refactor that introduces a new
// helper without updating tests.
const hbs = Handlebars.create();
hbs.registerHelper('eq', function (a: unknown, b: unknown) { return a === b; });
hbs.registerHelper('startsWith', function (path: unknown, prefix: unknown) {
  return typeof path === 'string' && typeof prefix === 'string' && path.startsWith(prefix);
});
hbs.registerHelper('lookup', function (obj: Record<string, unknown>, key: string) {
  return obj?.[key];
});
// `or` helper used by the sidebar audit-log entry (Phase 33.1) — mirrors the
// production registration in server.ts. Accepts any number of args plus the
// trailing Handlebars options object; returns the first truthy value.
hbs.registerHelper('or', function (...args: unknown[]) {
  // Drop the trailing Handlebars options object.
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i]) return args[i];
  }
  return false;
});
// Simple {{t "key"}} stub — returns the key itself so assertions can match.
hbs.registerHelper('t', function (key: string) { return key; });

// READ-ONLY: sidebar.hbs is consumed as test fixture input. This plan does
// NOT edit sidebar.hbs; the file is NOT in files_modified.
const TEMPLATE_PATH = join(
  __dirname,
  '..',
  '..',
  'src',
  'views',
  'partials',
  'sidebar.hbs',
);

function renderSidebar(context: Record<string, unknown>): string {
  const src = readFileSync(TEMPLATE_PATH, 'utf-8');
  const template = hbs.compile(src);
  return template(context);
}

const BASE_CONTEXT = {
  currentPath: '/home',
  user: { username: 'alice' },
  csrfToken: 'test-csrf',
  locale: 'en',
  locales: ['en'],
  localeLabels: { en: 'English' },
  orgContext: { userOrgs: [] },
  pluginAdminPages: [],
  hasGitHostConfigs: false,
};

describe('sidebar branding parity — BUI-04', () => {
  it('renders branding + compliance + llm entries when all view permissions are granted', () => {
    const html = renderSidebar({
      ...BASE_CONTEXT,
      perm: {
        brandingView: true,
        complianceView: true,
        llmView: true,
        adminSystem: true,
        scansCreate: true,
        scansSchedule: true,
        usersManageAny: false,
        adminTeams: false,
        adminRoles: false,
        adminOrg: false,
        reposManage: false,
        reposCredentials: false,
        complianceManage: false,
        auditView: false,
        adminPlugins: false,
      },
    });

    // Branding section anchors — BUI-04 parity with the other services.
    expect(html).toContain('href="/admin/branding-guidelines"');
    expect(html).toContain('href="/admin/system-brand-guidelines"');

    // Compliance section anchors — proves the test harness correctly renders
    // sibling sections so the branding assertion is meaningful.
    expect(html).toContain('href="/admin/jurisdictions"');
    expect(html).toContain('href="/admin/regulations"');

    // LLM section anchor.
    expect(html).toContain('href="/admin/llm"');
  });

  it('hides branding entries when perm.brandingView is false — permission gate regression', () => {
    const html = renderSidebar({
      ...BASE_CONTEXT,
      perm: {
        brandingView: false,
        complianceView: true,
        llmView: true,
        adminSystem: false,
        scansCreate: false,
        scansSchedule: false,
        usersManageAny: false,
        adminTeams: false,
        adminRoles: false,
        adminOrg: false,
        reposManage: false,
        reposCredentials: false,
        complianceManage: false,
        auditView: false,
        adminPlugins: false,
      },
    });

    expect(html).not.toContain('href="/admin/branding-guidelines"');
    expect(html).not.toContain('href="/admin/system-brand-guidelines"');

    // Compliance is still visible — proves the hide is scoped, not total.
    expect(html).toContain('href="/admin/jurisdictions"');
  });
});
