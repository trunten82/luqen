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
const NOT_RETRYABLE = 'Only queued or failed scans can be retried';

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

/** A stored start that was neither made nor refused: the lookup was unavailable and the row stays as it is. */
interface DeferredStart {
  readonly ok: false;
  readonly kind: 'deferred';
  readonly error: string;
}

/**
 * Validate a stored row's start URL, then start it. With `deferOnTransient`, a
 * resolver failure that may pass (timeout, temporary failure) returns a
 * {@link DeferredStart} and writes nothing; without it that failure is a
 * refusal like any other.
 *
 * The check awaits DNS, so the row can change meanwhile (a cancel, another
 * retry). The row is read again right after the check and acted on only while
 * it is still in the state it was read in; otherwise nothing is written or
 * started and the not-retryable refusal is returned.
 */
async function validateAndStart(
  deps: ScanLifecycleDeps,
  scan: ScanRecord,
  overrides: Partial<ScanConfig>,
  refusalPrefix: string,
  deferOnTransient: boolean,
): Promise<ScanControlResult | DeferredStart> {
  const verdict = await deps.validateStartUrl(scan.siteUrl);
  const current = await deps.storage.scans.getScan(scan.id);
  if (current === null || current.status !== scan.status) {
    return refuse('invalid_state', NOT_RETRYABLE);
  }
  if ('error' in verdict) {
    if (deferOnTransient && verdict.transient === true) {
      return { ok: false, kind: 'deferred', error: verdict.error };
    }
    await deps.storage.scans.updateScan(scan.id, {
      status: 'failed',
      error: `${refusalPrefix}${verdict.error}`,
      completedAt: new Date().toISOString(),
    });
    return refuse('url_refused', verdict.error);
  }
  await deps.storage.scans.updateScan(scan.id, { status: 'queued' });
  deps.orchestrator.startScan(scan.id, configFromRow(scan, deps.config, overrides));
  return { ok: true, scan };
}

/**
 * Start a stored row: validate its start URL first. A refused URL marks the
 * row failed with the refusal text and nothing is started.
 */
export async function startStoredScan(
  deps: ScanLifecycleDeps,
  scan: ScanRecord,
  overrides: Partial<ScanConfig> = {},
  refusalPrefix = '',
): Promise<ScanControlResult> {
  const outcome = await validateAndStart(deps, scan, overrides, refusalPrefix, false);
  return outcome.ok || outcome.kind !== 'deferred' ? outcome : refuse('url_refused', outcome.error);
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
    return refuse('invalid_state', NOT_RETRYABLE);
  }
  const budget = deps.spendStartBudget(caller.startSubject);
  if (budget !== undefined) {
    return { ok: false, kind: 'rate_limited', ...budget };
  }
  return startStoredScan(deps, scan);
}

/**
 * Cancel a queued or running scan. Same permission and organization checks as
 * retry; no start budget (nothing starts) and no URL check.
 */
export async function cancelScan(
  deps: ScanLifecycleDeps,
  scanId: string,
  caller: ScanControlCaller,
): Promise<ScanControlResult> {
  const loaded = await loadControllable(deps, scanId, caller);
  if ('ok' in loaded) return loaded;
  const { scan } = loaded;
  if (scan.status !== 'queued' && scan.status !== 'running') {
    return refuse('invalid_state', 'Only queued or running scans can be cancelled');
  }
  await deps.storage.scans.updateScan(scan.id, {
    status: 'failed',
    error: 'Cancelled by user',
    completedAt: new Date().toISOString(),
  });
  return { ok: true, scan };
}

/** What startup recovery did: how many rows it restarted, which it refused, which it left queued, and which checks threw. */
export interface RecoveryResult {
  readonly restarted: number;
  /** Ids of rows marked failed instead of restarted (includes the ones whose check threw). */
  readonly refused: readonly string[];
  /** Ids of rows left queued and not started because the host lookup was unavailable (timeout, temporary failure). */
  readonly deferred: readonly string[];
  /** Rows whose check, start or failure write threw: the id and the error's name, never its message or a URL. */
  readonly errors: readonly { readonly id: string; readonly name: string }[];
}

const NOT_RESTARTED = 'Not restarted: ';
const RECOVERY_START_FAILED = 'the start could not be completed.';

/** How many stored rows recovery checks and starts at the same time. */
export const RECOVERY_CONCURRENCY = 5;

type RecoveryOutcome =
  | { readonly kind: 'restarted' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'deferred' }
  | { readonly kind: 'threw'; readonly name: string; readonly marked: boolean; readonly writeError?: string };

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'Error';
}

/** Check and start one queued row; every failure becomes a returned outcome, never a throw. */
async function recoverOne(deps: ScanLifecycleDeps, scan: ScanRecord): Promise<RecoveryOutcome> {
  try {
    const outcome = await validateAndStart(deps, scan, {}, NOT_RESTARTED, true);
    if (outcome.ok) return { kind: 'restarted' };
    return { kind: outcome.kind === 'deferred' ? 'deferred' : 'refused' };
  } catch (err) {
    const name = errorName(err);
    try {
      await deps.storage.scans.updateScan(scan.id, {
        status: 'failed',
        error: `${NOT_RESTARTED}${RECOVERY_START_FAILED}`,
        completedAt: new Date().toISOString(),
      });
      return { kind: 'threw', name, marked: true };
    } catch (writeErr) {
      return { kind: 'threw', name, marked: false, writeError: errorName(writeErr) };
    }
  }
}

/** Run `work` over `items` with at most `limit` in flight; results keep the input order. */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Restart the rows a previous process left queued, but only those whose stored
 * start URL passes the shared start validation. A definitive refusal (private
 * target, unknown name, invalid URL) marks the row failed with a reason and
 * starts nothing. A lookup that is unavailable right now (timeout, temporary
 * failure) leaves the row queued and starts nothing. At most
 * {@link RECOVERY_CONCURRENCY} rows are checked at once. A row whose check or
 * start throws is failed closed and reported by error name only; a row whose
 * failure cannot be written is reported and the others carry on. No start
 * budget, no user, no reachability probe: validation only. Always returns the
 * counts.
 */
export async function recoverQueuedScans(deps: ScanLifecycleDeps): Promise<RecoveryResult> {
  const queued = await deps.storage.scans.listScans({ status: 'queued' });
  const outcomes = await mapWithLimit(queued, RECOVERY_CONCURRENCY, (scan) => recoverOne(deps, scan));
  let restarted = 0;
  const refused: string[] = [];
  const deferred: string[] = [];
  const errors: { id: string; name: string }[] = [];
  for (const [index, outcome] of outcomes.entries()) {
    const id = queued[index]!.id;
    switch (outcome.kind) {
      case 'restarted':
        restarted += 1;
        break;
      case 'refused':
        refused.push(id);
        break;
      case 'deferred':
        deferred.push(id);
        break;
      case 'threw':
        errors.push({ id, name: outcome.name });
        if (outcome.marked) {
          refused.push(id);
        } else {
          errors.push({ id, name: outcome.writeError ?? 'Error' });
        }
        break;
    }
  }
  return { restarted, refused, deferred, errors };
}
