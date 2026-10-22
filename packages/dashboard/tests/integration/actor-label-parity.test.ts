/**
 * SC3 / ACT-01 (D-06): an API-key actor reads the same on every surface that names it. Measured
 * through the REAL createServer and the real cookie routes: the report page's Dismissed by cell and
 * the Excel export's Dismissed By cell, and (plan 95-02, ACT-02) the Audit Log Actor cell.
 *
 * Public repo: Fabrikam labels only. One login per file (the login route is rate limited).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { JSDOM } from 'jsdom';
import ExcelJS from 'exceljs';
import { createServer } from '../../src/server.js';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { loadTranslations, t } from '../../src/i18n/index.js';
import { toSiteKey } from '../../src/services/issue-dismissals/site-key.js';
import {
  CODE_ALT,
  CODE_CONTRAST,
  CODE_LINK,
  DISMISS_PARTIAL,
  DISMISS_WHOLE,
  FABRIKAM_SITE,
  REASON_TOKEN,
  SEL_LINK,
  seedSurfaceScan,
} from '../helpers/dismissal-surface-fixture.js';

const PASSWORD = 'Parity-Pass-123!';
const ADMIN = 'fabrikam-parity-admin';

let tmpRoot: string;
let app: FastifyInstance;
let seed: SqliteStorageAdapter;
let orgId: string;
let scanId: string;
let cookie: string;
let reportHtml = '';

const tokenOf = (html: string): string | undefined =>
  /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] ?? /name="_csrf" value="([^"]+)"/.exec(html)?.[1];

async function login(username: string): Promise<string> {
  const loginPage = await app.inject({ method: 'GET', url: '/login' });
  const loginCookie = loginPage.cookies.find((c) => c.name === 'session')!.value;
  const res = await app.inject({
    method: 'POST', url: '/login', cookies: { session: loginCookie },
    headers: { 'x-csrf-token': tokenOf(loginPage.body)! },
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode).toBe(302);
  return res.cookies.find((c) => c.name === 'session')!.value;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The Dismissed by cell of the active-row for `code`, the column found by its header text. */
async function reportCell(code: string): Promise<string> {
  const page = await app.inject({ method: 'GET', url: `/reports/${scanId}`, cookies: { session: cookie } });
  expect(page.statusCode).toBe(200);
  reportHtml = page.body;
  const doc = new JSDOM(page.body).window.document;
  const table = doc.querySelector('#rpt-dismissed table');
  expect(table, 'Dismissed table rendered').not.toBeNull();
  const headers = [...table!.querySelectorAll('thead th')].map((th) => collapse(th.textContent ?? ''));
  const col = headers.indexOf(t('issueDismissals.col.dismissedBy', 'en'));
  expect(col, 'Dismissed by header found').toBeGreaterThanOrEqual(0);
  const ruleCol = headers.indexOf(t('issueDismissals.col.rule', 'en'));
  for (const tr of table!.querySelectorAll('tbody tr')) {
    const cells = [...tr.querySelectorAll('td')];
    if (collapse(cells[ruleCol]?.textContent ?? '') === code) return collapse(cells[col]?.textContent ?? '');
  }
  throw new Error(`no row for ${code}`);
}

let workbookText = '';

/** The Dismissed By cell of the first Dismissed-sheet data row for `code`. */
async function exportCell(code: string): Promise<string> {
  const res = await app.inject({
    method: 'GET', url: `/api/v1/export/scans/${scanId}/issues.xlsx`, cookies: { session: cookie },
  });
  expect(res.statusCode).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.rawPayload);
  const sheet = wb.getWorksheet(t('dismissalsExport.sheetName', 'en'));
  expect(sheet, 'Dismissed worksheet present').toBeDefined();
  const all: string[] = [];
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => all.push(String(c.value ?? ''))));
  workbookText = all.join('\n');
  const header = (sheet!.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
  const col = header.indexOf(t('dismissalsExport.colDismissedBy', 'en'));
  const codeCol = header.indexOf(t('dismissalsExport.colRuleCode', 'en'));
  expect(col, 'Dismissed By header found').toBeGreaterThan(0);
  for (let r = 2; r <= sheet!.rowCount; r++) {
    if (String(sheet!.getRow(r).getCell(codeCol).value ?? '') === code) return collapse(String(sheet!.getRow(r).getCell(col).value ?? ''));
  }
  throw new Error(`no export row for ${code}`);
}

async function keyCreatedAt(keyId: string): Promise<string> {
  const row = (await seed.apiKeys.listKeys(orgId)).find((k) => k.id === keyId);
  if (row === undefined) throw new Error('seeded key not found');
  return row.createdAt;
}

async function markAsKey(
  match: { code: string; selector: string }, label: string,
): Promise<{ keyId: string; createdAt: string; dismissalId: string }> {
  const keyId = await seed.apiKeys.storeKey(`placeholder-${Math.random()}-${label.length}`, label, orgId, 'admin');
  const createdAt = await keyCreatedAt(keyId);
  const result = await seed.issueDismissals!.mark({
    orgId, siteUrl: FABRIKAM_SITE, siteKey: toSiteKey(FABRIKAM_SITE),
    code: match.code, selector: match.selector, reason: REASON_TOKEN,
    actor: `api-key:${keyId}`, actorId: `api-key:${keyId}`,
    actorKeySnapshot: { label, keyCreatedAt: createdAt },
  });
  if (result.kind !== 'created') throw new Error('markAsKey: already active');
  return { keyId, createdAt, dismissalId: result.dismissal.id };
}

let auditHtml = '';

/** The Actor cell of the Audit Log row for the dismissal `dismissalId`, columns found by header text. */
async function auditCell(dismissalId: string): Promise<string> {
  const res = await app.inject({
    method: 'GET', url: '/admin/audit-log?action=issue_dismissal.mark', cookies: { session: cookie },
  });
  expect(res.statusCode).toBe(200);
  auditHtml = res.body;
  const doc = new JSDOM(res.body).window.document;
  const table = doc.querySelector('table');
  expect(table, 'Audit Log table rendered').not.toBeNull();
  const headers = [...table!.querySelectorAll('thead th')].map((th) => collapse(th.textContent ?? ''));
  const actorCol = headers.indexOf(t('audit.actor', 'en'));
  const idCol = headers.indexOf(t('audit.resourceId', 'en'));
  expect(actorCol, 'Actor header found').toBeGreaterThanOrEqual(0);
  expect(idCol, 'Resource ID header found').toBeGreaterThanOrEqual(0);
  for (const tr of table!.querySelectorAll('tbody tr')) {
    const cells = [...tr.querySelectorAll('td')];
    if (collapse(cells[idCol]?.textContent ?? '') === dismissalId) return collapse(cells[actorCol]?.textContent ?? '');
  }
  throw new Error(`no Audit Log row for ${dismissalId}`);
}

const namedText = (label: string, createdAt: string): string =>
  `${t('issueDismissals.actor.apiKeyNamed', 'en', { name: label })} (${t('admin.apiKeys.created', 'en')} ${new Date(createdAt).toLocaleString('en')})`;

beforeAll(async () => {
  loadTranslations();
  tmpRoot = mkdtempSync(join(tmpdir(), 'luqen-actor-label-parity-'));
  const dbPath = join(tmpRoot, 'dashboard.db');
  app = (await createServer({
    dbPath, reportsDir: join(tmpRoot, 'reports'), sessionSecret: 'p'.repeat(32),
    catalogueUrl: '', catalogueCacheTtl: 0, redisUrl: '', maxConcurrentScans: 1,
  } as never)) as FastifyInstance;
  await app.ready();
  seed = new SqliteStorageAdapter(dbPath);
  await seed.migrate();
  orgId = (await seed.organizations.createOrg({ name: 'Fabrikam', slug: 'fabrikam-actor-parity' })).id;
  const admin = await seed.users.createUser(ADMIN, PASSWORD, 'admin');
  await seed.organizations.addMember(orgId, admin.id, 'owner');
  scanId = await seedSurfaceScan(seed, { orgId, location: 'db' });
  cookie = await login(ADMIN);
}, 120_000);

afterAll(async () => {
  if (seed !== undefined) await seed.disconnect();
  if (app !== undefined) await app.close();
  if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('an API-key actor reads the same on every surface', () => {
  it('ACT-01 an API key of the scan org reads the same on the report page and in the Excel export', async () => {
    const { keyId, createdAt } = await markAsKey(DISMISS_PARTIAL, 'Fabrikam CI');
    const onPage = await reportCell(CODE_CONTRAST);
    const inExport = await exportCell(CODE_CONTRAST);
    expect(onPage).toBe(namedText('Fabrikam CI', createdAt));
    expect(inExport).toBe(onPage);
    expect(reportHtml).not.toContain('api-key:');
    expect(reportHtml).not.toContain(keyId);
    expect(workbookText).not.toContain('api-key:');
    expect(workbookText).not.toContain(keyId);
  }, 60_000);

  it('ACT-01 a deleted key still reads its label on the report page and in the Excel export', async () => {
    const { keyId, createdAt } = await markAsKey(DISMISS_WHOLE, 'Fabrikam Deploy');
    // The product deletes a key only after revoking it.
    await seed.apiKeys.revokeKey(keyId, orgId);
    expect(await seed.apiKeys.deleteKey(keyId, orgId)).toBe(true);
    expect((await seed.apiKeys.listKeys(orgId)).some((k) => k.id === keyId)).toBe(false);

    const onPage = await reportCell(CODE_ALT);
    const inExport = await exportCell(CODE_ALT);
    expect(onPage).toBe(namedText('Fabrikam Deploy', createdAt));
    expect(inExport).toBe(onPage);
    expect(reportHtml).not.toContain(keyId);
    expect(workbookText).not.toContain(keyId);
  }, 60_000);
});

describe('the Audit Log Actor column reads the same label (ACT-02)', () => {
  it('ACT-02 the Audit Log Actor column reads the same label as the report page and the Excel export', async () => {
    // One dismissal of a real finding of the scan, read on all three surfaces.
    const { createdAt, dismissalId } = await markAsKey({ code: CODE_LINK, selector: SEL_LINK }, 'Fabrikam Audit CI');
    const inAudit = await auditCell(dismissalId);
    const onPage = await reportCell(CODE_LINK);
    const inExport = await exportCell(CODE_LINK);
    expect(inAudit).toBe(namedText('Fabrikam Audit CI', createdAt));
    expect(onPage).toBe(inAudit);
    expect(inExport).toBe(inAudit);
  }, 60_000);

  it('ACT-02 the Audit Log names a deleted key from the dismissal snapshot', async () => {
    const { keyId, createdAt, dismissalId } = await markAsKey({ code: CODE_ALT, selector: '#fabrikam-audit-deleted' }, 'Fabrikam Audit Deploy');
    await seed.apiKeys.revokeKey(keyId, orgId);
    expect(await seed.apiKeys.deleteKey(keyId, orgId)).toBe(true);
    expect(await auditCell(dismissalId)).toBe(namedText('Fabrikam Audit Deploy', createdAt));
  }, 60_000);

  it('ACT-02 the Audit Log page carries no stored api-key identifier or key id', async () => {
    const { keyId, dismissalId } = await markAsKey({ code: CODE_ALT, selector: '#fabrikam-audit-nightly' }, 'Fabrikam Audit Nightly');
    await auditCell(dismissalId);
    expect(auditHtml).not.toContain('api-key:');
    expect(auditHtml).not.toContain(keyId);
  }, 60_000);

  it('ACT-02 a user actor still reads its user name in the Audit Log', async () => {
    const result = await seed.issueDismissals!.mark({
      orgId, siteUrl: FABRIKAM_SITE, siteKey: toSiteKey(FABRIKAM_SITE),
      code: CODE_ALT, selector: '#fabrikam-user-mark', reason: REASON_TOKEN,
      actor: ADMIN, actorId: 'fabrikam-parity-admin-id',
    });
    if (result.kind !== 'created') throw new Error('user mark: already active');
    expect(await auditCell(result.dismissal.id)).toBe(ADMIN);
  }, 60_000);
});
