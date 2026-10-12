#!/usr/bin/env node
/**
 * zero-dismissal-golden.mjs — Phase 88 plan 12, D-20 layer b (SC5 on real data).
 *
 * READ-ONLY instrument. Two propositions, both measured on every completed stored scan in ONE process:
 *
 *  1. ZERO-DISMISSAL IDENTITY. "With no active dismissal, the post-phase code produces the same
 *     normalised report JSON, the same VPAT JSON and the same countIssues as the pre-phase code
 *     (an esbuild bundle of 48bed410), and countIssues equals the stored count columns."
 *     The new path deliberately bypasses the loader's empty-set short-circuit: it calls the pure
 *     applyDismissals with an empty list, filterComplianceForDismissals and the VPAT disclosure
 *     option, so the new pure functions themselves run on every real report shape.
 *
 *  2. SYNTHETIC ONE-DISMISSAL CONSERVATION (in memory, nothing is written). One synthetic dismissal
 *     per report: conservation by level, zero residual occurrences, a monotone compliance matrix
 *     and a consistent VPAT disclosure.
 *
 * The code under test travels to the data: --old-bundle / --new-bundle are esbuild bundles. Customer
 * data never leaves the host. The DB is opened read-only.
 *
 * Output discipline (P10): ONE JSON object of counts. Never prints a URL, org id, scan id, report path,
 * report content or any error/parse message (V8 parse messages quote input). site_url / standard /
 * jurisdictions / regulations are fed to the code under test and never printed. Fatal errors print only
 * error.name / error.code.
 *
 * Exit codes: 0 measured, zero mismatches, every synthetic check holds; 4 measured with at least one
 * mismatch or violation; 3 measured nothing; 2 bad arguments; 1 fatal.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE =
  'usage: zero-dismissal-golden.mjs --db <path> --old-bundle <old.bundle.mjs> --new-bundle <new.bundle.mjs> ' +
  '--require-root <package.json> [--report-base <dir>] [--label <text>]';

const PROPOSITIONS = [
  'zero dismissals: the post-phase code (applyDismissals with an empty list, filterComplianceForDismissals, ' +
    'the VPAT disclosure option) yields the same normalised report JSON, the same VPAT JSON and the same ' +
    'countIssues as the pre-phase code, and countIssues equals the stored errors/warnings/notices/total_issues ' +
    'columns, for completed scans',
  'one synthetic in-memory dismissal per report: counts are conserved by level, no occurrence of the ' +
    'dismissed code+selector survives, no compliance total grows, and the VPAT disclosure is consistent',
];

const GENERATED_AT = '2026-01-15';
const WHOLE_PAGE_SELECTORS = new Set(['', 'html', 'body', ':root']);
const LEVELS = ['errors', 'warnings', 'notices', 'total'];
const OBLIGATION_FIELDS = ['mandatoryViolations', 'recommendedViolations', 'optionalViolations'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith('--') || value === undefined || value.startsWith('--')) return null;
    out[key.slice(2)] = value;
  }
  const allowed = new Set(['db', 'old-bundle', 'new-bundle', 'require-root', 'report-base', 'label']);
  for (const k of Object.keys(out)) if (!allowed.has(k)) return null;
  if (!out.db || !out['old-bundle'] || !out['new-bundle'] || !out['require-root']) return null;
  return out;
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function shapeOf(report) {
  const parts = [];
  const summary = isObject(report) ? report.summary : undefined;
  if (isObject(summary) && Number(summary.pagesSkipped) > 0) parts.push('incremental-skips');
  if (isObject(report) && Array.isArray(report.templateIssues) && report.templateIssues.length > 0) {
    parts.push('template-issues');
  }
  if (!isObject(report) || !Array.isArray(report.pages)) parts.push('no-pages');
  return parts.length > 0 ? parts.join('+') : 'standard';
}

/** Returns { text, source } or null when there is no report text. Never throws. */
function loadReportText(row, reportBase) {
  if (typeof row.json_report === 'string' && row.json_report.length > 0) {
    return { text: row.json_report, source: 'db' };
  }
  if (typeof row.json_report_path === 'string' && row.json_report_path.length > 0) {
    const p = isAbsolute(row.json_report_path) ? row.json_report_path : resolve(reportBase, row.json_report_path);
    try {
      if (existsSync(p)) return { text: readFileSync(p, 'utf8'), source: 'fs' };
    } catch {
      return null;
    }
  }
  return null;
}

function parseJsonArray(text) {
  if (typeof text !== 'string') return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Runs fn; returns { ok: true, value } or { ok: false }. The error is never inspected or printed. */
function attempt(fn) {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false };
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** First page issue (page order) with a string code and a selector outside the whole-page set. */
function pickSyntheticTarget(report) {
  if (!isObject(report) || !Array.isArray(report.pages)) return null;
  for (const page of report.pages) {
    if (!isObject(page) || !Array.isArray(page.issues)) continue;
    for (const issue of page.issues) {
      if (!isObject(issue)) continue;
      if (typeof issue.code !== 'string' || typeof issue.selector !== 'string') continue;
      if (WHOLE_PAGE_SELECTORS.has(issue.selector.trim().toLowerCase())) continue;
      return { code: issue.code, selector: issue.selector };
    }
  }
  return null;
}

function countDismissedByType(dismissed) {
  const out = { errors: 0, warnings: 0, notices: 0, total: 0 };
  for (const occurrence of dismissed) {
    const type = isObject(occurrence.issue) ? occurrence.issue.type : undefined;
    if (type === 'error') out.errors++;
    else if (type === 'warning') out.warnings++;
    else out.notices++;
    out.total++;
  }
  return out;
}

function residualOccurrencesOf(report, target) {
  if (!isObject(report)) return 0;
  let n = 0;
  const hit = (issue) => isObject(issue) && issue.code === target.code && issue.selector === target.selector;
  if (Array.isArray(report.pages)) {
    for (const page of report.pages) {
      if (isObject(page) && Array.isArray(page.issues)) n += page.issues.filter(hit).length;
    }
  }
  if (Array.isArray(report.templateIssues)) n += report.templateIssues.filter(hit).length;
  return n;
}

function matrixGrew(rawMatrix, filteredMatrix) {
  if (!isObject(rawMatrix)) return false;
  if (!isObject(filteredMatrix)) return true;
  for (const [key, rawEntry] of Object.entries(rawMatrix)) {
    if (!isObject(rawEntry)) continue;
    const filteredEntry = filteredMatrix[key];
    if (!isObject(filteredEntry)) return true;
    for (const field of OBLIGATION_FIELDS) {
      const before = rawEntry[field];
      const after = filteredEntry[field];
      if (typeof before === 'number' && (typeof after !== 'number' || after > before)) return true;
    }
  }
  return false;
}

function complianceGrew(rawReport, filteredReport) {
  const rawC = isObject(rawReport) ? rawReport.compliance : undefined;
  if (!isObject(rawC)) return false;
  const filteredC = isObject(filteredReport) ? filteredReport.compliance : undefined;
  if (!isObject(filteredC)) return true;
  return matrixGrew(rawC.matrix, filteredC.matrix) || matrixGrew(rawC.regulationMatrix, filteredC.regulationMatrix);
}

function vpatRows(vpat) {
  if (!isObject(vpat) || !Array.isArray(vpat.tablesByLevel)) return [];
  return vpat.tablesByLevel.flatMap((table) => (isObject(table) && Array.isArray(table.rows) ? table.rows : []));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    process.exit(2);
  }

  const require = createRequire(resolve(args['require-root']));
  const Database = require('better-sqlite3');
  const oldB = await import(pathToFileURL(resolve(args['old-bundle'])).href);
  const newB = await import(pathToFileURL(resolve(args['new-bundle'])).href);
  const oldNeeds = ['normalizeReportData', 'buildVpat', 'countIssues'];
  const newNeeds = [
    ...oldNeeds,
    'applyDismissals',
    'filterComplianceForDismissals',
    'dismissedCountsByCriterion',
    'toSiteKey',
    'dismissalNoteEn',
  ];
  if (oldNeeds.some((k) => typeof oldB[k] !== 'function') || newNeeds.some((k) => typeof newB[k] !== 'function')) {
    console.error(USAGE);
    process.exit(2);
  }

  const dbPath = resolve(args.db);
  const reportBase = args['report-base'] ? resolve(args['report-base']) : dirname(dbPath);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  const ids = db
    .prepare("SELECT id FROM scan_records WHERE status = 'completed' ORDER BY created_at, id")
    .all()
    .map((r) => r.id);
  const fetchOne = db.prepare(
    'SELECT errors, warnings, notices, total_issues, json_report, json_report_path, site_url, ' +
      'standard, jurisdictions, regulations, pages_scanned FROM scan_records WHERE id = ?',
  );

  const result = {
    propositions: PROPOSITIONS,
    label: args.label ?? '',
    completed: ids.length,
    measured: { db: 0, fs: 0 },
    notMeasured: { noReport: 0, parseError: 0, nullColumns: 0 },
    normalised: { match: 0, mismatch: 0 },
    vpat: { match: 0, mismatch: 0 },
    counts: { match: 0, mismatch: 0 },
    threw: { oldPath: 0, newPath: 0, asymmetric: 0 },
    byShape: {},
    synthetic: {
      eligible: 0,
      ineligible: 0,
      conservationViolations: 0,
      residualOccurrences: 0,
      complianceThrew: 0,
      complianceNotMonotone: 0,
      vpatThrew: 0,
      disclosureInconsistent: 0,
    },
  };

  for (const id of ids) {
    // One blob in memory at a time; every reference dies with this function scope.
    processOne(id);
  }

  function compare(bucket, shapeBucket, a, b) {
    if (same(a, b)) {
      bucket.match++;
    } else {
      bucket.mismatch++;
      shapeBucket.mismatch++;
    }
  }

  function processOne(scanId) {
    const row = fetchOne.get(scanId);
    if (row === undefined) {
      result.notMeasured.noReport++;
      return;
    }
    const cols = {
      errors: row.errors,
      warnings: row.warnings,
      notices: row.notices,
      total_issues: row.total_issues,
    };
    if (Object.values(cols).some((v) => v === null || v === undefined)) {
      result.notMeasured.nullColumns++;
      return;
    }
    const loaded = loadReportText(row, reportBase);
    if (loaded === null) {
      result.notMeasured.noReport++;
      return;
    }
    let raw;
    try {
      raw = JSON.parse(loaded.text);
    } catch {
      result.notMeasured.parseError++;
      return;
    }
    result.measured[loaded.source]++;
    const shape = shapeOf(raw);
    const shapeBucket = (result.byShape[shape] ??= { measured: 0, mismatch: 0 });
    shapeBucket.measured++;

    const siteUrl = typeof row.site_url === 'string' ? row.site_url : '';
    const scanCols = {
      siteUrl,
      ...(row.pages_scanned !== null && row.pages_scanned !== undefined ? { pagesScanned: row.pages_scanned } : {}),
      errors: row.errors,
      warnings: row.warnings,
      notices: row.notices,
    };
    const scanInput = {
      siteUrl,
      standard: row.standard,
      jurisdictions: parseJsonArray(row.jurisdictions),
      regulations: parseJsonArray(row.regulations),
    };

    zeroDismissalComparison(raw, scanCols, scanInput, siteUrl, cols, shapeBucket);
    syntheticConservation(raw, scanCols, scanInput, siteUrl, shapeBucket);
  }

  function zeroDismissalComparison(raw, scanCols, scanInput, siteUrl, cols, shapeBucket) {
    const siteKey = newB.toSiteKey(siteUrl);

    // OLD path: the pre-phase code, straight from the stored report.
    const oldNorm = attempt(() => oldB.normalizeReportData(raw, scanCols));
    // NEW path: bypasses the loader's empty-set short-circuit so the pure functions run.
    const newReport = attempt(() => {
      const applied = newB.applyDismissals(raw, [], siteKey);
      return newB.filterComplianceForDismissals(raw, applied.report);
    });
    const newNorm = newReport.ok ? attempt(() => newB.normalizeReportData(newReport.value, scanCols)) : { ok: false };

    if (!oldNorm.ok) result.threw.oldPath++;
    if (!newNorm.ok) result.threw.newPath++;
    if (oldNorm.ok !== newNorm.ok) {
      result.threw.asymmetric++;
    } else if (oldNorm.ok) {
      compare(result.normalised, shapeBucket, oldNorm.value, newNorm.value);

      const oldOpts = {
        generatedAt: GENERATED_AT,
        behaviorallyEvaluatedCriteria: new Set(oldNorm.value.behaviorallyEvaluatedCriteria ?? []),
      };
      const newOpts = {
        generatedAt: GENERATED_AT,
        behaviorallyEvaluatedCriteria: new Set(newNorm.value.behaviorallyEvaluatedCriteria ?? []),
        dismissedByCriterion: newB.dismissedCountsByCriterion([]),
      };
      const oldVpat = attempt(() => oldB.buildVpat(oldNorm.value, scanInput, [], oldOpts));
      const newVpat = attempt(() => newB.buildVpat(newNorm.value, scanInput, [], newOpts));
      if (!oldVpat.ok) result.threw.oldPath++;
      if (!newVpat.ok) result.threw.newPath++;
      if (oldVpat.ok !== newVpat.ok) result.threw.asymmetric++;
      else if (oldVpat.ok) compare(result.vpat, shapeBucket, oldVpat.value, newVpat.value);
    }

    // Counts: the new countIssues of the zero-dismissal report versus the stored columns.
    if (!newReport.ok) return; // already counted above (the new path threw before normalising)
    const counted = attempt(() => newB.countIssues(newReport.value));
    if (!counted.ok) {
      result.threw.newPath++;
      result.threw.asymmetric++;
      return;
    }
    const equal =
      counted.value.errors === cols.errors &&
      counted.value.warnings === cols.warnings &&
      counted.value.notices === cols.notices &&
      counted.value.total === cols.total_issues;
    if (equal) {
      result.counts.match++;
    } else {
      result.counts.mismatch++;
      shapeBucket.mismatch++;
    }
  }

  function syntheticConservation(raw, scanCols, scanInput, siteUrl, shapeBucket) {
    const target = pickSyntheticTarget(raw);
    if (target === null) {
      result.synthetic.ineligible++;
      return;
    }
    const s = result.synthetic;
    s.eligible++;
    const siteKey = newB.toSiteKey(siteUrl);
    const applied = attempt(() =>
      newB.applyDismissals(raw, [{ id: 'synthetic', code: target.code, selector: target.selector, siteKey }], siteKey),
    );
    if (!applied.ok) {
      s.conservationViolations++;
      shapeBucket.mismatch++;
      return;
    }
    const { report: filtered, dismissed } = applied.value;

    // (a) conservation by level
    const before = newB.countIssues(raw);
    const after = newB.countIssues(filtered);
    const gone = countDismissedByType(dismissed);
    const conserved = dismissed.length > 0 && LEVELS.every((k) => before[k] === after[k] + gone[k]);
    if (!conserved) {
      s.conservationViolations++;
      shapeBucket.mismatch++;
    }

    // (b) no surviving occurrence of the dismissed code+selector
    const residual = residualOccurrencesOf(filtered, target);
    if (residual > 0) {
      s.residualOccurrences += residual;
      shapeBucket.mismatch++;
    }

    // (c) compliance matrices only shrink
    const withCompliance = attempt(() => newB.filterComplianceForDismissals(raw, filtered));
    if (!withCompliance.ok) {
      s.complianceThrew++;
      shapeBucket.mismatch++;
      return;
    }
    if (complianceGrew(raw, withCompliance.value)) {
      s.complianceNotMonotone++;
      shapeBucket.mismatch++;
    }

    // (d) the VPAT disclosure is consistent with the dismissed occurrences
    const byCriterion = attempt(() => newB.dismissedCountsByCriterion(dismissed));
    const norm = attempt(() => newB.normalizeReportData(withCompliance.value, scanCols));
    const vpat =
      byCriterion.ok && norm.ok
        ? attempt(() =>
            newB.buildVpat(norm.value, scanInput, [], {
              generatedAt: GENERATED_AT,
              behaviorallyEvaluatedCriteria: new Set(norm.value.behaviorallyEvaluatedCriteria ?? []),
              dismissedByCriterion: byCriterion.value,
            }),
          )
        : { ok: false };
    if (!vpat.ok) {
      s.vpatThrew++;
      shapeBucket.mismatch++;
      return;
    }
    let sum = 0;
    let consistent = true;
    for (const vrow of vpatRows(vpat.value)) {
      const n = vrow.dismissedCount;
      if (n === undefined) continue;
      sum += n;
      if (!(n > 0) || n !== byCriterion.value.get(vrow.criterion)) consistent = false;
      else if (typeof vrow.remarks !== 'string' || !vrow.remarks.endsWith(newB.dismissalNoteEn(n))) consistent = false;
    }
    if (sum > dismissed.length) consistent = false;
    if (!consistent) {
      s.disclosureInconsistent++;
      shapeBucket.mismatch++;
    }
  }

  db.close();

  const comparable = result.normalised.match + result.normalised.mismatch;
  const syn = result.synthetic;
  const violations =
    result.normalised.mismatch +
    result.vpat.mismatch +
    result.counts.mismatch +
    result.threw.asymmetric +
    syn.conservationViolations +
    syn.residualOccurrences +
    syn.complianceThrew +
    syn.complianceNotMonotone +
    syn.vpatThrew +
    syn.disclosureInconsistent;

  if (result.measured.db + result.measured.fs === 0 || comparable === 0) {
    console.error('measured nothing');
    console.log(JSON.stringify(result, null, 2));
    process.exit(3);
  }
  console.log(JSON.stringify(result, null, 2));
  if (violations > 0) {
    console.error('violations found');
    process.exit(4);
  }
}

main().catch((error) => {
  console.error(`fatal: ${error && error.name}${error && error.code ? ` ${error.code}` : ''}`);
  process.exit(1);
});
