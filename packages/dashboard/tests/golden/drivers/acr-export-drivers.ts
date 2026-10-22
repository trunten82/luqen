/**
 * Export + ACR drivers (Phase 88). One driver per export or ACR assembly, each
 * entering through the REAL production entry point with the REAL store.
 * Reused by Plans 04 and 05 with dismissals seeded. Drivers never assert.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { exportRoutes } from '../../../src/routes/api/export.js';
import { publicAcrRoutes } from '../../../src/routes/public-acr.js';
import { accessibilityStatementRoutes } from '../../../src/routes/accessibility-statement.js';
import {
  buildScanAcrView,
  loadVpatForScan,
} from '../../../src/services/vpat-share-service.js';
import { buildFleetReportBundle } from '../../../src/services/fleet-report-service.js';
import {
  FABRIKAM_SITE,
  FIXED_COMPLETED_AT,
} from '../../helpers/dismissal-surface-fixture.js';
import { makeServer, type SurfaceContext } from './render-drivers.js';
import { capturedReportPdfCalls, capturedVpatPdfCalls } from './pdf-capture.js';

function uploadsRootOf(ctx: SurfaceContext): string {
  return join(ctx.store.reportsDir, 'uploads');
}

/**
 * Collapse each inlined base64 TTF payload to `<font:ttf len:N sha256:H>`. The
 * shared ACR template inlines ~3.7 MB of static font bytes that no dismissal can
 * touch; the length + hash keep the font identity in the golden without
 * committing megabytes of base64. Everything else in the HTML stays verbatim.
 */
export function collapseFontPayloads(html: string): string {
  return html.replace(/data:font\/ttf;base64,([A-Za-z0-9+/=]+)/g, (_m, b64: string) => {
    const hash = createHash('sha256').update(b64).digest('hex').slice(0, 16);
    return `data:font/ttf;base64,<font:ttf len:${b64.length} sha256:${hash}>`;
  });
}

function ok(statusCode: number, what: string): void {
  if (statusCode !== 200) throw new Error(`${what}: expected 200, got ${statusCode}`);
}

async function loadScanAndVpat(ctx: SurfaceContext) {
  const scan = await ctx.storage.scans.getScan(ctx.scanId);
  if (scan === null) throw new Error('main scan missing');
  const loaded = await loadVpatForScan(ctx.storage, scan);
  if (loaded === null) throw new Error('loadVpatForScan returned null for the main scan');
  return { scan, loaded };
}

/** GET /api/v1/export/scans/:id/issues.xlsx, every worksheet parsed to cell arrays (never raw bytes). */
export async function driveIssuesXlsx(ctx: SurfaceContext, scanId: string) {
  // Phase 93: the Selector/Context columns reach only a caller holding reports.view_technical; the
  // baseline was captured for an entitled caller, so this identity holds it (baseline not edited).
  const server = await makeServer(ctx, (s) => exportRoutes(s, ctx.storage), ['reports.view_technical']);
  try {
    const res = await server.inject({ method: 'GET', url: `/api/v1/export/scans/${scanId}/issues.xlsx` });
    ok(res.statusCode, 'issues.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload);
    const sheets: Record<string, unknown[][]> = {};
    for (const ws of wb.worksheets) {
      const rows: unknown[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const cells: unknown[] = [];
        for (let i = 1; i <= ws.columnCount; i++) cells.push(row.getCell(i).value ?? null);
        rows.push(cells);
      });
      sheets[ws.name] = rows;
    }
    return { sheetNames: wb.worksheets.map((w) => w.name), sheets };
  } finally {
    await server.close();
  }
}

/** GET /api/v1/export/scans/:id/report.pdf with generatePdfFromData captured by the test file's vi.mock. */
export async function driveReportPdfData(ctx: SurfaceContext, scanId: string): Promise<unknown> {
  const server = await makeServer(ctx, (s) => exportRoutes(s, ctx.storage));
  try {
    const res = await server.inject({ method: 'GET', url: `/api/v1/export/scans/${scanId}/report.pdf` });
    ok(res.statusCode, 'report.pdf');
    const calls = capturedReportPdfCalls();
    if (calls.length !== 1) throw new Error(`report.pdf: expected 1 generatePdfFromData call, got ${calls.length}`);
    return calls[0];
  } finally {
    await server.close();
  }
}

/** loadVpatForScan -> the VPAT model (generatedAt pinned by the faked clock). */
export async function driveVpatModel(ctx: SurfaceContext): Promise<unknown> {
  const { loaded } = await loadScanAndVpat(ctx);
  return loaded.vpat;
}

/** buildScanAcrView for one locale. */
export async function driveAcrView(ctx: SurfaceContext, locale: 'en' | 'it'): Promise<unknown> {
  const { scan, loaded } = await loadScanAndVpat(ctx);
  return buildScanAcrView(ctx.storage, scan, loaded, { locale, uploadsRoot: uploadsRootOf(ctx) });
}

/** GET /reports/:id/acr after the owner opts the scan into public sharing (en). */
export async function drivePublicAcrHtml(ctx: SurfaceContext, scanId: string): Promise<string> {
  await ctx.storage.scans.setPublicShare(scanId, ctx.orgs.fabrikamOrgId, true, 'fabrikam-admin');
  const server = await makeServer(ctx, (s) => publicAcrRoutes(s, ctx.storage, undefined, uploadsRootOf(ctx)));
  try {
    const res = await server.inject({
      method: 'GET',
      url: `/reports/${scanId}/acr`,
      headers: { host: 'dashboard.example' },
    });
    ok(res.statusCode, 'public ACR');
    return collapseFontPayloads(res.body);
  } finally {
    await server.close();
  }
}

/** GET /accessibility-statement/:slug for the Fabrikam org configured with FABRIKAM_SITE. */
export async function driveStatementHtml(ctx: SurfaceContext): Promise<string> {
  await ctx.storage.accessibilityStatements.upsert(
    ctx.orgs.fabrikamOrgId,
    {
      enabled: true,
      wcagVersion: '2.1',
      wcagLevel: 'AA',
      entityName: 'Fabrikam',
      siteUrl: FABRIKAM_SITE,
      contactEmail: 'access@fabrikam.example',
    },
    'fabrikam-admin',
  );
  const server = await makeServer(ctx, (s) => accessibilityStatementRoutes(s, ctx.storage));
  try {
    const res = await server.inject({ method: 'GET', url: '/accessibility-statement/fabrikam' });
    ok(res.statusCode, 'accessibility statement');
    return res.body;
  } finally {
    await server.close();
  }
}

/** buildFleetReportBundle with generateVpatPdf captured: the vpat argument for the Fabrikam scan. */
export async function driveFleetVpatInput(ctx: SurfaceContext): Promise<unknown> {
  await buildFleetReportBundle(ctx.storage, ctx.orgs.fabrikamOrgId, {
    orgLabel: 'Fabrikam',
    generatedAt: FIXED_COMPLETED_AT.slice(0, 10),
  });
  const calls = capturedVpatPdfCalls();
  if (calls.length !== 1) throw new Error(`fleet report: expected 1 generateVpatPdf call, got ${calls.length}`);
  return calls[0];
}
