/**
 * Phase 88 golden baselines, scan orchestrator (D-16, D-20a, FP-13).
 *
 * With ZERO dismissals applying to the scanned site, both orchestrator paths
 * (standard and incremental) must persist and announce exactly what they did
 * BEFORE Phase 88 wired dismissals into the scan loop: the persisted columns,
 * the stored report summary, the completion event, the scan.completed webhook
 * and the scan.complete plugin payload. The baseline in
 * baseline/zero-dismissal-orchestrator.json was captured from unwired code by
 * running the REAL ScanOrchestrator; this file only compares. The fake
 * dismissal repository holds only foreign dismissals (another org on the same
 * site, the same org on another site), so a later org or site leak at scan end
 * turns these goldens red.
 *
 * Capture: GOLDEN_CAPTURE=1 (adds a missing surface, never overwrites one).
 */
import { describe, it, vi } from 'vitest';

process.env['TZ'] ??= 'UTC';

vi.mock('@luqen/core', async () => {
  const m = await import('./drivers/orchestrator-mocks.js');
  return { ...m.coreMocks };
});
vi.mock('../../src/compliance-client.js', async () => {
  const m = await import('./drivers/orchestrator-mocks.js');
  return { ...m.complianceMocks };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const m = await import('./drivers/orchestrator-mocks.js');
  return { ...actual, ...m.fsMocks };
});
vi.mock('../../src/notifications/dispatcher.js', async () => {
  const m = await import('./drivers/orchestrator-mocks.js');
  return { NotificationDispatcher: m.RecordingNotificationDispatcher };
});

import { goldenCheck } from './golden-io.js';
import { driveOrchestratorScan, foreignDismissalRows } from './drivers/orchestrator-driver.js';
import { surfaceReport } from '../helpers/dismissal-surface-fixture.js';

const FILE = 'zero-dismissal-orchestrator';

describe('zero-dismissal orchestrator goldens', () => {
  it('golden: orchestrator standard path persisted counts and payloads zero-dismissal output is unchanged', async () => {
    const output = await driveOrchestratorScan({
      path: 'standard',
      report: surfaceReport(),
      dismissals: foreignDismissalRows(),
    });
    goldenCheck(FILE, 'standard', output);
  });

  it('golden: orchestrator incremental path persisted counts and payloads zero-dismissal output is unchanged', async () => {
    const output = await driveOrchestratorScan({
      path: 'incremental',
      report: surfaceReport(),
      dismissals: foreignDismissalRows(),
    });
    goldenCheck(FILE, 'incremental', output);
  });
});
