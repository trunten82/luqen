/**
 * ACT-01 (D-06): the Excel export's Dismissed By column reads an API-key actor the way the report
 * page does, through the shared actor-label module, and never writes the stored `api-key:<row id>`.
 *
 * Drives the REAL issues.xlsx route (real SQLite store) and reads the workbook back. The column is
 * found by its header text, never by index: the Selector column can drop out of the sheet.
 * Public repo: Fabrikam / Northwind labels only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env['TZ'] ??= 'UTC';

import ExcelJS from 'exceljs';
import { exportRoutes } from '../../../src/routes/api/export.js';
import { loadTranslations, t } from '../../../src/i18n/index.js';
import {
  createSurfaceContext,
  makeServer,
  registerViewHelpers,
  type SurfaceContext,
} from '../../golden/drivers/render-drivers.js';
import {
  DISMISS_PARTIAL,
  FABRIKAM_SITE,
  REASON_TOKEN,
  seedSurfaceDismissal,
} from '../../helpers/dismissal-surface-fixture.js';
import { toSiteKey } from '../../../src/services/issue-dismissals/site-key.js';

let ctx: SurfaceContext;

beforeAll(() => {
  loadTranslations();
});

beforeEach(async () => {
  registerViewHelpers();
  ctx = await createSurfaceContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

interface Cell {
  readonly value: unknown;
  readonly isString: boolean;
  readonly hasFormula: boolean;
}
interface ParsedSheet {
  readonly name: string;
  readonly rows: readonly (readonly Cell[])[];
}

async function getIssuesXlsx(): Promise<ParsedSheet[]> {
  const server = await makeServer(ctx, (s) => exportRoutes(s, ctx.storage));
  try {
    const res = await server.inject({ method: 'GET', url: `/api/v1/export/scans/${ctx.scanId}/issues.xlsx` });
    expect(res.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload);
    return wb.worksheets.map((ws) => {
      const rows: Cell[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const cells: Cell[] = [];
        for (let i = 1; i <= ws.columnCount; i++) {
          const cell = row.getCell(i);
          const model = cell.model as { formula?: unknown; sharedFormula?: unknown };
          cells.push({
            value: cell.value ?? null,
            isString: cell.type === ExcelJS.ValueType.String,
            hasFormula: model.formula !== undefined || model.sharedFormula !== undefined,
          });
        }
        rows.push(cells);
      });
      return { name: ws.name, rows };
    });
  } finally {
    await server.close();
  }
}

function dismissedSheet(sheets: readonly ParsedSheet[]): ParsedSheet {
  const sheet = sheets.find((s) => s.name === t('dismissalsExport.sheetName', 'en'));
  if (sheet === undefined) throw new Error('Dismissed worksheet missing');
  return sheet;
}

/** The Dismissed By cells of every data row, the column located by its header text. */
function dismissedByCells(sheet: ParsedSheet): Cell[] {
  const header = sheet.rows[0]!.map((c) => String(c.value ?? ''));
  const col = header.indexOf(t('dismissalsExport.colDismissedBy', 'en'));
  expect(col, 'Dismissed By header found').toBeGreaterThanOrEqual(0);
  return sheet.rows.slice(1).map((r) => r[col]!);
}

function allText(sheets: readonly ParsedSheet[]): string {
  return sheets.map((s) => s.rows.map((r) => r.map((c) => String(c.value)).join('|')).join('\n')).join('\n');
}

async function keyCreatedAt(orgId: string, keyId: string): Promise<string> {
  const row = (await ctx.storage.apiKeys.listKeys(orgId)).find((k) => k.id === keyId);
  if (row === undefined) throw new Error('seeded key not found');
  return row.createdAt;
}

function namedText(label: string, createdAt: string): string {
  return `${t('issueDismissals.actor.apiKeyNamed', 'en', { name: label })} (${t('admin.apiKeys.created', 'en')} ${new Date(createdAt).toLocaleString('en')})`;
}

/** Store a key and mark DISMISS_PARTIAL as that key (with the snapshot the product stores for a scan-org key). */
async function markAsKey(label: string, orgId: string, snapshot: boolean): Promise<{ keyId: string; createdAt: string }> {
  const keyId = await ctx.storage.apiKeys.storeKey(`placeholder-${Math.random()}-${label.length}`, label, orgId, 'admin');
  const createdAt = await keyCreatedAt(orgId, keyId);
  const result = await ctx.storage.issueDismissals!.mark({
    orgId: ctx.orgs.fabrikamOrgId,
    siteUrl: FABRIKAM_SITE,
    siteKey: toSiteKey(FABRIKAM_SITE),
    code: DISMISS_PARTIAL.code,
    selector: DISMISS_PARTIAL.selector,
    reason: REASON_TOKEN,
    actor: `api-key:${keyId}`,
    actorId: `api-key:${keyId}`,
    ...(snapshot ? { actorKeySnapshot: { label, keyCreatedAt: createdAt } } : {}),
  });
  if (result.kind !== 'created') throw new Error('markAsKey: already active');
  return { keyId, createdAt };
}

describe('issues.xlsx Dismissed By names an API key the way the report page does', () => {
  it('ACT-01 the Dismissed By column names an API key of the scan org', async () => {
    const { createdAt } = await markAsKey('Fabrikam CI', ctx.orgs.fabrikamOrgId, true);
    const cells = dismissedByCells(dismissedSheet(await getIssuesXlsx()));
    expect(cells).toHaveLength(3);
    for (const cell of cells) expect(String(cell.value)).toBe(namedText('Fabrikam CI', createdAt));
  });

  it('ACT-01 the Dismissed By column reads API key for a key of another organization', async () => {
    // A Northwind key marking on the Fabrikam scan: no snapshot, and not in the scan org's key list.
    const { keyId } = await markAsKey('Northwind CI', ctx.orgs.northwindOrgId, false);
    const sheets = await getIssuesXlsx();
    for (const cell of dismissedByCells(dismissedSheet(sheets))) {
      expect(String(cell.value)).toBe(t('issueDismissals.actor.apiKey', 'en'));
    }
    expect(allText(sheets)).not.toContain('Northwind CI');
    expect(allText(sheets)).not.toContain(keyId);
  });

  it('ACT-01 a key label that looks like a formula is written as plain text', async () => {
    await markAsKey('=HYPERLINK("https://northwind.example","x")', ctx.orgs.fabrikamOrgId, true);
    const cells = dismissedByCells(dismissedSheet(await getIssuesXlsx()));
    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(cell.hasFormula).toBe(false);
      expect(cell.isString).toBe(true);
      expect(String(cell.value).startsWith(t('issueDismissals.actor.apiKeyNamed', 'en', { name: '' }))).toBe(true);
      expect(String(cell.value)).toContain('=HYPERLINK(');
    }
  });

  it('ACT-01 a user dismissal still reads the user name in the Dismissed By column', async () => {
    await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match: DISMISS_PARTIAL });
    const cells = dismissedByCells(dismissedSheet(await getIssuesXlsx()));
    expect(cells).toHaveLength(3);
    for (const cell of cells) expect(String(cell.value)).toBe('fabrikam-admin');
  });

  it('ACT-01 no cell of the workbook carries the stored api-key identifier or the key id', async () => {
    const own = await markAsKey('Fabrikam CI', ctx.orgs.fabrikamOrgId, true);
    const sheets = await getIssuesXlsx();
    const text = allText(sheets);
    expect(dismissedByCells(dismissedSheet(sheets))).toHaveLength(3); // positive control: rows were written
    expect(text).not.toContain('api-key:');
    expect(text).not.toContain(own.keyId);
  });
});
