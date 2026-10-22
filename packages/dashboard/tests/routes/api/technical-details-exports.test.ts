/**
 * D-08 (Phase 93): the issues Excel export and the dismissals list follow the report page. A caller
 * without reports.view_technical gets the issues workbook without its Selector and Context columns,
 * the Dismissed sheet without its Selector column, and dismissal rows without a selector key.
 *
 * Plain Fastify over a real SqliteStorageAdapter with the production routes. A preHandler chooses
 * the identity per request from a header: the Owner holds every permission, the Analyst holds the
 * permissions to export, view and dismiss but not reports.view_technical, so that permission is the
 * only variable. Canaries sit in the selector, the markup and the message; the message canary is the
 * control that shows the matcher can match.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { SqliteStorageAdapter } from '../../../src/db/sqlite/index.js';
import { loadTranslations } from '../../../src/i18n/index.js';
import { exportRoutes } from '../../../src/routes/api/export.js';
import { issueDismissalRoutes } from '../../../src/routes/api/issue-dismissals.js';
import { toSiteKey } from '../../../src/services/issue-dismissals/site-key.js';
import { DismissalSchema, ListResponse } from '../../../src/routes/api/issue-dismissals-schemas.js';
import { ALL_PERMISSION_IDS } from '../../../src/permissions.js';
import { seedSurfaceDismissal, seedSurfaceScan } from '../../helpers/dismissal-surface-fixture.js';

const CODE = 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail';
const HEX = randomUUID().replace(/-/g, '').slice(0, 16);
const SELECTOR = `#selcanary${HEX}`;
const SELECTOR_ID = `selcanary${HEX}`;
const CONTEXT_ID = `ctxcanary${HEX}`;
const MESSAGE = `msgcanary${HEX}`;
const DISMISSED_SELECTOR = `#dismissedcanary${HEX}`;
const DISMISSED_ID = `dismissedcanary${HEX}`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const OWNER_PERMISSIONS: readonly string[] = ALL_PERMISSION_IDS;
const ANALYST_PERMISSIONS: readonly string[] = ['reports.view', 'reports.export', 'issues.dismiss'];

function report(siteUrl: string, withDismissable: boolean): Record<string, unknown> {
  const issues: Array<Record<string, unknown>> = [
    { type: 'error', code: CODE, message: MESSAGE, selector: SELECTOR, context: `<p id="${CONTEXT_ID}">x</p>` },
  ];
  if (withDismissable) {
    issues.push({ type: 'warning', code: CODE, message: 'a finding that gets dismissed', selector: DISMISSED_SELECTOR, context: '<p>d</p>' });
  }
  return {
    summary: { pagesScanned: 1, totalIssues: issues.length, byLevel: { error: 1, warning: issues.length - 1, notice: 0 } },
    pages: [{ url: siteUrl, issueCount: issues.length, issues }],
  };
}

let dbPath: string;
let storage: SqliteStorageAdapter;
let server: FastifyInstance;
let orgId: string;
let plainScanId: string;
let dismissedScanId: string;

beforeAll(async () => {
  loadTranslations();
  dbPath = join(tmpdir(), `test-technical-details-exports-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  orgId = (await storage.organizations.createOrg({ name: 'Fabrikam', slug: `fabrikam-${HEX.slice(0, 8)}` })).id;

  server = Fastify({ logger: false });
  server.addHook('preHandler', async (request) => {
    const who = request.headers['x-who'];
    request.user = { id: `u-${String(who)}`, username: String(who), role: 'user', currentOrgId: orgId } as never;
    (request as unknown as { permissions: Set<string> }).permissions = new Set(
      who === 'owner' ? OWNER_PERMISSIONS : ANALYST_PERMISSIONS,
    );
  });
  await exportRoutes(server, storage);
  await issueDismissalRoutes(server, storage);
  await server.ready();

  const plainSite = `https://fabrikam.example/${HEX.slice(0, 8)}/plain/`;
  plainScanId = await seedSurfaceScan(storage, { orgId, siteUrl: plainSite, report: report(plainSite, false), location: 'db' });
  const dismissedSite = `https://fabrikam.example/${HEX.slice(0, 8)}/dismissed/`;
  dismissedScanId = await seedSurfaceScan(storage, { orgId, siteUrl: dismissedSite, report: report(dismissedSite, true), location: 'db' });
  await seedSurfaceDismissal(storage, { orgId, siteUrl: dismissedSite, match: { code: CODE, selector: DISMISSED_SELECTOR } });
}, 60_000);

afterAll(async () => {
  if (server !== undefined) await server.close();
  if (storage !== undefined) await storage.disconnect();
  if (dbPath !== undefined && existsSync(dbPath)) rmSync(dbPath);
});

interface Sheet { readonly name: string; readonly headers: string[]; readonly rows: string[][]; readonly cells: string[] }

async function workbook(who: string, scanId: string): Promise<Sheet[]> {
  const res = await server.inject({
    method: 'GET', url: `/api/v1/export/scans/${scanId}/issues.xlsx`, headers: { 'x-who': who },
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain(XLSX);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.rawPayload);
  return wb.worksheets.map((ws) => {
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell) => headers.push(String(cell.value ?? '')));
    const rows: string[][] = [];
    const cells: string[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const values = headers.map((_, i) => String(row.getCell(i + 1).value ?? ''));
      cells.push(...values);
      if (n > 1) rows.push(values);
    });
    return { name: ws.name, headers, rows, cells };
  });
}

describe('issues.xlsx columns', () => {
  it('D-08 an Analyst issues sheet has twelve columns without Selector and Context and no canary cell', async () => {
    const [issues] = await workbook('analyst', plainScanId);
    expect(issues!.name).toBe('Issues');
    expect(issues!.headers).not.toContain('Selector');
    expect(issues!.headers).not.toContain('Context');
    expect(issues!.headers).toHaveLength(12);
    expect(issues!.rows.length).toBeGreaterThan(0);
    const all = issues!.cells.join('\n');
    expect(all).not.toContain(SELECTOR_ID);
    expect(all).not.toContain(CONTEXT_ID);
    expect(all).toContain(MESSAGE);
  }, 60_000);

  it('D-08 an Owner issues sheet has Selector and Context in their current positions with the canaries', async () => {
    const [issues] = await workbook('owner', plainScanId);
    expect(issues!.headers).toHaveLength(14);
    const selectorAt = issues!.headers.indexOf('Selector');
    const contextAt = issues!.headers.indexOf('Context');
    expect(selectorAt).toBe(6);
    expect(contextAt).toBe(7);
    expect(issues!.rows[0]![selectorAt]).toBe(SELECTOR);
    expect(issues!.rows[0]![contextAt]).toContain(CONTEXT_ID);
    expect(issues!.cells.join('\n')).toContain(MESSAGE);
  }, 60_000);

  it('D-08 severity and priority colouring stays on the first two columns for both callers', async () => {
    for (const who of ['analyst', 'owner']) {
      const res = await server.inject({
        method: 'GET', url: `/api/v1/export/scans/${plainScanId}/issues.xlsx`, headers: { 'x-who': who },
      });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.rawPayload);
      const row = wb.worksheets[0]!.getRow(2);
      expect(String(row.getCell(1).value), `${who} severity cell`).toBe('error');
      expect(row.getCell(1).font?.bold, `${who} severity bold`).toBe(true);
      expect(row.getCell(1).font?.color?.argb, `${who} severity colour`).toBe('FF8B1A1A');
      expect(String(row.getCell(2).value), `${who} priority cell`).toMatch(/^(Critical|High|Medium|Low)$/);
    }
  }, 60_000);
});

describe('issues.xlsx Dismissed sheet', () => {
  it('D-08 with an active dismissal the Analyst Dismissed sheet has no Selector column and no canary', async () => {
    const sheets = await workbook('analyst', dismissedScanId);
    expect(sheets.map((s) => s.name)).toHaveLength(2);
    const dismissed = sheets[1]!;
    expect(dismissed.headers).not.toContain('Selector');
    expect(dismissed.headers).toHaveLength(6);
    expect(dismissed.rows.length).toBe(1);
    expect(dismissed.rows[0]).toContain(CODE);
    expect(sheets.flatMap((s) => s.cells).join('\n')).not.toContain(DISMISSED_ID);
  }, 60_000);

  it('D-08 with an active dismissal the Owner Dismissed sheet has the Selector column', async () => {
    const sheets = await workbook('owner', dismissedScanId);
    const dismissed = sheets[1]!;
    expect(dismissed.headers).toContain('Selector');
    expect(dismissed.headers).toHaveLength(7);
    expect(dismissed.rows[0]![dismissed.headers.indexOf('Selector')]).toBe(DISMISSED_SELECTOR);
  }, 60_000);
});

describe('GET /api/v1/scans/:scanId/dismissals', () => {
  async function list(who: string): Promise<{ body: string; rows: Array<Record<string, unknown>> }> {
    const res = await server.inject({
      method: 'GET', url: `/api/v1/scans/${dismissedScanId}/dismissals`, headers: { 'x-who': who },
    });
    expect(res.statusCode).toBe(200);
    return { body: res.body, rows: (JSON.parse(res.body) as { dismissals: Array<Record<string, unknown>> }).dismissals };
  }

  it('D-08 an Analyst gets dismissal rows without a selector key and an Owner gets them with it', async () => {
    const analyst = await list('analyst');
    expect(analyst.rows).toHaveLength(1);
    for (const row of analyst.rows) expect('selector' in row, 'selector key present').toBe(false);
    expect(analyst.body).not.toContain(DISMISSED_ID);
    expect(analyst.rows[0]!['code']).toBe(CODE);

    const owner = await list('owner');
    expect(owner.rows).toHaveLength(1);
    expect(owner.rows[0]!['selector']).toBe(DISMISSED_SELECTOR);
  }, 60_000);

  it('D-08 the list keeps its actor redaction for a viewer outside the scan org', async () => {
    const systemSite = `https://fabrikam.example/${HEX.slice(0, 8)}/system/`;
    const systemScanId = await seedSurfaceScan(storage, { orgId: 'system', siteUrl: systemSite, report: report(systemSite, true), location: 'db' });
    // Marked with an actor id, so the stored row holds one the redaction must drop.
    const marked = await storage.issueDismissals!.mark({
      orgId: 'system', siteUrl: systemSite, siteKey: toSiteKey(systemSite), code: CODE,
      selector: DISMISSED_SELECTOR, reason: 'seeded', actor: 'fabrikam-admin', actorId: 'user-fabrikam-admin',
    });
    if (marked.kind !== 'created') throw new Error('seed: dismissal already active');
    const dismissal = marked.dismissal;
    expect(dismissal.createdById).toBe('user-fabrikam-admin');
    const res = await server.inject({
      method: 'GET', url: `/api/v1/scans/${systemScanId}/dismissals`, headers: { 'x-who': 'analyst' },
    });
    expect(res.statusCode).toBe(200);
    const rows = (JSON.parse(res.body) as { dismissals: Array<Record<string, unknown>> }).dismissals;
    expect(rows).toHaveLength(1);
    expect(rows[0]!['id']).toBe(dismissal.id);
    // The redaction that already existed: no actor id for a viewer who may not touch the org.
    expect(rows[0]!['created_by_id']).toBeNull();
    expect(rows[0]!['revoked_by_id']).toBeNull();
  }, 60_000);
});

describe('the dismissals schema', () => {
  it('D-10 the list response declares selector optional and names reports.view_technical, the mark response keeps it required', () => {
    const item = (ListResponse as unknown as {
      properties: { dismissals: { items: { required?: string[]; properties: { selector: { description?: string } } } } };
    }).properties.dismissals.items;
    expect(item.required ?? []).not.toContain('selector');
    expect(item.properties.selector.description ?? '').toContain('reports.view_technical');
    expect((DismissalSchema as unknown as { required: string[] }).required).toContain('selector');
  });
});
