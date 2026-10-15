/**
 * Scan lifecycle — starting a stored scan row again, and cancelling one.
 *
 * ScanService delegates here; the functions take their collaborators as
 * arguments (storage, orchestrator, start-URL check, start budget) so the
 * decision order is testable without a server. Every refusal is a returned
 * value, never a throw.
 *
 * This file and services/scan-service.ts are where scans are handed to the
 * orchestrator: a stored row is only ever started through
 * {@link startStoredScan}, which validates the stored start URL first.
 */
import type { StorageAdapter } from '../db/index.js';
import type { ScanRecord } from '../db/types.js';
import type { DashboardConfig } from '../config.js';
import type { AuthUser } from '../auth/middleware.js';
import type { ScanConfig, ScanOrchestrator } from '../scanner/orchestrator.js';
import { mayTouchDismissalOrg } from './issue-dismissals/scan-access.js';
import type { ScanStartSubject, UrlValidation } from './scan-service.js';

/** Permission a caller needs to start, retry or cancel a scan. */
export const SCAN_CREATE_PERMISSION = 'scans.create';

/** Why a retry or cancel was refused; routes map each kind to one status. */
export type ScanControlRefusalKind =
  | 'forbidden'
  | 'not_found'
  | 'invalid_state'
  | 'url_refused'
  | 'rate_limited';

export interface ScanControlRefusal {
  readonly ok: false;
  readonly kind: ScanControlRefusalKind;
  readonly error: string;
  /** Set with kind 'rate_limited': whole seconds until a start is allowed again. */
  readonly retryAfterSeconds?: number;
}

export type ScanControlResult = { readonly ok: true; readonly scan: ScanRecord } | ScanControlRefusal;

/** Who is asking to control a scan, as resolved by the route. */
export interface ScanControlCaller {
  readonly permissions: ReadonlySet<string>;
  readonly user: AuthUser | undefined;
  readonly startSubject: ScanStartSubject;
}

/** A refused start budget: what the shared scan-start limiter answered. */
export interface StartBudgetRefusal {
  readonly error: string;
  readonly retryAfterSeconds: number;
}

export interface ScanLifecycleDeps {
  readonly storage: StorageAdapter;
  readonly orchestrator: Pick<ScanOrchestrator, 'startScan'>;
  readonly config: DashboardConfig;
  readonly validateStartUrl: (raw: string) => Promise<UrlValidation>;
  /** Check-and-spend one start from the shared limiter; undefined means spent. */
  readonly spendStartBudget: (subject: ScanStartSubject) => StartBudgetRefusal | undefined;
}

const NOT_FOUND = 'Scan not found';

/**
 * May this caller restart or cancel a scan owned by `scanOrgId`? This IS the
 * write-side organization predicate of the issue-dismissal feature, under a
 * second name: delegated, never copied, so the two cannot drift apart.
 */
export function mayControlScan(user: AuthUser | undefined, scanOrgId: string): boolean {
  return mayTouchDismissalOrg(user, scanOrgId);
}

/**
 * The orchestrator config for starting a stored row. One builder for every
 * stored-row start, so a retry and a recovery start carry the same fields.
 */
export function configFromRow(
  scan: ScanRecord,
  config: DashboardConfig,
  overrides: Partial<ScanConfig> = {},
): ScanConfig {
  return {
    siteUrl: scan.siteUrl,
    standard: scan.standard,
    concurrency: config.maxConcurrentScans,
    jurisdictions: scan.jurisdictions,
    regulations: scan.regulations ?? [],
    ...(config.webserviceUrl !== undefined ? { webserviceUrl: config.webserviceUrl } : {}),
    ...(config.webserviceUrls !== undefined && config.webserviceUrls.length > 0
      ? { webserviceUrls: config.webserviceUrls }
      : {}),
    complianceUrl: config.complianceUrl,
    orgId: scan.orgId,
    ...overrides,
  };
}

function refuse(kind: ScanControlRefusalKind, error: string): ScanControlRefusal {
  return { ok: false, kind, error };
}

/**
 * Start a stored row: validate its start URL first. A refused URL marks the
 * row failed with the refusal text and nothing is started.
 */
export async function startStoredScan(
  deps: ScanLifecycleDeps,
  scan: ScanRecord,
  overrides: Partial<ScanConfig> = {},
): Promise<ScanControlResult> {
  const verdict = await deps.validateStartUrl(scan.siteUrl);
  if ('error' in verdict) {
    await deps.storage.scans.updateScan(scan.id, {
      status: 'failed',
      error: verdict.error,
      completedAt: new Date().toISOString(),
    });
    return refuse('url_refused', verdict.error);
  }
  await deps.storage.scans.updateScan(scan.id, { status: 'queued' });
  deps.orchestrator.startScan(scan.id, configFromRow(scan, deps.config, overrides));
  return { ok: true, scan };
}

/** Load a scan the caller may control, or the refusal that applies. */
async function loadControllable(
  deps: ScanLifecycleDeps,
  scanId: string,
  caller: ScanControlCaller,
): Promise<{ readonly scan: ScanRecord } | ScanControlRefusal> {
  if (!caller.permissions.has(SCAN_CREATE_PERMISSION)) {
    return refuse('forbidden', `Forbidden: requires ${SCAN_CREATE_PERMISSION}`);
  }
  const scan = await deps.storage.scans.getScan(scanId);
  if (scan === null || !mayControlScan(caller.user, scan.orgId)) {
    return refuse('not_found', NOT_FOUND);
  }
  return { scan };
}

/**
 * Retry a queued or failed scan. Order: permission, organization, status,
 * the shared start budget, then the start-URL check and the start.
 */
export async function retryScan(
  deps: ScanLifecycleDeps,
  scanId: string,
  caller: ScanControlCaller,
): Promise<ScanControlResult> {
  const loaded = await loadControllable(deps, scanId, caller);
  if ('ok' in loaded) return loaded;
  const { scan } = loaded;
  if (scan.status !== 'queued' && scan.status !== 'failed') {
    return refuse('invalid_state', 'Only queued or failed scans can be retried');
  }
  const budget = deps.spendStartBudget(caller.startSubject);
  if (budget !== undefined) {
    return { ok: false, kind: 'rate_limited', ...budget };
  }
  return startStoredScan(deps, scan);
}
