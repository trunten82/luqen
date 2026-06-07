/**
 * Diff engine: compute new/fixed/unchanged finding sets and the gate decision.
 *
 * - D-06: Three sets — new (in scan, not baseline), fixed (in baseline, not scan),
 *         unchanged (in both), keyed by fingerprint
 * - D-07: Gate decision computed from these sets per --fail-on mode
 * - D-08: --min-severity scopes which types count (notices never gate)
 * - D-10: infraError sentinel forces exit 2 regardless of mode
 */

import type { BaselineFinding } from './baseline.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaselineDiff {
  readonly newFindings: BaselineFinding[];
  readonly fixedFindings: BaselineFinding[];
  readonly unchanged: BaselineFinding[];
}

// ---------------------------------------------------------------------------
// Severity ranking (D-08)
// ---------------------------------------------------------------------------

type SeverityLevel = 'error' | 'warning';

/** Returns true if the finding's type meets the minimum severity threshold. */
function meetsMinSeverity(
  type: BaselineFinding['type'],
  minSeverity: SeverityLevel,
): boolean {
  // Notices NEVER count toward the gate (D-08)
  if (type === 'notice') return false;
  if (minSeverity === 'error') return type === 'error';
  // minSeverity === 'warning': errors + warnings count
  return type === 'error' || type === 'warning';
}

// ---------------------------------------------------------------------------
// diffBaseline (D-06)
//
// Accepts already-fingerprinted BaselineFinding arrays.
// Uses Map/Set keyed on fingerprint for O(1) membership.
// Returns new immutable arrays (coding-style.md).
// ---------------------------------------------------------------------------

export function diffBaseline(
  baselineFindings: readonly BaselineFinding[],
  currentFindings: readonly BaselineFinding[],
): BaselineDiff {
  const baselineMap = new Map<string, BaselineFinding>(
    baselineFindings.map((f) => [f.fingerprint, f]),
  );
  const currentMap = new Map<string, BaselineFinding>(
    currentFindings.map((f) => [f.fingerprint, f]),
  );

  const newFindings: BaselineFinding[] = [];
  const fixedFindings: BaselineFinding[] = [];
  const unchanged: BaselineFinding[] = [];

  // Findings in current: new vs unchanged
  for (const [fp, finding] of currentMap) {
    if (baselineMap.has(fp)) {
      unchanged.push({ ...finding });
    } else {
      newFindings.push({ ...finding });
    }
  }

  // Findings in baseline but not current: fixed
  for (const [fp, finding] of baselineMap) {
    if (!currentMap.has(fp)) {
      fixedFindings.push({ ...finding });
    }
  }

  return { newFindings, fixedFindings, unchanged };
}

// ---------------------------------------------------------------------------
// computeGateExitCode (D-07, D-08, D-10)
//
// mode: 'new' | 'none' | 'all'
// diff: result from diffBaseline
// currentFindings: all findings from the current scan (used by 'all' mode)
// infraError: true when the baseline was unreadable or scan engine unavailable
// minSeverity: 'error' (default) | 'warning' — notices never gate
//
// Exit codes:
//   0 = gate passed
//   1 = gate failed (new/all condition met)
//   2 = infra error (never 0 — conservative, D-10)
// ---------------------------------------------------------------------------

export function computeGateExitCode(
  mode: string,
  diff: BaselineDiff,
  currentFindings: readonly BaselineFinding[],
  infraError: boolean,
  minSeverity: SeverityLevel = 'error',
): number {
  // D-10: infra error always returns 2, never a passing code
  if (infraError) return 2;

  if (mode === 'none') {
    return 0;
  }

  if (mode === 'all') {
    // Fail when any finding in the current scan meets the severity threshold,
    // regardless of whether it is new vs baseline
    const hasFailingFinding = currentFindings.some((f) =>
      meetsMinSeverity(f.type, minSeverity),
    );
    return hasFailingFinding ? 1 : 0;
  }

  // Default: mode === 'new' (also handles unknown modes conservatively)
  const gateRelevantNew = diff.newFindings.filter((f) =>
    meetsMinSeverity(f.type, minSeverity),
  );
  return gateRelevantNew.length > 0 ? 1 : 0;
}
