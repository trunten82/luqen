/**
 * Phase 88 Plan 05: dismissals on the email attachments (D-06, D-19).
 *
 * Drives the REAL buildAttachments (Plan 01 drivers, real SQLite store, report on disk
 * AND in the DB). The notification PDF is observed through the generatePdfFromData
 * ARGUMENT (never PDF bytes); the CSV through its content. Foreign dismissals are
 * seeded by createSurfaceContext and must never apply. No new PDF section and no
 * reason/actor column are added (D-19, P2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env['TZ'] ??= 'UTC';

import { generateIssuesCsv } from '../../src/email/report-generator.js';
import type { StorageAdapter } from '../../src/db/index.js';
import {
  createSurfaceContext,
  driveEmailCsv,
  driveNotificationPdfEnvelope,
  registerViewHelpers,
  type SurfaceContext,
} from '../golden/drivers/render-drivers.js';
import { capturedReportPdfCalls, resetPdfCapture } from '../golden/drivers/pdf-capture.js';
import {
  AFTER_PARTIAL,
  DISMISS_PARTIAL,
  assertDismissedAbsent,
  assertSiblingPresent,
  seedSurfaceDismissal,
} from '../helpers/dismissal-surface-fixture.js';

vi.mock('../../src/pdf/generator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/pdf/generator.js')>();
  const capture = await import('../golden/drivers/pdf-capture.js');
  return { ...actual, generatePdfFromData: capture.captureReportPdf };
});

let ctx: SurfaceContext;

beforeEach(async () => {
  resetPdfCapture();
  registerViewHelpers();
  ctx = await createSurfaceContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

async function dismiss(match: { readonly code: string; readonly selector: string }): Promise<void> {
  await seedSurfaceDismissal(ctx.storage, { orgId: ctx.orgs.fabrikamOrgId, match });
}

describe('notification attachments apply the scan org active dismissals', () => {
  it('notification PDF attachment data omits a dismissed finding', async () => {
    await driveNotificationPdfEnvelope(ctx);
    const before = capturedReportPdfCalls()[0] as { reportData: Record<string, unknown> };
    resetPdfCapture();
    await dismiss(DISMISS_PARTIAL);
    const attachments = await driveNotificationPdfEnvelope(ctx);
    expect(attachments).toHaveLength(1);
    const calls = capturedReportPdfCalls();
    expect(calls).toHaveLength(1);
    const call = calls[0] as { reportData: { summary: { totalIssues: number } } };
    // D-19: no new PDF section — the data has exactly the keys a zero-dismissal run has.
    expect(Object.keys(call.reportData).sort()).toEqual(Object.keys(before.reportData).sort());
    const text = JSON.stringify(call);
    assertDismissedAbsent(text, 'partial');
    assertSiblingPresent(text);
    expect(call.reportData.summary.totalIssues).toBe(AFTER_PARTIAL.total);
  });

  it('email CSV attachment omits a dismissed finding', async () => {
    await dismiss(DISMISS_PARTIAL);
    const attachments = await driveEmailCsv(ctx);
    expect(attachments).toHaveLength(1);
    const csv = attachments[0]!.content;
    assertDismissedAbsent(csv, 'partial');
    assertSiblingPresent(csv);
    // Header row unchanged (P2: no reason/actor column), one data row per surviving occurrence.
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Severity,WCAG Criterion,WCAG Title,Message,Selector,Page URL,Regulations,Component');
    expect(lines.length - 1).toBe(AFTER_PARTIAL.total);
  });

  it('email CSV attachment is withheld, never sent unfiltered, when the dismissal lookup fails', async () => {
    await dismiss(DISMISS_PARTIAL);
    const scan = await ctx.storage.scans.getScan(ctx.scanId);
    const failing = {
      issueDismissals: {
        listActiveForSite: async () => {
          throw new Error('lookup unavailable');
        },
      },
    } as unknown as StorageAdapter;
    const csv = await generateIssuesCsv(scan!, scan!.jsonReportPath!, failing);
    expect(csv).toBeNull();
  });
});
