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
