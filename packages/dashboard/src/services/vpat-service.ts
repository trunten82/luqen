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
import type { VpatIdentity } from './vpat-identity.js';
import { deriveLegalFramings, type LegalFraming, type EvaluatedStandard } from './legal-framings.js';
import type { RegulationDetail } from './regulation-catalog.js';
import type { RemediationRecord } from './remediation-service.js';
import { computeEngineCorroboration, type normalizeReportData } from './report-service.js';

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

/**
 * Evaluation methodology + attestation metadata. Gives the ACR documentary
 * weight: WHO/WHAT/WHEN/HOW the evaluation was performed and the standards it
 * was assessed against. Framed as a good-faith evaluation as of a date — never
 * a certification (over-claiming is the liability).
 */
export interface VpatAttestation {
  readonly evaluationDate: string;
  readonly pagesEvaluated: number;
  readonly methods: readonly string[];
  readonly standardsLabel: string;
  readonly manualTestingRecorded: boolean;
  /** Optional evaluator/organisation name; omitted when unknown. */
  readonly evaluator?: string;
  /**
   * Count of manual-test verdict changes recorded WITH a documented reason.
   * Surfaced as evidence of an ongoing, reasoned testing process. Omitted (0)
   * when none.
   */
  readonly reasonedChangeCount?: number;
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
   * Jurisdiction-driven legal framing blocks, derived from the scan's selected
   * jurisdictions/regulations — NOT a hardcoded US frame. Render in order.
   */
  readonly legalFramings: readonly LegalFraming[];
  /**
   * Explicit enumeration of every selected regulation by full name (e.g.
   * "Americans with Disabilities Act"), in selection order. Drives the
   * "Standards & laws evaluated against" section so the report states coverage
   * explicitly. Empty when no regulations were selected.
   */
  readonly evaluatedStandards: readonly EvaluatedStandard[];
  /**
   * Whether the Functional Performance table applies (Section 508 §302 or
   * EN 301 549 clause 4). When false, no FPC table is shown.
   */
  readonly includeFunctionalPerformance: boolean;
  /** Heading for the Functional Performance table when included. */
  readonly functionalPerformanceHeading: string;
  /**
   * Dated good-faith remediation record (AI-proposed fixes, developer
   * verifications, scan trend). Null when no remediation data was supplied.
   */
  readonly remediation: RemediationRecord | null;
  /** Evaluation methodology + attestation (documentary weight). */
  readonly attestation: VpatAttestation;
  /**
   * Per-org legal/company identity (entity name, contact, address, preparer,
   * logo). Null when the org has set none — the report then renders with the
   * generic title and no company block (backward-compatible). Attribution only;
   * never a conformance claim.
   */
  readonly identity?: VpatIdentity;
}

export interface BuildVpatOptions {
  /** ISO date string (YYYY-MM-DD). Injectable for deterministic tests. */
  readonly generatedAt?: string;
  /** Optional evaluator/organisation name to record in the attestation. */
  readonly evaluator?: string;
  /**
   * Per-criterion manual-test evidence counts (criterion id → number of
   * uploaded evidence files). When a criterion has ≥1 evidence file, the count
   * is appended to its VPAT remark as a defensibility signal ("N evidence files
   * on record"). Slice C.
   */
  readonly evidenceCounts?: ReadonlyMap<string, number>;
  /**
   * Count of manual-test verdict changes recorded WITH a documented reason
   * (from the verdict audit trail). Surfaced in the attestation as evidence of
   * an ongoing, reasoned testing process.
   */
  readonly reasonedChangeCount?: number;
  /**
   * Resolved per-org report identity. When present, its `preparedBy` populates
   * the attestation evaluator (taking precedence over `evaluator`), and the
   * full block is attached to the report for the header/company rendering.
   */
  readonly identity?: VpatIdentity;
  /**
   * C#2 (Phase 84) — WCAG criteria that an LLM-vision behavioral pass actually
   * evaluated and found clean during this scan (e.g. 1.3.1 heading-semantics,
   * 1.1.1 alt-text). For such a criterion with NO findings and no manual
   * verdict, the conformance is elevated from "Not Evaluated" to "Supports"
   * with a transparent method note — a clean *behavioral* evaluation of the
   * rendered page is a substantive assessment, unlike a bare static scan. A
   * behavioral pass NEVER hides a finding or a manual fail (those are decided
   * earlier in deriveRow). Empty/absent by default → no change to conformance.
   */
  readonly behaviorallyEvaluatedCriteria?: ReadonlySet<string>;
  /**
   * Live regulation token → full record map resolved from the compliance
   * service (name, citation, description, enforcement date, url). Drives the
   * programmatic per-regulation context notes in the "Standards & laws evaluated
   * against" section, for every selected regulation. Absent/empty → the section
   * falls back to the built-in name catalog (name + token only, no description).
   */
  readonly regulationDetails?: ReadonlyMap<string, RegulationDetail>;
}

/** Minimal shape of the scan record needed to build a VPAT. */
export interface VpatScanInput {
  readonly siteUrl: string;
  readonly standard: string;
  /** Selected jurisdiction tokens — drive the report's legal framing. */
  readonly jurisdictions?: readonly string[];
  /** Selected regulation tokens — drive the report's legal framing. */
  readonly regulations?: readonly string[];
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

/** Append a manual-test evidence-count note to a VPAT remark (Slice C). */
function appendEvidenceNote(remarks: string, count: number): string {
  const note = `${pluralise(count, 'evidence file')} on record`;
  return remarks ? `${remarks} — ${note}` : note;
}

/**
 * Derives the conformance verdict + remark for a single catalog criterion.
 */
function deriveRow(
  entry: WcagCatalogEntry,
  groupsByCriterion: ReadonlyMap<string, IssueGroup>,
  manualByCriterion: ReadonlyMap<string, ManualTestResult>,
  requiresManual: ReadonlySet<string>,
  behaviorallyEvaluated: ReadonlySet<string>,
): VpatRow {
  const base = {
    criterion: entry.criterion,
    title: entry.title,
    level: entry.level,
    version: entry.version,
    url: entry.url,
  };

  const manual = manualByCriterion.get(entry.criterion);
  const group = groupsByCriterion.get(entry.criterion);

  // Legally-defensible reconciliation of a human manual verdict with automated
  // findings: never hide a failure or over-claim, but honour genuine human
  // judgement transparently.
  //   - Manual N/A / Fail always win (a human determination is authoritative
  //     for inapplicability and for failures).
  //   - A hard automated ERROR is never overridden by a manual Pass (a tool-
  //     detected definite failure must not be hidden).
  //   - A manual Pass elevates lower-confidence automated findings (warnings /
  //     notices — the human-judgement items) to Supports, while transparently
  //     noting what the scan flagged.

  // 1. Manual "not applicable" wins outright.
  if (manual?.status === 'na') {
    return { ...base, conformance: 'Not Applicable', remarks: 'Marked not applicable during manual testing' };
  }

  // 2. Manual "fail" wins — never hide a human-found failure.
  if (manual?.status === 'fail') {
    const remarks = group !== undefined
      ? withRegulations(
          `Failed manual testing; automated scan also flagged ${pluralise(group.warningCount + group.noticeCount + group.errorCount, 'issue')} across ${pluralise(group.pageCount, 'page')}`,
          group,
        )
      : 'Failed manual testing';
    return { ...base, conformance: 'Does Not Support', remarks };
  }

  // 3. Hard automated errors → Does Not Support, never overridden by a manual
  //    Pass (don't hide a definite, tool-detected failure).
  if (group !== undefined && group.errorCount > 0) {
    const errText = `${pluralise(group.errorCount, 'error')} across ${pluralise(group.pageCount, 'page')}`;
    const remarks = withRegulations(
      manual?.status === 'pass' ? `${errText}; manual testing recorded Pass — review` : errText,
      group,
    );
    return { ...base, conformance: 'Does Not Support', remarks };
  }

  // 4. Manual "pass" — human judgement elevates the criterion to Supports,
  //    transparently noting any automated warnings/notices.
  if (manual?.status === 'pass') {
    if (group !== undefined && (group.warningCount > 0 || group.noticeCount > 0)) {
      return {
        ...base,
        conformance: 'Supports',
        remarks: withRegulations(
          `Verified by manual testing; automated scan also flagged ${pluralise(group.warningCount, 'warning')}, ${pluralise(group.noticeCount, 'notice')} across ${pluralise(group.pageCount, 'page')}`,
          group,
        ),
      };
    }
    return { ...base, conformance: 'Supports', remarks: 'Verified by manual testing' };
  }

  // 5. No manual verdict — automated findings drive the verdict.
  if (group !== undefined) {
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
    // Group present but no findings (rare): only claim Supports when fully
    // machine-verifiable; otherwise it still needs human evaluation — UNLESS an
    // LLM-vision behavioral pass evaluated it clean (C#2).
    if (requiresManual.has(entry.criterion)) {
      if (behaviorallyEvaluated.has(entry.criterion)) {
        return { ...base, conformance: 'Supports', remarks: 'Evaluated by LLM-vision behavioral testing; no issues detected' };
      }
      return { ...base, conformance: 'Not Evaluated', remarks: 'Requires manual evaluation; automated testing alone cannot confirm conformance' };
    }
    return { ...base, conformance: 'Supports', remarks: 'No outstanding issues detected by automated scan' };
  }

  // 6. No automated findings and no manual verdict — conservative: a fully
  //    machine-verifiable criterion, OR one cleanly evaluated by an LLM-vision
  //    behavioral pass (C#2), can claim Supports on a clean scan.
  if (requiresManual.has(entry.criterion)) {
    if (behaviorallyEvaluated.has(entry.criterion)) {
      return { ...base, conformance: 'Supports', remarks: 'Evaluated by LLM-vision behavioral testing; no issues detected' };
    }
    return { ...base, conformance: 'Not Evaluated', remarks: 'Requires manual evaluation; automated testing alone cannot confirm conformance' };
  }
  return { ...base, conformance: 'Supports', remarks: 'No issues detected by automated testing for this machine-verifiable criterion' };
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
/** Friendly engine label for the attestation methods list. */
function labelRunner(runner: string): string {
  switch (runner) {
    case 'htmlcs': return 'HTML_CodeSniffer';
    case 'axe': return 'axe-core';
    case 'lighthouse': return 'Lighthouse';
    case 'ibm': return 'IBM Equal Access';
    case 'reflow': return 'reflow (zoom 400%)';
    case 'a11y-tree': return 'accessibility tree';
    case 'behavioral': return 'behavioral';
    default: return runner;
  }
}

export function buildVpat(
  reportData: NormalizedReportData,
  scan: VpatScanInput,
  manualResults: readonly ManualTestResult[] = [],
  opts: BuildVpatOptions = {},
  remediation: RemediationRecord | null = null,
): VpatReport {
  const level = levelFromStandard(scan.standard);
  const generatedAt = opts.generatedAt ?? new Date().toISOString().slice(0, 10);
  // Legal framing is driven by the scan's selected jurisdictions/regulations,
  // not a hardcoded US frame.
  const framing = deriveLegalFramings(scan.jurisdictions ?? [], scan.regulations ?? [], opts.regulationDetails);

  const groupsByCriterion = new Map<string, IssueGroup>();
  for (const g of reportData.allIssueGroups ?? []) {
    groupsByCriterion.set(g.criterion, g);
  }

  const manualByCriterion = new Map<string, ManualTestResult>();
  for (const m of manualResults) {
    manualByCriterion.set(m.criterionId, m);
  }

  const requiresManual = requiresManualJudgement();
  const behaviorallyEvaluated = opts.behaviorallyEvaluatedCriteria ?? new Set<string>();
  const evidenceCounts = opts.evidenceCounts;

  const rows: VpatRow[] = catalogForLevel(level)
    .map((entry) => {
      const row = deriveRow(entry, groupsByCriterion, manualByCriterion, requiresManual, behaviorallyEvaluated);
      const evidence = evidenceCounts?.get(entry.criterion) ?? 0;
      // Append the evidence count to the remark — a defensibility signal that
      // the manual verdict for this criterion is backed by uploaded artifacts.
      return evidence > 0
        ? { ...row, remarks: appendEvidenceNote(row.remarks, evidence) }
        : row;
    })
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

  // Attestation: what was actually done, conservatively described. Manual
  // testing is only claimed when at least one manual result was recorded.
  const manualTestingRecorded = manualResults.some((m) => m.status !== 'untested');
  const corro = computeEngineCorroboration(reportData.pages ?? []);
  const automatedEngines = corro.engines.filter((e) => e !== 'behavioral');
  const multiEngine = automatedEngines.length >= 2;
  const methods = [
    multiEngine
      ? `Automated testing with ${automatedEngines.length} independent engines (${automatedEngines.map(labelRunner).join(', ')})`
      : 'Automated testing (Pa11y / axe-core)',
    ...(multiEngine && corro.corroboratedFindings > 0
      ? [`${corro.corroboratedFindings} finding${corro.corroboratedFindings === 1 ? '' : 's'} independently flagged by 2 or more engines`]
      : []),
    'Behavioral checks (keyboard, focus, dynamic state) where enabled',
    ...(manualTestingRecorded ? ['Recorded manual testing with human review'] : []),
  ];
  const pagesEvaluated =
    (reportData.summary as { pagesScanned?: number } | undefined)?.pagesScanned ?? 0;
  const attestation: VpatAttestation = {
    evaluationDate: generatedAt,
    pagesEvaluated,
    methods,
    standardsLabel: framing.standardsLabel,
    manualTestingRecorded,
    // Prefer the identity's preparer org for the attestation evaluator; fall
    // back to the explicit `evaluator` option for older callers.
    ...(opts.identity?.preparedBy?.trim()
      ? { evaluator: opts.identity.preparedBy.trim() }
      : opts.evaluator?.trim()
        ? { evaluator: opts.evaluator.trim() }
        : {}),
    ...(opts.reasonedChangeCount && opts.reasonedChangeCount > 0
      ? { reasonedChangeCount: opts.reasonedChangeCount }
      : {}),
  };

  return {
    siteUrl: scan.siteUrl,
    standard: scan.standard,
    level,
    generatedAt,
    tablesByLevel,
    summary,
    section508: deriveSection508(rows),
    legalFramings: framing.framings,
    evaluatedStandards: framing.evaluatedStandards,
    includeFunctionalPerformance: framing.includeFunctionalPerformance,
    functionalPerformanceHeading: framing.functionalPerformanceHeading,
    remediation,
    attestation,
    ...(opts.identity ? { identity: opts.identity } : {}),
  };
}
