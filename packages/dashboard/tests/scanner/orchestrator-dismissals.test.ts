/**
 * Phase 88, Plan 10: dismissals applied at scan end on BOTH orchestrator paths (FP-13, D-16, D-17).
 *
 * Everything runs through the REAL ScanOrchestrator loop (Plan 16's driver): the persisted
 * count columns and the three scan-end payloads (completion event, scan.completed webhook,
 * scan.complete plugin notification) exclude dismissed occurrences, while the stored
 * json_report stays RAW (D-01). Fabrikam's dismissal of DISMISS_PARTIAL removes three of the
 * five errors (1.4.3 keeps failing through the sibling).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@luqen/core', async () => {
  const m = await import('../golden/drivers/orchestrator-mocks.js');
  return { ...m.coreMocks };
});
vi.mock('../../src/compliance-client.js', async () => {
  const m = await import('../golden/drivers/orchestrator-mocks.js');
  return { ...m.complianceMocks };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const m = await import('../golden/drivers/orchestrator-mocks.js');
  return { ...actual, ...m.fsMocks };
});
vi.mock('../../src/notifications/dispatcher.js', async () => {
  const m = await import('../golden/drivers/orchestrator-mocks.js');
  return { NotificationDispatcher: m.RecordingNotificationDispatcher };
});

import {
  activeDismissalRow,
  driveOrchestratorScanDetailed,
  foreignDismissalRows,
  type DetailedOrchestratorOutput,
  type OrchestratorPath,
} from '../golden/drivers/orchestrator-driver.js';
import { DISMISS_PARTIAL, SEL_DISMISSED, surfaceReport } from '../helpers/dismissal-surface-fixture.js';

const FILTERED = { errors: 2, warnings: 2, notices: 1 };
const COUNT_KEYS = ['errors', 'warnings', 'notices'];

function plugin(output: DetailedOrchestratorOutput): { data: { issues: unknown } } {
  return output.plugin as { data: { issues: unknown } };
}
function webhookPayload(output: DetailedOrchestratorOutput): { issues: unknown } {
  return (output.webhook as { payload: { issues: unknown } }).payload;
}

/** Counts persisted AND announced: the columns and all three payloads, same keys as before. */
function expectFilteredEverywhere(output: DetailedOrchestratorOutput): void {
  expect(output.columns).toMatchObject({ ...FILTERED, totalIssues: 5 });
  const announced = [
    (output.completeEvent as { issues: unknown }).issues,
    webhookPayload(output).issues,
    plugin(output).data.issues,
  ];
  for (const issues of announced) {
    expect(issues).toEqual(FILTERED);
    expect(Object.keys(issues as object).sort()).toEqual([...COUNT_KEYS].sort());
  }
}

/** The stored report is the scanner's, untouched: raw byLevel and every raw occurrence. */
function expectStoredRaw(output: DetailedOrchestratorOutput): void {
  expect(output.storedSummary).toMatchObject({
    totalIssues: 8,
    byLevel: { error: 5, warning: 2, notice: 1 },
  });
  const stored = JSON.stringify(output.storedPages);
  expect(stored).toContain(SEL_DISMISSED);
  const dismissedOccurrences = (output.storedPages as Array<{ issues: Array<{ selector: string }> }>)
    .flatMap((p) => p.issues)
    .filter((i) => i.selector === SEL_DISMISSED);
  expect(dismissedOccurrences).toHaveLength(3);
}

async function drive(path: OrchestratorPath, extra: Record<string, unknown> = {}): Promise<DetailedOrchestratorOutput> {
  return driveOrchestratorScanDetailed({
    path,
    report: surfaceReport(),
    dismissals: [activeDismissalRow(DISMISS_PARTIAL), ...foreignDismissalRows()],
    ...extra,
  });
}

describe('scan-end dismissals: standard path', () => {
  it('standard path persists and announces counts without dismissed issues', async () => {
    expectFilteredEverywhere(await drive('standard'));
  });

  it('the stored report keeps raw counts and every raw occurrence (standard)', async () => {
    expectStoredRaw(await drive('standard'));
  });
});

describe('scan-end dismissals: incremental path', () => {
  it('incremental path persists and announces counts without dismissed issues', async () => {
    expectFilteredEverywhere(await drive('incremental'));
  });

  it('the stored report keeps raw counts and every raw occurrence (incremental)', async () => {
    expectStoredRaw(await drive('incremental'));
  });
});

describe('scan-end dismissals: a dismissal marked while compliance runs (W3)', () => {
  // The fake repository is EMPTY when the branch ends; the mocked checkCompliance adds the
  // dismissal. Only a read made after the compliance step can see it.
  const during = [activeDismissalRow(DISMISS_PARTIAL)];

  it('standard path applies a dismissal marked while compliance runs', async () => {
    const output = await driveOrchestratorScanDetailed({
      path: 'standard',
      report: surfaceReport(),
      dismissals: foreignDismissalRows(),
      dismissalsDuringCompliance: during,
    });
    expectFilteredEverywhere(output);
  });

  it('incremental path applies a dismissal marked while compliance runs', async () => {
    const output = await driveOrchestratorScanDetailed({
      path: 'incremental',
      report: surfaceReport(),
      dismissals: foreignDismissalRows(),
      dismissalsDuringCompliance: during,
    });
    expectFilteredEverywhere(output);
  });
});

describe('scan-end dismissals: a dismissal lookup failure never fails the scan (WR-03)', () => {
  const RAW = { errors: 5, warnings: 2, notices: 1, totalIssues: 8 };

  for (const path of ['standard', 'incremental'] as const) {
    it(`${path} path completes and persists the scanner's raw counts when the lookup throws`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const output = await driveOrchestratorScanDetailed({
          path,
          report: surfaceReport(),
          dismissals: [activeDismissalRow(DISMISS_PARTIAL)],
          dismissalLookupError: new TypeError('db is locked: SECRET-DETAIL-9f3'),
        });
        expect(output.columns).toMatchObject({ ...RAW, status: 'completed' });
        expect((output.completeEvent as { issues: unknown }).issues).toEqual({ errors: 5, warnings: 2, notices: 1 });
        const logged = JSON.stringify(warn.mock.calls);
        expect(logged).toContain('TypeError');
        expect(logged).toContain('dismissal');
        expect(logged).not.toContain('SECRET-DETAIL');
      } finally {
        warn.mockRestore();
      }
    });
  }
});

describe('scan-end dismissals: identity and the third path', () => {
  it("zero dismissals: persisted counts are the scanner's own byLevel even when it disagrees with the pages", async () => {
    // Foreign dismissals only: nothing applies to the scanned org + site. The scanner says
    // 7 errors while its pages hold 5; the scanner's number stays authoritative (D-16 / SC5).
    const output = await driveOrchestratorScanDetailed({
      path: 'standard',
      report: surfaceReport(),
      dismissals: foreignDismissalRows(),
      scannerByLevel: { error: 7, warning: 2, notice: 1 },
    });
    expect(output.columns).toMatchObject({ errors: 7, warnings: 2, notices: 1, totalIssues: 10 });
    expect((output.completeEvent as { issues: unknown }).issues).toEqual({ errors: 7, warnings: 2, notices: 1 });
  });

  it('core-unavailable path still persists zero counts', async () => {
    // A fresh module graph in which importing @luqen/core throws: runScan's .catch yields null.
    // The other mocks are re-registered so they hand out the SAME fresh orchestrator-mocks
    // instance the fresh driver reads (a factory result cached before the reset would not).
    vi.resetModules();
    vi.doMock('@luqen/core', () => {
      throw new Error('module not found');
    });
    vi.doMock('../../src/compliance-client.js', async () => {
      const m = await import('../golden/drivers/orchestrator-mocks.js');
      return { ...m.complianceMocks };
    });
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      const m = await import('../golden/drivers/orchestrator-mocks.js');
      return { ...actual, ...m.fsMocks };
    });
    vi.doMock('../../src/notifications/dispatcher.js', async () => {
      const m = await import('../golden/drivers/orchestrator-mocks.js');
      return { NotificationDispatcher: m.RecordingNotificationDispatcher };
    });
    try {
      const fresh = await import('../golden/drivers/orchestrator-driver.js');
      const output = await fresh.driveOrchestratorScanDetailed({
        path: 'standard',
        report: surfaceReport(),
        dismissals: [fresh.activeDismissalRow(DISMISS_PARTIAL)],
      });
      expect(output.columns).toMatchObject({ errors: 0, warnings: 0, notices: 0, totalIssues: 0 });
      expect((output.completeEvent as { issues: unknown }).issues).toEqual({ errors: 0, warnings: 0, notices: 0 });
    } finally {
      vi.doUnmock('@luqen/core');
      vi.resetModules();
      // Restore the file-level factories for any later test.
      vi.doMock('@luqen/core', async () => {
        const m = await import('../golden/drivers/orchestrator-mocks.js');
        return { ...m.coreMocks };
      });
    }
  });
});
