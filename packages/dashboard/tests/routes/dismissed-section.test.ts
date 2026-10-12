/**
 * Phase 89 Plan 05 — the Dismissed section on the report page (FP-15, D-07, UD-06/07/08/15/16).
 *
 * The REAL GET /reports/:id route supplies the view data (real SQLite store, real
 * dismissal repository); the REAL report-detail.hbs renders it with the real `t`, the real
 * `dismissalRefused` and ALL real partials. Only what server.ts merges at runtime (perm, locale)
 * is added to the context by hand.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  FABRIKAM_SITE,
  REASON_TOKEN,
  SEL_ALT,
  SEL_DISMISSED,
  seedSurfaceDismissal,
  seedSurfaceScan,
  surfaceReport,
} from '../helpers/dismissal-surface-fixture.js';
import { toSiteKey } from '../../src/services/issue-dismissals/site-key.js';

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


// ── Task 3: the complete section ─────────────────────────────────────────────────────────────
const CONTROLS = ['reports.view', 'issues.dismiss'] as const;
const MARKUP = '<img src=x onerror="window.__pwned=1">';

interface RawMark {
  readonly code?: string;
  readonly selector?: string;
  readonly reason?: string;
  readonly actor?: string;
}

/** Mark through the repository (the route-level refusals are covered by the API tests). */
async function markRaw(input: RawMark = {}) {
  const result = await ctx.storage.issueDismissals!.mark({
    orgId: ctx.orgs.fabrikamOrgId,
    siteUrl: FABRIKAM_SITE,
    siteKey: toSiteKey(FABRIKAM_SITE),
    code: input.code ?? CODE_CONTRAST,
    selector: input.selector ?? SEL_DISMISSED,
    reason: input.reason ?? REASON_TOKEN,
    actor: input.actor ?? 'fabrikam-admin',
  });
  if (result.kind !== 'created') throw new Error('markRaw: key already active');
  return result.dismissal;
}

async function revokeRaw(id: string, actor = 'northwind-owner', comment: string | null = 'Selector was too broad') {
  const result = await ctx.storage.issueDismissals!.revoke({
    id,
    orgId: ctx.orgs.fabrikamOrgId,
    actor,
    comment,
  });
  if (result.kind !== 'revoked') throw new Error('revokeRaw: not revoked');
  return result.dismissal;
}

const cellText = (td: Element) => (td.textContent ?? '').trim();
const tablesOf = (doc: Document) => [...doc.querySelectorAll('#rpt-dismissed table')];

describe('revoked rows', () => {
  it('revoked dismissals are listed muted with revoker, date and comment, without a revoke button', async () => {
    const live = await markRaw();
    const gone = await markRaw({ code: CODE_ALT, selector: SEL_ALT, reason: 'Hero image is decorative' });
    const revoked = await revokeRaw(gone.id);
    const { doc } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId, { permissions: CONTROLS }));

    const tables = tablesOf(doc);
    expect(tables).toHaveLength(2);

    // Active table: one row, with its Revoke button (positive control for the gate below).
    expect(tables[0]!.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(tables[0]!.querySelector(`[data-action="rptRevokeIssue"][data-id="${live.id}"]`)).not.toBeNull();

    // Revoked table: the row carries every field, every cell is muted, there is no action.
    const rows = [...tables[1]!.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(1);
    const cells = [...rows[0]!.querySelectorAll('td')];
    const text = cells.map(cellText);
    expect(text).toContain(CODE_ALT);
    expect(text).toContain(SEL_ALT);
    expect(text).toContain('Hero image is decorative');
    expect(text).toContain('fabrikam-admin');
    expect(text).toContain(new Date(gone.createdAt).toLocaleString());
    expect(text).toContain('northwind-owner');
    expect(text).toContain(new Date(revoked.revokedAt!).toLocaleString());
    expect(text).toContain('Selector was too broad');
    expect(cells).toHaveLength(8);
    for (const td of cells) expect(td.classList.contains('rpt-text--muted'), cellText(td)).toBe(true);
    expect(tables[1]!.querySelector('button')).toBeNull();
    expect(tables[1]!.querySelectorAll('thead th')).toHaveLength(8);
    expect(rows[0]!.querySelector('time')?.getAttribute('datetime')).toBe(gone.createdAt);
  });

  it('only revoked rows shows No active dismissals', async () => {
    const only = await markRaw();
    await revokeRaw(only.id);
    const { doc } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId, { permissions: CONTROLS }));

    const section = doc.getElementById('rpt-dismissed')!;
    expect(section.textContent).toContain('No active dismissals.');
    expect(tablesOf(doc)).toHaveLength(1); // the revoked table only
    expect(section.querySelector('[data-action="rptRevokeIssue"]')).toBeNull();
    expect(section.querySelector('summary')!.textContent).toContain('active: 0, revoked: 1');
  });
});

describe('technical gating of the element column', () => {
  it('the element column needs the technical permission and header and cell counts match', async () => {
    const live = await markRaw();
    await revokeRaw((await markRaw({ code: CODE_ALT, selector: SEL_ALT })).id);

    for (const technical of [true, false]) {
      const { doc } = await page(
        ctx.scanId,
        adminOf(ctx.orgs.fabrikamOrgId, { permissions: CONTROLS, technical }),
      );
      const section = doc.getElementById('rpt-dismissed')!;
      const tables = tablesOf(doc);
      expect(tables, `technical=${technical}`).toHaveLength(2);
      for (const table of tables) {
        const heads = table.querySelectorAll('thead th').length;
        for (const row of table.querySelectorAll('tbody tr')) {
          expect(row.querySelectorAll('td').length, `technical=${technical}`).toBe(heads);
        }
        const hasElementHead = [...table.querySelectorAll('thead th')].some((th) => cellText(th) === 'Element');
        expect(hasElementHead, `technical=${technical}`).toBe(technical);
      }
      // The selector appears in the section only for a technical viewer (the same rule the
      // page applies to every other selector on it), the rule code always does.
      expect(section.textContent!.includes(SEL_DISMISSED), `technical=${technical}`).toBe(technical);
      expect(section.textContent).toContain(CODE_CONTRAST);
      expect(section.textContent).toContain(live.reason);
    }
  });
});

describe('free text is data, never markup', () => {
  it('a reason containing markup is shown as text', async () => {
    const live = await markRaw({ reason: MARKUP, selector: `a[href="x"]<b>${SEL_DISMISSED}</b>`, actor: '<b>mallory</b>' });
    await revokeRaw(live.id, '<i>revoker</i>', MARKUP);
    await markRaw({ code: CODE_ALT, selector: SEL_ALT, reason: MARKUP });
    const { html, doc } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId, { permissions: CONTROLS }));

    const section = doc.getElementById('rpt-dismissed')!;
    // No element was created from any free-text field ...
    expect(section.querySelector('img')).toBeNull();
    expect(section.querySelector('b')).toBeNull();
    expect(section.querySelector('i')).toBeNull();
    // ... the characters are there as literal text ...
    const texts = [...section.querySelectorAll('td')].map(cellText);
    expect(texts).toContain(MARKUP);
    expect(texts).toContain('<b>mallory</b>');
    expect(texts).toContain('<i>revoker</i>');
    expect(texts.some((t) => t.includes('<b>' + SEL_DISMISSED + '</b>'))).toBe(true);
    // ... and the source carries them escaped, in attributes too (the selector is a title).
    expect(html).toContain('&lt;img src');
    expect(html).toContain('&lt;b&gt;mallory&lt;/b&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain(MARKUP);
    expect(html).not.toContain('<b>mallory</b>');
  });
});

// 89-11 item 2 (D-12; D-15 Q1 reverses the UI-SPEC UD-16 title clause): the stored actor
// `api-key:<row id>` is an identifier, not a name. The page names a key by its label, and only
// when the key row belongs to the SCAN's org; every other key actor reads as the generic label.
// Nothing in the section carries the stored identifier; the stored row itself is unchanged.
async function storeKeyIn(label: string, orgId?: string): Promise<string> {
  return ctx.storage.apiKeys.storeKey(`placeholder-${label.replace(/\W/g, '')}-${Math.random()}`, label, orgId);
}

function actorCells(doc: Document, locale: Locale = 'en'): Map<string, { by: string; byTitle: string | null; revokedBy?: string; revokedTitle?: string | null }> {
  const out = new Map<string, { by: string; byTitle: string | null; revokedBy?: string; revokedTitle?: string | null }>();
  for (const tr of doc.querySelectorAll('#rpt-dismissed tbody tr')) {
    const code = cellText(tr.querySelector('td')!);
    const by = tr.querySelector(`td[data-label="${t('issueDismissals.col.dismissedBy', locale)}"]`)!;
    const rev = tr.querySelector(`td[data-label="${t('issueDismissals.col.revokedBy', locale)}"]`);
    out.set(code, {
      by: cellText(by),
      byTitle: by.getAttribute('title'),
      ...(rev !== null ? { revokedBy: cellText(rev), revokedTitle: rev.getAttribute('title') } : {}),
    });
  }
  return out;
}

describe('actor label', () => {
  it("an API-key actor whose key belongs to the scan's org shows as API key: <label>", async () => {
    const keyId = await storeKeyIn('Fabrikam CI', ctx.orgs.fabrikamOrgId);
    await markRaw({ actor: `api-key:${keyId}` });
    const gone = await markRaw({ code: CODE_ALT, selector: SEL_ALT, actor: `api-key:${keyId}` });
    await revokeRaw(gone.id, `api-key:${keyId}`);
    const cells = actorCells((await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId))).doc);

    // Text only: that no attribute carries the stored identifier is its own test below.
    expect(cells.get(CODE_CONTRAST)!.by).toBe('API key: Fabrikam CI');
    expect(cells.get(CODE_ALT)!.by).toBe('API key: Fabrikam CI');
    expect(cells.get(CODE_ALT)!.revokedBy).toBe('API key: Fabrikam CI');
  });

  it("the named label is translated: the German prefix of a key that belongs to the scan's org", async () => {
    const keyId = await storeKeyIn('Fabrikam CI', ctx.orgs.fabrikamOrgId);
    await markRaw({ actor: `api-key:${keyId}` });
    const { doc } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId, { locale: 'de' }));
    const text = actorCells(doc, 'de').get(CODE_CONTRAST)!.by;
    expect(text).toBe(`${t('issueDismissals.actor.apiKey', 'de')}: Fabrikam CI`);
    expect(text).not.toContain('API key');
    expect(text).not.toContain('issueDismissals');
  });

  it('a system key, another org key, a deleted key, api-key:session and the legacy bare api-key show the generic API key label', async () => {
    const systemKey = await storeKeyIn('Northwind Ops'); // org 'system'
    const otherOrgKey = await storeKeyIn('Northwind CI', ctx.orgs.northwindOrgId);
    const fabrikamKey = await storeKeyIn('Fabrikam CI', ctx.orgs.fabrikamOrgId); // makes the map non-empty
    const actors: ReadonlyArray<readonly [string, string]> = [
      ['WCAG2A.Sys.H1', `api-key:${systemKey}`],
      ['WCAG2A.Other.H2', `api-key:${otherOrgKey}`],
      ['WCAG2A.Deleted.H3', 'api-key:0123456789abcdef0123456789abcdef'],
      ['WCAG2A.Session.H4', 'api-key:session'],
      ['WCAG2A.Bare.H5', 'api-key'],
      ['WCAG2A.Own.H6', `api-key:${fabrikamKey}`],
      ['WCAG2A.User.H7', 'api-keyboard'], // a user whose name merely starts with the same letters
    ];
    for (const [code, actor] of actors) await markRaw({ code, selector: `#${code.split('.')[1]}`, actor });
    const cells = actorCells((await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId))).doc);

    expect(cells.size).toBe(actors.length); // positive control: every row rendered
    for (const code of ['WCAG2A.Sys.H1', 'WCAG2A.Other.H2', 'WCAG2A.Deleted.H3', 'WCAG2A.Session.H4', 'WCAG2A.Bare.H5']) {
      expect(cells.get(code)!.by, code).toBe('API key');
    }
    // A user whose name merely starts with the same letters is shown as stored. (That the org's own
    // key IS named is the test above; this one holds while the label map is empty too.)
    expect(cells.get('WCAG2A.User.H7')).toEqual({ by: 'api-keyboard', byTitle: 'api-keyboard' });
  });

  it('no attribute or text of the Dismissed section contains the stored api-key identifier or the key id', async () => {
    const own = await storeKeyIn('Fabrikam CI', ctx.orgs.fabrikamOrgId);
    const sys = await storeKeyIn('Northwind Ops');
    await markRaw({ actor: `api-key:${own}` });
    const gone = await markRaw({ code: CODE_ALT, selector: SEL_ALT, actor: `api-key:${sys}` });
    await revokeRaw(gone.id, `api-key:${own}`);
    await markRaw({ code: 'WCAG2A.Session.H4', selector: '#session', actor: 'api-key:session' });
    const { doc } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId));
    const section = doc.getElementById('rpt-dismissed')!.outerHTML;

    expect(doc.querySelectorAll('#rpt-dismissed tbody tr')).toHaveLength(3); // positive control: the rows rendered
    expect(section).not.toContain('api-key:');
    expect(section).not.toContain(own);
    expect(section).not.toContain(sys);
  });

  it('the stored attribution is unchanged', async () => {
    const own = await storeKeyIn('Fabrikam CI', ctx.orgs.fabrikamOrgId);
    const gone = await markRaw({ actor: `api-key:${own}` });
    await revokeRaw(gone.id, `api-key:${own}`);
    await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId));
    const rows = await ctx.storage.issueDismissals!.listForSite(ctx.orgs.fabrikamOrgId, toSiteKey(FABRIKAM_SITE));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdBy).toBe(`api-key:${own}`);
    expect(rows[0]!.revokedBy).toBe(`api-key:${own}`);
  });

  it('a key label containing markup is shown as text', async () => {
    const keyId = await storeKeyIn('<b>ops</b><img src=x>', ctx.orgs.fabrikamOrgId);
    await markRaw({ actor: `api-key:${keyId}` });
    const { doc, html } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId));
    expect(actorCells(doc).get(CODE_CONTRAST)!.by).toBe('API key: <b>ops</b><img src=x>');
    expect(html).toContain('&lt;b&gt;ops&lt;/b&gt;');
    expect(html).not.toContain('<b>ops</b>');
    expect(html).not.toContain('<img src=x>');
  });

  it('a user actor keeps its name and its title', async () => {
    await markRaw({ actor: 'fabrikam-admin' });
    const gone = await markRaw({ code: CODE_ALT, selector: SEL_ALT, actor: 'fabrikam-admin' });
    await revokeRaw(gone.id, 'northwind-owner');
    const cells = actorCells((await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId))).doc);
    expect(cells.get(CODE_CONTRAST)).toEqual({ by: 'fabrikam-admin', byTitle: 'fabrikam-admin' });
    expect(cells.get(CODE_ALT)).toEqual({
      by: 'fabrikam-admin', byTitle: 'fabrikam-admin', revokedBy: 'northwind-owner', revokedTitle: 'northwind-owner',
    });
  });

  it('the key lookup reads only the scan org, once, and only when a row carries an API-key actor', async () => {
    const spy = vi.spyOn(ctx.storage.apiKeys, 'listKeys');
    await markRaw({ actor: 'fabrikam-admin' });
    await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId));
    expect(spy).not.toHaveBeenCalled();

    await markRaw({ code: CODE_ALT, selector: SEL_ALT, actor: 'api-key:session' });
    await markRaw({ code: 'WCAG2A.Bare.H5', selector: '#bare', actor: 'api-key' });
    await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(ctx.orgs.fabrikamOrgId);
    spy.mockRestore();
  });

  it('a failing key lookup still renders the section with generic labels', async () => {
    const keyId = await storeKeyIn('Fabrikam CI', ctx.orgs.fabrikamOrgId);
    const spy = vi.spyOn(ctx.storage.apiKeys, 'listKeys').mockRejectedValue(new Error('driver said SELECT secret'));
    await markRaw({ actor: `api-key:${keyId}` });
    const { doc } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId));
    expect(spy).toHaveBeenCalledTimes(1); // positive control: the failure path ran
    expect(doc.getElementById('rpt-dismissed')).not.toBeNull();
    expect(actorCells(doc).get(CODE_CONTRAST)!.by).toBe('API key');
    spy.mockRestore();
  });
});

describe('every finding dismissed', () => {
  async function allDismissedScan(): Promise<string> {
    const base = surfaceReport(FABRIKAM_SITE);
    const report = {
      ...base,
      summary: { pagesScanned: 1, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 }, pagesFailed: 0 },
      pages: [
        {
          url: FABRIKAM_SITE,
          issueCount: 1,
          issues: [
            { type: 'error', code: CODE_ALT, message: 'Image is missing a text alternative', selector: SEL_ALT, context: '<img id="x">' },
          ],
        },
      ],
      compliance: undefined,
      complianceMatrix: [],
      regulationMatrix: [],
    };
    return seedSurfaceScan(ctx.storage, {
      orgId: ctx.orgs.fabrikamOrgId,
      location: 'db',
      id: 'scan-fabrikam-alldismissed-1',
      report,
    });
  }

  it('every finding dismissed shows the all-dismissed notice and still lists the dismissals', async () => {
    const scanId = await allDismissedScan();
    await markRaw({ code: CODE_ALT, selector: SEL_ALT });
    const { doc, data } = await page(scanId, adminOf(ctx.orgs.fabrikamOrgId));

    expect((data['reportData'] as { allIssueGroups: unknown[] }).allIssueGroups).toHaveLength(0);
    const panel = doc.getElementById('panel-issues')!;
    const alert = panel.querySelector('.alert.alert--info[role="status"]')!;
    expect(cellText(alert)).toBe(
      'Every finding in this report has been dismissed as a false positive. See Dismissed findings below.',
    );
    expect(panel.textContent).not.toContain('No issues found in this report');
    expect(doc.getElementById('rpt-dismissed')).not.toBeNull();
    expect(panel.lastElementChild!.id).toBe('rpt-dismissed');
  });

  it('foreign dismissals alone add neither the all-dismissed notice nor the section', async () => {
    const scanId = await allDismissedScan();
    // The context seeds dismissals for another org and another site only: they never apply here.
    const { doc, data } = await page(scanId, adminOf(ctx.orgs.fabrikamOrgId));
    expect((data['reportData'] as { allIssueGroups: unknown[] }).allIssueGroups.length).toBeGreaterThan(0);
    expect(doc.getElementById('rpt-dismissed')).toBeNull();
    expect(doc.getElementById('panel-issues')!.textContent).not.toContain('Every finding in this report');
  });

  it('only revoked dismissals and no findings left shows the plain no-issues text', async () => {
    const scanId = await seedSurfaceScan(ctx.storage, {
      orgId: ctx.orgs.fabrikamOrgId,
      location: 'db',
      id: 'scan-fabrikam-empty-1',
      report: {
        ...surfaceReport(FABRIKAM_SITE),
        summary: { pagesScanned: 1, totalIssues: 0, byLevel: { error: 0, warning: 0, notice: 0 }, pagesFailed: 0 },
        pages: [{ url: FABRIKAM_SITE, issueCount: 0, issues: [] }],
        compliance: undefined,
        complianceMatrix: [],
        regulationMatrix: [],
      },
    });
    const gone = await markRaw();
    await revokeRaw(gone.id);
    const { doc } = await page(scanId, adminOf(ctx.orgs.fabrikamOrgId));
    const panel = doc.getElementById('panel-issues')!;
    expect(panel.textContent).toContain('No issues found in this report');
    expect(panel.textContent).not.toContain('Every finding in this report');
    expect(doc.getElementById('rpt-dismissed')).not.toBeNull(); // the history is still listed
  });
});

describe('who sees the Revoke control', () => {
  it('a viewer without issues.dismiss sees the section but no revoke button', async () => {
    await markRaw();
    const { doc, data } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId, { permissions: VIEW }));
    expect('dismissalControls' in data).toBe(false);
    expect(doc.getElementById('rpt-dismissed')).not.toBeNull();
    expect(doc.querySelector('[data-action="rptRevokeIssue"]')).toBeNull();
    expect(doc.getElementById('issue-revoke-dialog')).toBeNull();
    expect(doc.querySelector('#rpt-dismissed th .sr-only')).toBeNull(); // no actions column either
  });

  it('a permitted viewer gets one Revoke button per active row and the revoke dialog', async () => {
    const a = await markRaw();
    const b = await markRaw({ code: CODE_ALT, selector: SEL_ALT });
    const { doc } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId, { permissions: CONTROLS }));
    const buttons = [...doc.querySelectorAll('#rpt-dismissed [data-action="rptRevokeIssue"]')];
    expect(buttons.map((x) => x.getAttribute('data-id')).sort()).toEqual([a.id, b.id].sort());
    expect(doc.getElementById('issue-revoke-dialog')).not.toBeNull();
    const head = tablesOf(doc)[0]!.querySelectorAll('thead th');
    expect(head).toHaveLength(6); // five columns plus the actions column
  });

  it('a permitted org user on a system scan sees neither the section nor a control', async () => {
    const systemScan = await seedSurfaceScan(ctx.storage, {
      orgId: 'system',
      location: 'db',
      id: 'scan-system-0002',
    });
    await seedSurfaceDismissal(ctx.storage, { orgId: 'system', match: DISMISS_PARTIAL });
    const { doc } = await page(systemScan, {
      role: 'user',
      currentOrgId: ctx.orgs.fabrikamOrgId,
      permissions: CONTROLS,
    });
    expect(doc.getElementById('rpt-dismissed')).toBeNull();
    expect(doc.querySelector('[data-action="rptRevokeIssue"]')).toBeNull();
    expect(doc.getElementById('issue-revoke-dialog')).toBeNull();
  });
});

describe('rendered sample (read by eye once; printed for the SUMMARY)', () => {
  it('prints the Dismissed section as a person sees it', async () => {
    const live = await markRaw({ reason: 'The alternative text is supplied by a script after load.' });
    const gone = await markRaw({ code: CODE_ALT, selector: SEL_ALT, reason: 'Decorative image', actor: 'api-key:key-7f3a' });
    await revokeRaw(gone.id, 'fabrikam-owner', 'Selector was too broad.');
    const { doc } = await page(ctx.scanId, adminOf(ctx.orgs.fabrikamOrgId, { permissions: CONTROLS }));
    const section = doc.getElementById('rpt-dismissed')!;
    const lines: string[] = [cellText(section.querySelector('summary')!), cellText(section.querySelector('p')!)];
    for (const table of section.querySelectorAll('table')) {
      const heads = [...table.querySelectorAll('thead th')].map((th) => cellText(th) || '(actions)');
      lines.push(`[${heads.join(' | ')}]`);
      for (const row of table.querySelectorAll('tbody tr')) {
        lines.push([...row.querySelectorAll('td')].map((td) => cellText(td)).join(' | '));
      }
    }
    // eslint-disable-next-line no-console
    console.info(`DISMISSED_SECTION_VISIBLE_TEXT:\n${lines.join('\n')}`);
    expect(live.id).toBeTruthy();
    expect(lines.join('\n')).toContain('Dismissed findings');
  });
});


describe('section styles (UI-SPEC "Proposed CSS additions", four rules)', () => {
  const CSS = readFileSync(join(HERE, '..', '..', 'src', 'static', 'style.css'), 'utf8');
  /** Every rule block whose selector list contains `selector` (including nested media blocks). */
  const blocksFor = (selector: string): string[] => {
    const out: string[] = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    for (const m of CSS.matchAll(re)) {
      const selectors = m[1]!.split(',').map((x) => x.trim().replace(/^[\s\S]*\n/, ''));
      if (selectors.includes(selector)) out.push(m[2]!);
    }
    return out;
  };

  it('the wrapper, summary, heading and intro rules exist and use design tokens only', () => {
    for (const selector of ['.rpt-dismissed', '.rpt-dismissed__summary', '.rpt-dismissed__heading', '.rpt-dismissed__intro']) {
      const blocks = blocksFor(selector);
      expect(blocks.length, selector).toBeGreaterThan(0);
      for (const body of blocks) {
        expect(body, selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(body, selector).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/);
      }
    }
  });

  it('the summary marker rotates when open, respects reduced motion and has a visible focus outline', () => {
    expect(blocksFor('.rpt-dismissed__summary::before').join('')).toContain('transition');
    // A transform only applies to a box that is not plain inline: without this the marker never turned
    // (found in the browser: an open section still showed the right-pointing marker).
    expect(blocksFor('.rpt-dismissed__summary::before').join('')).toMatch(/display:\s*inline-block/);
    expect(blocksFor('details[open] > .rpt-dismissed__summary::before').join('')).toContain('rotate(90deg)');
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.rpt-dismissed__summary::before[^}]*transition:\s*none/);
    expect(blocksFor('.rpt-dismissed__summary:focus-visible').join('')).toContain('var(--focus-outline)');
    expect(blocksFor('.rpt-dismissed__summary::-webkit-details-marker').join('')).toContain('display: none');
  });

  it('revoked cells really render muted: a rule that outranks `.data-table td` carries the muted token', () => {
    // `.data-table td` (one class, one element) sets color: var(--text-primary); the bare
    // `.rpt-text--muted` utility (one class) loses to it, so the revoked rows were muted in markup only
    // (found by the dark-theme UAT: computed colours were identical for active and revoked cells).
    const body = blocksFor('.rpt-dismissed td.rpt-text--muted').join('');
    expect(body).toContain('color: var(--text-muted)');
    const selector = '.rpt-dismissed td.rpt-text--muted';
    const classes = (selector.match(/\./g) ?? []).length;
    const elements = (selector.match(/(^|\s)[a-z]+/g) ?? []).length;
    expect(classes * 10 + elements, 'specificity must exceed .data-table td (1 class, 1 element)').toBeGreaterThan(1 * 10 + 1);
  });

  it('the stylesheet version served by the layout was bumped for the new rules', () => {
    const layout = readFileSync(join(VIEWS_DIR, 'layouts', 'main.hbs'), 'utf8');
    expect(layout).not.toContain('/static/style.css?v=3.4.1');
    expect(layout).not.toContain('/static/style.css?v=3.4.2');
    expect(layout).toMatch(/\/static\/style\.css\?v=3\.4\.\d+/);
  });
});
