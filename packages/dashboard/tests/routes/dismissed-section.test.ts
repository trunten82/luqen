/**
 * Phase 89 Plan 05 — the Dismissed section on the report page (FP-15, D-07, UD-06/07/08/15/16).
 *
 * The REAL GET /reports/:id route supplies the view data (real SQLite store, real
 * dismissal repository); the REAL report-detail.hbs renders it with the real `t`, the real
 * `dismissalRefused` and ALL real partials. Only what server.ts merges at runtime (perm, locale)
 * is added to the context by hand.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import Handlebars from 'handlebars';
import { collectPartials, dismissalRefused } from '../../src/server.js';
import { loadTranslations, t, type Locale } from '../../src/i18n/index.js';
import { reportRoutes } from '../../src/routes/reports.js';
import {
  createSurfaceContext,
  makeServer,
  registerViewHelpers,
  type SurfaceContext,
} from '../golden/drivers/render-drivers.js';
import {
  CODE_ALT,
  CODE_CONTRAST,
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  REASON_TOKEN,
  SEL_DISMISSED,
  seedSurfaceDismissal,
  seedSurfaceScan,
} from '../helpers/dismissal-surface-fixture.js';

process.env['TZ'] ??= 'UTC';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(HERE, '..', '..', 'src', 'views');

let hb: typeof Handlebars;
let reportSource: string;
let ctx: SurfaceContext;

beforeAll(() => {
  loadTranslations();
  hb = Handlebars.create();
  hb.registerHelper('helperMissing', () => '');
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hb.registerHelper('issueAssignStatus', () => '');
  hb.registerHelper('fixSuggestion', () => '');
  hb.registerHelper('dismissalRefused', dismissalRefused);
  hb.registerHelper(
    't',
    function (key: string, options: { hash?: Record<string, unknown>; data?: { root?: { locale?: string } } }) {
      const locale = (options?.data?.root?.locale as Locale) ?? 'en';
      const params =
        options?.hash != null
          ? Object.fromEntries(Object.entries(options.hash).map(([k, v]) => [k, String(v ?? '')]))
          : undefined;
      return t(key, locale, params);
    },
  );
  for (const [name, rel] of Object.entries(collectPartials(VIEWS_DIR))) {
    hb.registerPartial(name, readFileSync(join(VIEWS_DIR, rel), 'utf8'));
  }
  reportSource = readFileSync(join(VIEWS_DIR, 'report-detail.hbs'), 'utf8');
});

beforeEach(async () => {
  registerViewHelpers();
  ctx = await createSurfaceContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

interface Viewer {
  readonly role: 'admin' | 'user';
  readonly currentOrgId: string;
  readonly permissions: readonly string[];
  readonly technical?: boolean;
  readonly locale?: string;
}

const VIEW = ['reports.view'] as const;

/** The real route's view data plus the HTML the real template renders from it. */
async function page(
  scanId: string,
  viewer: Viewer,
): Promise<{ data: Record<string, unknown>; html: string; doc: Document }> {
  const server = await makeServer(ctx, async (s) => {
    s.addHook('preHandler', async (request) => {
      request.user = {
        id: 'u-viewer',
        username: 'viewer',
        role: viewer.role,
        currentOrgId: viewer.currentOrgId,
      } as never;
      (request as unknown as { permissions: Set<string> }).permissions = new Set(viewer.permissions);
    });
    await reportRoutes(s, ctx.storage, () => null);
  });
  try {
    const res = await server.inject({ method: 'GET', url: `/reports/${scanId}` });
    expect(res.statusCode).toBe(200);
    const data = (JSON.parse(res.body) as { data: Record<string, unknown> }).data;
    const html = hb.compile(reportSource)({
      ...data,
      locale: viewer.locale ?? 'en',
      perm: { reportsViewTechnical: viewer.technical ?? true },
      assignedMap: {},
    });
    return { data, html, doc: new JSDOM(html).window.document };
  } finally {
    await server.close();
  }
}

const adminOf = (orgId: string, extra: Partial<Viewer> = {}): Viewer => ({
  role: 'admin',
  currentOrgId: orgId,
  permissions: VIEW,
  ...extra,
});

function dismiss(match: { code: string; selector: string }) {
  return seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match });
}

describe('the Dismissed section — tracer', () => {
  it('the report page lists an active dismissal with its rule, reason, actor and date', async () => {
    const row = await dismiss(DISMISS_PARTIAL);
    const { doc } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId));

    const section = doc.querySelector('details#rpt-dismissed');
    expect(section).not.toBeNull();
    // Positive control for the foreign seeds: Northwind (same URL) and Fabrikam (other site)
    // each dismiss CODE_ALT and CODE_CONTRAST too; none of them may appear, so exactly one row.
    const rows = [...section!.querySelectorAll('table tbody tr')];
    expect(rows).toHaveLength(1);
    const cells = [...rows[0]!.querySelectorAll('td')].map((c) => (c.textContent ?? '').trim());
    expect(cells).toContain(CODE_CONTRAST);
    expect(cells).toContain(SEL_DISMISSED);
    expect(cells).toContain(REASON_TOKEN);
    expect(cells).toContain('fabrikam-admin');
    expect(cells).toContain(new Date(row.createdAt).toLocaleString());
    expect(section!.textContent).not.toContain(CODE_ALT);
  });

  it('the Dismissed section is collapsed and is the last element of the Issues panel', async () => {
    await dismiss(DISMISS_PARTIAL);
    await dismiss(DISMISS_WHOLE);
    const { doc } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId));

    const panel = doc.getElementById('panel-issues');
    expect(panel).not.toBeNull();
    const last = panel!.lastElementChild as HTMLElement;
    expect(last.tagName).toBe('DETAILS');
    expect(last.id).toBe('rpt-dismissed');
    expect(last.classList.contains('rpt-dismissed')).toBe(true);
    expect(last.hasAttribute('open')).toBe(false);
    // And it comes after the issue list, not inside it.
    expect(panel!.querySelector('#rpt-issue-list')?.contains(last)).toBe(false);
  });

  it('without any dismissal the view data has no dismissals key', async () => {
    // The context seeds foreign dismissals only (other org, other site): they must not leak in.
    const { data, html } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId));
    expect('dismissals' in data).toBe(false);
    expect(html).not.toContain('rpt-dismissed');
  });

  it('an org user viewing a system scan sees no Dismissed section', async () => {
    const systemScan = await seedSurfaceScan(ctx.storage, {
      orgId: 'system',
      location: 'db',
      id: 'scan-system-0001',
    });
    await seedSurfaceDismissal(ctx.storage, { orgId: 'system', match: DISMISS_PARTIAL });

    // Positive control: the page itself is open to this org user (the shared guard lets
    // 'system' scans through), and a global admin DOES get the section for the same scan.
    const orgUser = await page(systemScan, {
      role: 'user',
      currentOrgId: ctx.orgs.fabrikamOrgId,
      permissions: VIEW,
    });
    expect(orgUser.data['reportData']).toBeTruthy();
    expect('dismissals' in orgUser.data).toBe(false);
    expect(orgUser.html).not.toContain('rpt-dismissed');
    expect(orgUser.html).not.toContain(REASON_TOKEN);

    const admin = await page(systemScan, adminOf(ctx.orgs.fabrikamOrgId));
    expect(admin.doc.querySelector('details#rpt-dismissed')).not.toBeNull();
  });

  it('an org user reads the section of their own org scan without issues.dismiss', async () => {
    await dismiss(DISMISS_PARTIAL);
    const { doc, data } = await page(ctx.scanId, {
      role: 'user',
      currentOrgId: ctx.orgs.fabrikamOrgId,
      permissions: VIEW,
    });
    expect(doc.querySelector('details#rpt-dismissed')).not.toBeNull();
    expect('dismissalControls' in data).toBe(false);
  });

  it('the section reads the scan org, not the requester org', async () => {
    await dismiss(DISMISS_PARTIAL);
    // A global admin sitting in the Northwind org still sees Fabrikam's rows for a Fabrikam scan,
    // and Northwind's seeded dismissals (same URL) are not mixed in.
    const { doc } = await page(ctx.scanId, adminOf(ctx.orgs.northwindOrgId));
    const rows = doc.querySelectorAll('details#rpt-dismissed table tbody tr');
    expect(rows).toHaveLength(1);
  });
});
