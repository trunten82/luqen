/**
 * VPAT / ACR (Accessibility Conformance Report) derivation.
 *
 * Pure, side-effect-free module: given normalized report data, a scan record,
 * and any recorded manual test results, it derives a per-WCAG-criterion
 * conformance table following the standard VPAT conformance vocabulary
 * (Supports / Partially Supports / Does Not Support / Not Applicable /
 * Not Evaluated).
 *
 * No fs, no Fastify, no I/O — so it unit-tests cleanly and deterministically.
 */

import {
  catalogForLevel,
  levelFromStandard,
  type WcagLevel,
  type WcagCatalogEntry,
} from '../wcag-catalog.js';
import { MANUAL_CRITERIA, type ManualTestResult } from '../manual-criteria.js';
import { deriveSection508, type Section508Report } from './section508.js';
import type { RemediationRecord } from './remediation-service.js';
import type { normalizeReportData } from './report-service.js';

/**
 * normalizeReportData returns an inferred type (no named export). We derive the
 * shapes we depend on from its return type so this module stays in lock-step
 * with report-service without report-service needing to export extra symbols.
 */
type NormalizedReportData = ReturnType<typeof normalizeReportData>;
type IssueGroup = NormalizedReportData['allIssueGroups'][number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VpatConformance =
  | 'Supports'
  | 'Partially Supports'
  | 'Does Not Support'
  | 'Not Applicable'
  | 'Not Evaluated';

export interface VpatRow {
  readonly criterion: string;
  readonly title: string;
  readonly level: WcagLevel;
  readonly version: string;
  readonly url: string;
  readonly conformance: VpatConformance;
  readonly remarks: string;
}

export interface VpatLevelTable {
  readonly level: WcagLevel;
  readonly rows: readonly VpatRow[];
}

export interface VpatSummary {
  readonly supports: number;
  readonly partial: number;
  readonly doesNotSupport: number;
  readonly notApplicable: number;
  readonly notEvaluated: number;
  readonly total: number;
}

export interface VpatReport {
  readonly siteUrl: string;
  readonly standard: string;
  readonly level: WcagLevel;
  readonly generatedAt: string;
  readonly tablesByLevel: readonly VpatLevelTable[];
  readonly summary: VpatSummary;
  /**
   * Revised Section 508 framing (Functional Performance Criteria, §302),
   * derived conservatively from the WCAG rows. US lawsuit-protection context.
   */
  readonly section508: Section508Report;
  /**
   * Dated good-faith remediation record (AI-proposed fixes, developer
   * verifications, scan trend). Null when no remediation data was supplied.
   */
  readonly remediation: RemediationRecord | null;
}

export interface BuildVpatOptions {
  /** ISO date string (YYYY-MM-DD). Injectable for deterministic tests. */
  readonly generatedAt?: string;
  /** Optional evaluator/organisation name to record in the attestation. */
  readonly evaluator?: string;
}

/** Minimal shape of the scan record needed to build a VPAT. */
export interface VpatScanInput {
  readonly siteUrl: string;
  readonly standard: string;
}

// ---------------------------------------------------------------------------
// Internal helpers (pure)
// ---------------------------------------------------------------------------

const LEVEL_ORDER: readonly WcagLevel[] = ['A', 'AA', 'AAA'];

/**
 * Set of criterion ids that require human judgement — i.e. automation CANNOT
 * fully confirm conformance on its own. This is deliberately BOTH `'none'`
 * (automation catches nothing) AND `'partial'` (automation catches some but
 * not all) criteria.
 *
 * LEGAL DEFENSIBILITY (do not narrow to 'none' only): a clean automated scan
 * on a `'partial'` criterion does NOT prove support. e.g. 1.1.1 — Pa11y can
 * see whether an `alt` attribute exists, but not whether the text is
 * meaningful; 1.3.1 — it sees some structure, not all. Marking those
 * "Supports" purely because the scanner found nothing is the exact
 * over-claim that turns an ACR into a liability (FTC accessiBe action,
 * plaintiff use of inflated reports). So absence-of-findings on any
 * manual-judgement criterion yields "Not Evaluated", never "Supports",
 * unless a human recorded a manual pass.
 */
function requiresManualJudgement(): ReadonlySet<string> {
  return new Set(
    MANUAL_CRITERIA
      .filter((c) => c.automatable === 'none' || c.automatable === 'partial')
      .map((c) => c.id),
  );
}

/** Numeric-aware comparator for dotted WCAG criterion numbers (e.g. "1.4.10" > "1.4.2"). */
function compareCriteria(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10));
  const pb = b.split('.').map((n) => Number.parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** Append a regulation-shortName suffix to a remark when present. */
function withRegulations(base: string, group: IssueGroup): string {
  const names = (group.regulations ?? [])
    .map((r: { shortName?: string }) => r.shortName)
    .filter((s: string | undefined): s is string => typeof s === 'string' && s.length > 0);
  if (names.length === 0) return base;
  return `${base} — regulations: ${names.join(', ')}`;
}

function pluralise(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/**
 * Derives the conformance verdict + remark for a single catalog criterion.
 */
function deriveRow(
  entry: WcagCatalogEntry,
  groupsByCriterion: ReadonlyMap<string, IssueGroup>,
  manualByCriterion: ReadonlyMap<string, ManualTestResult>,
  requiresManual: ReadonlySet<string>,
): VpatRow {
  const base = {
    criterion: entry.criterion,
    title: entry.title,
    level: entry.level,
    version: entry.version,
    url: entry.url,
  };

  const manual = manualByCriterion.get(entry.criterion);

  // 1. Explicit "not applicable" from manual testing wins outright.
  if (manual?.status === 'na') {
    return {
      ...base,
      conformance: 'Not Applicable',
      remarks: 'Marked not applicable during manual testing',
    };
  }

  // 2. Automated findings for this criterion.
  const group = groupsByCriterion.get(entry.criterion);
  if (group !== undefined) {
    if (group.errorCount > 0) {
      return {
        ...base,
        conformance: 'Does Not Support',
        remarks: withRegulations(
          `${pluralise(group.errorCount, 'error')} across ${pluralise(group.pageCount, 'page')}`,
          group,
        ),
      };
    }
    if (group.warningCount > 0 || group.noticeCount > 0) {
      return {
        ...base,
        conformance: 'Partially Supports',
        remarks: withRegulations(
          `${pluralise(group.warningCount, 'warning')}, ${pluralise(group.noticeCount, 'notice')} across ${pluralise(group.pageCount, 'page')}`,
          group,
        ),
      };
    }
    // Group present but no error/warning/notice (rare). Still apply the
    // conservative rule: only claim Supports for fully-automatable criteria.
    if (requiresManual.has(entry.criterion)) {
      return {
        ...base,
        conformance: 'Not Evaluated',
        remarks: 'Requires manual evaluation; automated testing alone cannot confirm conformance',
      };
    }
    return {
      ...base,
      conformance: 'Supports',
      remarks: 'No outstanding issues detected by automated scan',
    };
  }

  // 3. Criterion absent from automated findings. A recorded manual result is
  //    the strongest signal; otherwise fall back to the conservative rule.
  if (manual?.status === 'pass') {
    return { ...base, conformance: 'Supports', remarks: 'Verified by manual testing' };
  }
  if (manual?.status === 'fail') {
    return { ...base, conformance: 'Does Not Support', remarks: 'Failed manual testing' };
  }
  // CONSERVATIVE: absence of automated findings only proves Support when the
  // criterion is FULLY machine-verifiable. For any criterion needing human
  // judgement (automatable 'partial' or 'none'), a clean scan is inconclusive
  // → Not Evaluated, pending manual testing. Never silently upgrade to Supports.
  if (requiresManual.has(entry.criterion)) {
    return {
      ...base,
      conformance: 'Not Evaluated',
      remarks: 'Requires manual evaluation; automated testing alone cannot confirm conformance',
    };
  }
  return {
    ...base,
    conformance: 'Supports',
    remarks: 'No issues detected by automated testing for this machine-verifiable criterion',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a VPAT / ACR from normalized report data + manual test results.
 *
 * The conformance level ceiling is taken from `scan.standard`; only criteria
 * at or below that level are included. Rows are grouped into per-level tables
 * (A, then AA, then AAA) in ascending criterion order.
 */
export function buildVpat(
  reportData: NormalizedReportData,
  scan: VpatScanInput,
  manualResults: readonly ManualTestResult[] = [],
  opts: BuildVpatOptions = {},
  remediation: RemediationRecord | null = null,
): VpatReport {
  const level = levelFromStandard(scan.standard);
  const generatedAt = opts.generatedAt ?? new Date().toISOString().slice(0, 10);

  const groupsByCriterion = new Map<string, IssueGroup>();
  for (const g of reportData.allIssueGroups ?? []) {
    groupsByCriterion.set(g.criterion, g);
  }

  const manualByCriterion = new Map<string, ManualTestResult>();
  for (const m of manualResults) {
    manualByCriterion.set(m.criterionId, m);
  }

  const requiresManual = requiresManualJudgement();

  const rows: VpatRow[] = catalogForLevel(level)
    .map((entry) =>
      deriveRow(entry, groupsByCriterion, manualByCriterion, requiresManual),
    )
    .sort((a, b) => compareCriteria(a.criterion, b.criterion));

  // Group into per-level tables, preserving criterion order within each.
  const tablesByLevel: VpatLevelTable[] = LEVEL_ORDER
    .map((lvl) => ({ level: lvl, rows: rows.filter((r) => r.level === lvl) }))
    .filter((tbl) => tbl.rows.length > 0);

  const summary: VpatSummary = {
    supports: rows.filter((r) => r.conformance === 'Supports').length,
    partial: rows.filter((r) => r.conformance === 'Partially Supports').length,
    doesNotSupport: rows.filter((r) => r.conformance === 'Does Not Support').length,
    notApplicable: rows.filter((r) => r.conformance === 'Not Applicable').length,
    notEvaluated: rows.filter((r) => r.conformance === 'Not Evaluated').length,
    total: rows.length,
  };

  return {
    siteUrl: scan.siteUrl,
    standard: scan.standard,
    level,
    generatedAt,
    tablesByLevel,
    summary,
    section508: deriveSection508(rows),
    remediation,
  };
}
