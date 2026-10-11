/**
 * Shared mock state for the orchestrator goldens (Phase 88, Plan 16).
 *
 * vi.mock factories are per test file and run while the orchestrator's own
 * imports resolve, so they cannot import the driver (which imports the
 * orchestrator). The mock objects live here instead, in a module with no
 * dependency on the orchestrator. The golden test file's vi.mock() factories
 * hand these out; the driver configures and reads them.
 */
import { vi } from 'vitest';

/** The surface of '@luqen/core' the orchestrator's runScan touches. */
export const coreMocks = {
  createScanner: vi.fn(),
  discoverUrls: vi.fn(),
  scanUrls: vi.fn(),
  WebserviceClient: vi.fn(),
  WebservicePool: vi.fn(),
  DirectScanner: vi.fn(),
  computeContentHashes: vi.fn(),
};

/** compliance-client.js: the checker call and the scan.completed webhook. */
export const complianceMocks = {
  checkCompliance: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
};

/** node:fs/promises: the best-effort report write must touch no disk. */
export const fsMocks = {
  writeFile: vi.fn(),
  mkdir: vi.fn(),
};

export interface RecordedPluginDispatch {
  readonly type: string;
  readonly orgId: string;
  readonly data: unknown;
}

const dispatched: RecordedPluginDispatch[] = [];

export function recordedPluginDispatches(): readonly RecordedPluginDispatch[] {
  return dispatched.map((d) => JSON.parse(JSON.stringify(d)) as RecordedPluginDispatch);
}

/**
 * Stand-in for NotificationDispatcher: the orchestrator builds one per
 * notifyPlugins() call and calls dispatch(event, orgId). Recording the event
 * (without its timestamp) is the observable "scan.complete plugin payload".
 */
export class RecordingNotificationDispatcher {
  async dispatch(
    event: { readonly type: string; readonly data: unknown },
    orgId: string,
  ): Promise<readonly unknown[]> {
    dispatched.push({ type: event.type, orgId, data: event.data });
    return [];
  }
}

export function resetOrchestratorMocks(): void {
  for (const group of [coreMocks, complianceMocks, fsMocks]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
  fsMocks.writeFile.mockResolvedValue(undefined);
  fsMocks.mkdir.mockResolvedValue(undefined);
  complianceMocks.dispatchWebhookEvent.mockResolvedValue(undefined);
  dispatched.length = 0;
}
