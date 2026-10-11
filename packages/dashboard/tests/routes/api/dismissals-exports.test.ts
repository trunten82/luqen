/**
 * Phase 88 Plan 05: dismissals on the export routes (D-06, D-18, D-19).
 *
 * One test per export call site. Each seeds its own dismissal for the Fabrikam org +
 * site, drives the REAL route (Plan 01 drivers' server, real SQLite store) and asserts
 * what the exported artefact holds. Foreign dismissals (Northwind on the same URL,
 * Fabrikam on another site) are seeded by createSurfaceContext and must never apply.
 *
 * report.pdf reaches generatePdfFromData; its ARGUMENT is captured (never PDF bytes).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { resetPdfCapture } from '../../golden/drivers/pdf-capture.js';
import {
  AFTER_PARTIAL,
  CODE_CONTRAST,
  DISMISS_PARTIAL,
  FABRIKAM_SITE,
  REASON_TOKEN,
  SEL_DISMISSED,
  SEL_LINK,
  SEL_SIBLING,
  assertDismissedAbsent,
  assertSiblingPresent,
  seedSurfaceDismissal,
} from '../../helpers/dismissal-surface-fixture.js';
import { toSiteKey } from '../../../src/services/issue-dismissals/site-key.js';

vi.mock('../../../src/pdf/generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/pdf/generator.js')>();
  const capture = await import('../../golden/drivers/pdf-capture.js');
  return { ...actual, generatePdfFromData: capture.captureReportPdf };
});

let ctx: SurfaceContext;

beforeAll(() => {
  loadTranslations();
});

beforeEach(async () => {
  resetPdfCapture();
  registerViewHelpers();
  ctx = await createSurfaceContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

async function dismiss(match: { readonly code: string; readonly selector: string }) {
  return seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match });
}

interface Cell {
  readonly value: unknown;
  readonly isString: boolean;
  readonly hasFormula: boolean;
}
interface ParsedSheet {
  readonly name: string;
  readonly rows: readonly (readonly Cell[])[];
}

async function getIssuesXlsx(query = ''): Promise<{ sheets: ParsedSheet[]; text: string }> {
  const server = await makeServer(ctx, (s) => exportRoutes(s, ctx.storage));
  try {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/export/scans/${ctx.scanId}/issues.xlsx${query}`,
    });
    expect(res.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload);
    const sheets: ParsedSheet[] = wb.worksheets.map((ws) => {
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
    const text = sheets.map((s) => s.rows.map((r) => r.map((c) => String(c.value)).join('|')).join('\n')).join('\n');
    return { sheets, text };
  } finally {
    await server.close();
  }
}

function values(sheet: ParsedSheet, rowIndex: number): string[] {
  return (sheet.rows[rowIndex] ?? []).map((c) => String(c.value ?? ''));
}

function sheetNamed(sheets: readonly ParsedSheet[], index: number): ParsedSheet {
  const sheet = sheets[index];
  if (sheet === undefined) throw new Error(`worksheet ${index} missing`);
  return sheet;
}

describe('issues.xlsx applies the scan org active dismissals', () => {
  it('issues.xlsx drops a dismissed finding from the Issues sheet', async () => {
    await dismiss(DISMISS_PARTIAL);
    const { sheets } = await getIssuesXlsx();
    const issues = sheetNamed(sheets, 0);
    expect(issues.name).toBe('Issues');
    const selectorColumn = values(issues, 0).indexOf('Selector');
    expect(selectorColumn).toBeGreaterThanOrEqual(0);
    const selectors = issues.rows.slice(1).map((r) => String(r[selectorColumn]?.value ?? ''));
    expect(selectors).not.toContain(SEL_DISMISSED);
    expect(selectors).toContain(SEL_SIBLING);
    expect(selectors).toContain(SEL_LINK);
    // 8 raw occurrences minus the 3 dismissed ones: the Issues sheet follows the filtered report.
    expect(issues.rows.length - 1).toBe(AFTER_PARTIAL.total);
  });

  it('issues.xlsx lists dismissed occurrences on a Dismissed sheet with reason, actor and date', async () => {
    const dismissal = await dismiss(DISMISS_PARTIAL);
    const { sheets } = await getIssuesXlsx();
    expect(sheets.map((s) => s.name)).toEqual(['Issues', 'Dismissed']);
    const dismissed = sheetNamed(sheets, 1);
    expect(values(dismissed, 0)).toEqual([
      'Page URL',
      'Rule Code',
      'Selector',
      'Level',
      'Reason',
      'Dismissed By',
      'Dismissed At',
    ]);
    const data = dismissed.rows.slice(1).map((_, i) => values(dismissed, i + 1));
    expect(data).toHaveLength(3);
    for (const row of data) {
      expect(row.slice(1)).toEqual([
        CODE_CONTRAST,
        SEL_DISMISSED,
        'error',
        REASON_TOKEN,
        'fabrikam-admin',
        dismissal.createdAt,
      ]);
    }
    expect(data.map((r) => r[0]).sort()).toEqual(
      [FABRIKAM_SITE, `${FABRIKAM_SITE}about`, `${FABRIKAM_SITE}contact`].sort(),
    );
  });

  it('issues.xlsx Dismissed sheet is localised for the request locale', async () => {
    await dismiss(DISMISS_PARTIAL);
    const { sheets } = await getIssuesXlsx('?lang=it');
    expect(sheets).toHaveLength(2);
    const issues = sheetNamed(sheets, 0);
    const dismissed = sheetNamed(sheets, 1);
    expect(dismissed.name).toBe(t('dismissalsExport.sheetName', 'it'));
    const italian = [
      'colPageUrl',
      'colRuleCode',
      'colSelector',
      'colLevel',
      'colReason',
      'colDismissedBy',
      'colDismissedAt',
    ].map((k) => t(`dismissalsExport.${k}`, 'it'));
    expect(values(dismissed, 0)).toEqual(italian);
    expect(italian).not.toEqual(
      ['Page URL', 'Rule Code', 'Selector', 'Level', 'Reason', 'Dismissed By', 'Dismissed At'],
    );
    // The Issues sheet keeps its existing English literals (SC5).
    expect(issues.name).toBe('Issues');
    expect(values(issues, 0).slice(0, 3)).toEqual(['Severity', 'Priority', 'WCAG Criterion']);
  });

  it('issues.xlsx Dismissed sheet falls back to English for an unsupported ?lang=', async () => {
    await dismiss(DISMISS_PARTIAL);
    const { sheets } = await getIssuesXlsx('?lang=xx');
    expect(sheetNamed(sheets, 1).name).toBe('Dismissed');
    expect(values(sheetNamed(sheets, 1), 0)[0]).toBe('Page URL');
  });

  it('issues.xlsx has no Dismissed sheet when nothing is dismissed', async () => {
    // createSurfaceContext seeded only foreign dismissals (other org, same URL; same org, other site).
    const { sheets, text } = await getIssuesXlsx();
    expect(sheets.map((s) => s.name)).toEqual(['Issues']);
    expect(text).not.toContain(REASON_TOKEN);
  });

  it('issues.xlsx writes a formula-looking reason as a plain string', async () => {
    const hostile = '=1+1 HYPERLINK';
    const result = await ctx.storage.issueDismissals!.mark({
      orgId: ctx.orgs.fabrikamOrgId,
      siteUrl: FABRIKAM_SITE,
      siteKey: toSiteKey(FABRIKAM_SITE),
      code: DISMISS_PARTIAL.code,
      selector: DISMISS_PARTIAL.selector,
      reason: hostile,
      actor: 'fabrikam-admin',
    });
    expect(result.kind).toBe('created');
    const { sheets } = await getIssuesXlsx();
    const dismissed = sheetNamed(sheets, 1);
    const reasonCells = dismissed.rows.slice(1).map((r) => r[4]);
    expect(reasonCells).toHaveLength(3);
    for (const cell of reasonCells) {
      expect(cell?.value).toBe(hostile);
      expect(cell?.isString).toBe(true);
      expect(cell?.hasFormula).toBe(false);
    }
  });

  it('issues.xlsx never carries the dismissal reason on the Issues sheet', async () => {
    await dismiss(DISMISS_PARTIAL);
    const { sheets } = await getIssuesXlsx();
    const issuesText = sheetNamed(sheets, 0).rows.map((r) => r.map((c) => String(c.value)).join('|')).join('\n');
    assertDismissedAbsent(issuesText, 'partial');
    assertSiblingPresent(issuesText);
  });
});
