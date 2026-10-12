/**
 * filterComplianceForDismissals — read-time compliance / regulation matrix filter (D-08, FP-12).
 *
 * applyDismissals() deliberately leaves `compliance`, `complianceMatrix` and
 * `regulationMatrix` alone. This pure step brings them into line with the filtered
 * report, locally (no compliance-service call, D-03/D-08), from the codes that VANISHED:
 * a code is vanished when the raw report had it and the filtered report no longer does.
 *
 * Why codes, not occurrences: the orchestrator de-duplicates by code before the
 * remote call, so a violation's issueCount counts unique codes (times the number of
 * matching requirements, which this module recovers as issueCount / unique raw codes on
 * the criterion). A criterion's count only drops when a code has no occurrence left.
 *
 * Conservative by construction (P4): a vanished code with no annotatedIssues entry and
 * no extractable criterion changes nothing, so a pass is never claimed unprovably.
 * Legacy compliance blobs without annotatedIssues fall back to extractCriterion(code).
 *
 * Pure and frozen-safe: every changed level is a new object, unchanged entries keep
 * their reference, remaining violation entries keep their stored order. Entries that are
 * rebuilt drop reviewStatus / confirmedViolations so normalizeReportData re-derives them.
 * Identity: the filtered report is returned as-is when nothing has to change.
 */
import { extractCriterion } from '../../routes/wcag-enrichment.js';
import { flattenIssueOccurrences } from '../issue-occurrences.js';
import { sanitizeReportParts } from '../count-issues.js';

type Obj = Record<string, unknown>;
type Obligation = 'mandatory' | 'recommended' | 'optional';
interface Totals { readonly mandatory: number; readonly recommended: number; readonly optional: number }
interface Adjusted { readonly list: readonly unknown[]; readonly changed: boolean; readonly delta: Totals }
interface Vanish {
  readonly byCriterion: ReadonlyMap<string, number>;
  readonly rawByCriterion: ReadonlyMap<string, number>;
}

const ZERO: Totals = { mandatory: 0, recommended: 0, optional: 0 };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const pairKey = (code: string, selector: unknown): string => `${code}\u0000${String(selector)}`;

interface Index {
  readonly codes: ReadonlySet<string>;
  readonly pairs: ReadonlySet<string>;
  readonly firstByCode: ReadonlyMap<string, unknown>;
}

function indexOf(report: Obj): Index {
  const { pages, templateIssues } = sanitizeReportParts(report);
  const codes = new Set<string>();
  const pairs = new Set<string>();
  const firstByCode = new Map<string, unknown>();
  for (const { issue } of flattenIssueOccurrences(pages, templateIssues)) {
    if (typeof issue.code !== 'string') continue;
    codes.add(issue.code);
    pairs.add(pairKey(issue.code, issue.selector));
    if (!firstByCode.has(issue.code)) firstByCode.set(issue.code, issue);
  }
  return { codes, pairs, firstByCode };
}

function annotatedCriteria(compliance: Obj): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(compliance.annotatedIssues)) return map;
  for (const a of compliance.annotatedIssues) {
    if (isObj(a) && typeof a.code === 'string' && typeof a.wcagCriterion === 'string' && a.wcagCriterion !== '') {
      map.set(a.code, a.wcagCriterion);
    }
  }
  return map;
}

function tally(codes: Iterable<string>, criterionOf: (code: string) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const code of codes) {
    const criterion = criterionOf(code);
    if (criterion !== null) counts.set(criterion, (counts.get(criterion) ?? 0) + 1);
  }
  return counts;
}

function sumByObligation(list: readonly unknown[]): Totals {
  const sums: Record<Obligation, number> = { mandatory: 0, recommended: 0, optional: 0 };
  for (const v of list) {
    if (isObj(v) && (v.obligation === 'mandatory' || v.obligation === 'recommended' || v.obligation === 'optional')) {
      sums[v.obligation] += num(v.issueCount);
    }
  }
  return sums;
}

/** Decrement each violation by (stored multiplicity x vanished codes on its criterion); drop at zero. */
function adjustViolations(list: readonly unknown[], vanish: Vanish): Adjusted {
  let changed = false;
  const next: unknown[] = [];
  for (const v of list) {
    const gone = isObj(v) && typeof v.wcagCriterion === 'string' ? (vanish.byCriterion.get(v.wcagCriterion) ?? 0) : 0;
    if (!isObj(v) || gone === 0) {
      next.push(v);
      continue;
    }
    changed = true;
    const total = num(v.issueCount);
    const rawCodes = vanish.rawByCriterion.get(v.wcagCriterion as string) ?? 0;
    const perCode = rawCodes > 0 && total % rawCodes === 0 ? total / rawCodes : 1;
    const left = Math.max(0, total - perCode * gone);
    if (left > 0) next.push({ ...v, issueCount: left });
  }
  if (!changed) return { list, changed: false, delta: ZERO };
  const before = sumByObligation(list);
  const after = sumByObligation(next);
  return {
    list: next,
    changed: true,
    delta: {
      mandatory: before.mandatory - after.mandatory,
      recommended: before.recommended - after.recommended,
      optional: before.optional - after.optional,
    },
  };
}

function withoutDerived(entry: Obj): Obj {
  const { reviewStatus: _r, confirmedViolations: _c, ...rest } = entry;
  return rest;
}

const reduceBy = (stored: unknown, by: number): number => Math.max(0, num(stored) - by);

function filterJurisdiction(j: Obj, vanish: Vanish): Obj {
  if (!Array.isArray(j.regulations)) return j;
  let changed = false;
  let delta = ZERO;
  const regulations = j.regulations.map((r: unknown) => {
    if (!isObj(r) || !Array.isArray(r.violations)) return r;
    const adjusted = adjustViolations(r.violations, vanish);
    if (!adjusted.changed) return r;
    changed = true;
    delta = {
      mandatory: delta.mandatory + adjusted.delta.mandatory,
      recommended: delta.recommended + adjusted.delta.recommended,
      optional: delta.optional + adjusted.delta.optional,
    };
    const status = sumByObligation(adjusted.list).mandatory > 0 ? 'fail' : 'pass';
    return { ...withoutDerived(r), violations: adjusted.list, status };
  });
  if (!changed) return j;
  const mandatory = reduceBy(j.mandatoryViolations, delta.mandatory);
  return {
    ...withoutDerived(j),
    regulations,
    status: mandatory > 0 ? 'fail' : 'pass',
    mandatoryViolations: mandatory,
    recommendedViolations: reduceBy(j.recommendedViolations, delta.recommended),
    optionalViolations: reduceBy(j.optionalViolations, delta.optional),
  };
}

function filterRegulationEntry(e: Obj, vanish: Vanish): Obj {
  if (!Array.isArray(e.violatedRequirements)) return e;
  const adjusted = adjustViolations(e.violatedRequirements, vanish);
  if (!adjusted.changed) return e;
  const mandatory = reduceBy(e.mandatoryViolations, adjusted.delta.mandatory);
  const recommended = reduceBy(e.recommendedViolations, adjusted.delta.recommended);
  const optional = reduceBy(e.optionalViolations, adjusted.delta.optional);
  return {
    ...withoutDerived(e),
    violatedRequirements: adjusted.list,
    status: mandatory > 0 ? 'fail' : recommended > 0 || optional > 0 ? 'partial' : 'pass',
    mandatoryViolations: mandatory,
    recommendedViolations: recommended,
    optionalViolations: optional,
  };
}

/** Same map reference when no entry changed; entry order preserved otherwise. */
function mapEntries(map: unknown, fn: (entry: Obj) => Obj): unknown {
  if (!isObj(map)) return map;
  let changed = false;
  const out: Obj = {};
  for (const [key, value] of Object.entries(map)) {
    const next = isObj(value) ? fn(value) : value;
    if (next !== value) changed = true;
    out[key] = next;
  }
  return changed ? out : map;
}

function recomputeSummary(summary: unknown, matrix: unknown): unknown {
  if (!isObj(summary) || !isObj(matrix)) return summary;
  const entries = Object.values(matrix).filter(isObj);
  const total = (field: string): number => entries.reduce((sum, e) => sum + num(e[field]), 0);
  return {
    ...summary,
    passing: entries.filter((e) => e.status === 'pass').length,
    failing: entries.filter((e) => e.status === 'fail').length,
    totalMandatoryViolations: total('mandatoryViolations'),
    totalOptionalViolations: total('optionalViolations'),
  };
}

/** Drop vanished codes; re-point an example that is no longer in the report. Same array when unchanged. */
function filterAnnotated(list: unknown[], vanished: ReadonlySet<string>, kept: Index): unknown[] {
  let changed = false;
  const out: unknown[] = [];
  for (const a of list) {
    if (!isObj(a) || typeof a.code !== 'string') {
      out.push(a);
      continue;
    }
    if (vanished.has(a.code)) {
      changed = true;
      continue;
    }
    const example = a.originalIssue;
    const stale = isObj(example) && 'selector' in example && !kept.pairs.has(pairKey(a.code, example.selector));
    const replacement = stale ? kept.firstByCode.get(a.code) : undefined;
    if (replacement === undefined) {
      out.push(a);
      continue;
    }
    changed = true;
    out.push({ ...a, originalIssue: replacement });
  }
  return changed ? out : list;
}

const isEmptyRecord = (v: unknown): boolean => !isObj(v) || Object.keys(v).length === 0;

export function filterComplianceForDismissals<R>(rawReport: R, filteredReport: R): R {
  if (rawReport === filteredReport || !isObj(rawReport) || !isObj(filteredReport)) return filteredReport;
  const compliance = filteredReport.compliance;
  if (!isObj(compliance)) return filteredReport;
  if (isEmptyRecord(compliance.matrix) && isEmptyRecord(compliance.regulationMatrix)) return filteredReport;

  const raw = indexOf(rawReport);
  const kept = indexOf(filteredReport);
  const vanishedCodes = new Set([...raw.codes].filter((code) => !kept.codes.has(code)));
  const annotated = annotatedCriteria(compliance);
  const criterionOf = (code: string): string | null => annotated.get(code) ?? extractCriterion(code);
  const vanish: Vanish = {
    byCriterion: tally(vanishedCodes, criterionOf),
    rawByCriterion: tally(raw.codes, criterionOf),
  };
  const annotatedIssues = Array.isArray(compliance.annotatedIssues)
    ? filterAnnotated(compliance.annotatedIssues, vanishedCodes, kept)
    : compliance.annotatedIssues;
  if (vanish.byCriterion.size === 0 && annotatedIssues === compliance.annotatedIssues) return filteredReport;

  const matrix = mapEntries(compliance.matrix, (j) => filterJurisdiction(j, vanish));
  const regulationMatrix = mapEntries(compliance.regulationMatrix, (e) => filterRegulationEntry(e, vanish));
  const next: Obj = {
    ...filteredReport,
    compliance: {
      ...compliance,
      matrix,
      regulationMatrix,
      ...(annotatedIssues !== undefined ? { annotatedIssues } : {}),
      summary: matrix === compliance.matrix ? compliance.summary : recomputeSummary(compliance.summary, matrix),
    },
  };
  if (Array.isArray(filteredReport.complianceMatrix) && isObj(matrix) && matrix !== compliance.matrix) {
    next.complianceMatrix = Object.values(matrix);
  }
  if (Array.isArray(filteredReport.regulationMatrix) && isObj(regulationMatrix) && regulationMatrix !== compliance.regulationMatrix) {
    next.regulationMatrix = Object.values(regulationMatrix);
  }
  return next as R;
}
