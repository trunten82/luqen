#!/usr/bin/env node
/**
 * count-identity-measure.mjs — Phase 87 plan 05, D-09 part b.
 *
 * READ-ONLY instrument. Proposition measured:
 *   "countIssues(stored report) equals the stored errors/warnings/notices/total_issues
 *    columns, for completed scans, zero dismissals".
 *
 * The code under test travels to the data: --bundle is an esbuild bundle of the
 * COMMITTED src/services/count-issues.ts. Customer data never leaves the host.
 *
 * Output discipline: ONE JSON object of counts. Never prints a URL, org id, scan id,
 * report path, row content, or any error/parse message (V8 parse messages quote input).
 * Fatal errors print only error.name and error.code.
 *
 * Exit codes: 0 measured; 1 fatal; 2 bad arguments; 3 measured nothing.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE =
  'usage: count-identity-measure.mjs --db <path> --bundle <count-issues.bundle.mjs> ' +
  '--require-root <package.json> [--report-base <dir>] [--label <text>]';

const PROPOSITION =
  'countIssues(stored report) equals the stored errors/warnings/notices/total_issues ' +
  'columns, for completed scans, zero dismissals';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith('--') || value === undefined || value.startsWith('--')) return null;
    out[key.slice(2)] = value;
  }
  const allowed = new Set(['db', 'bundle', 'require-root', 'report-base', 'label']);
  for (const k of Object.keys(out)) if (!allowed.has(k)) return null;
  if (!out.db || !out.bundle || !out['require-root']) return null;
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

function summaryClass(report, cols) {
  const summary = isObject(report) ? report.summary : undefined;
  if (!isObject(summary)) return 'no-summary';
  const lvl = summary.byLevel;
  const equal =
    isObject(lvl) &&
    lvl.error === cols.errors &&
    lvl.warning === cols.warnings &&
    lvl.notice === cols.notices &&
    summary.totalIssues === cols.total_issues;
  return equal ? 'summary=columns' : 'summary!=columns';
}

function bump(map, key, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function monthOf(createdAt) {
  return typeof createdAt === 'string' && /^\d{4}-\d{2}/.test(createdAt) ? createdAt.slice(0, 7) : 'unknown';
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    process.exit(2);
  }

  const require = createRequire(resolve(args['require-root']));
  const Database = require('better-sqlite3');
  const bundle = await import(pathToFileURL(resolve(args.bundle)).href);
  if (typeof bundle.countIssues !== 'function') {
    console.error(USAGE);
    process.exit(2);
  }
  const countIssues = bundle.countIssues;

  const dbPath = resolve(args.db);
  const reportBase = args['report-base'] ? resolve(args['report-base']) : dirname(dbPath);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  const ids = db
    .prepare("SELECT id FROM scan_records WHERE status = 'completed' ORDER BY created_at, id")
    .all()
    .map((r) => r.id);
  const fetchOne = db.prepare(
    'SELECT errors, warnings, notices, total_issues, json_report, json_report_path, created_at ' +
      'FROM scan_records WHERE id = ?',
  );

  const result = {
    proposition: PROPOSITION,
    label: args.label ?? '',
    completed: ids.length,
    measured: { db: 0, fs: 0 },
    notMeasured: { noReport: 0, parseError: 0, nullColumns: 0 },
    match: 0,
    mismatch: 0,
    byShape: {},
    mismatchBySummaryClass: {},
    mismatchDeltaSigns: {},
    mismatchByMonth: {},
  };

  for (const id of ids) {
    // One blob in memory at a time; every reference dies with this function scope.
    processOne(id);
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
    let report;
    try {
      report = JSON.parse(loaded.text);
    } catch {
      result.notMeasured.parseError++;
      return;
    }
    const counted = countIssues(report);
    result.measured[loaded.source]++;
    const shape = shapeOf(report);
    const bucket = (result.byShape[shape] ??= { measured: 0, mismatch: 0 });
    bucket.measured++;

    const deltas = [];
    if (counted.errors !== cols.errors) deltas.push(['errors', cols.errors, counted.errors]);
    if (counted.warnings !== cols.warnings) deltas.push(['warnings', cols.warnings, counted.warnings]);
    if (counted.notices !== cols.notices) deltas.push(['notices', cols.notices, counted.notices]);
    if (counted.total !== cols.total_issues) deltas.push(['total', cols.total_issues, counted.total]);

    if (deltas.length === 0) {
      result.match++;
      return;
    }
    result.mismatch++;
    bucket.mismatch++;
    bump(result.mismatchBySummaryClass, summaryClass(report, cols));
    for (const [level, col, computed] of deltas) {
      bump(result.mismatchDeltaSigns, `${level}:col${col > computed ? '>' : '<'}computed`);
    }
    bump(result.mismatchByMonth, monthOf(row.created_at));
  }

  db.close();

  if (result.measured.db + result.measured.fs === 0) {
    console.error('measured nothing');
    console.log(JSON.stringify(result, null, 2));
    process.exit(3);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`fatal: ${error && error.name}${error && error.code ? ` ${error.code}` : ''}`);
  process.exit(1);
});
