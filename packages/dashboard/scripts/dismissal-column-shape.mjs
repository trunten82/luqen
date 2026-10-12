#!/usr/bin/env node
/**
 * dismissal-column-shape.mjs — Phase 88 plan 02, D-04 and D-13 sizing.
 *
 * READ-ONLY instrument. Proposition measured:
 *   "confirmed_violations distribution and completed scans per org+site key, completed scans"
 *
 * It answers two questions with COUNTS ONLY:
 *   D-04  is confirmed_violations ever non-zero on a completed scan? (Case A: never)
 *   D-13  how many completed scans share one org + toSiteKey(site_url)? (sizes the synchronous recompute)
 *
 * The code under test travels to the data: --site-key-bundle is an esbuild bundle of the COMMITTED
 * src/services/issue-dismissals/site-key.ts. Customer data never leaves the host.
 *
 * Output discipline: ONE JSON object of counts. It never prints a URL, org id, scan id, report path,
 * report content or the value of any identifier, and it never reads the stored report column at all.
 * Fatal errors print only error.name and error.code.
 *
 * Exit codes: 0 measured; 1 fatal; 2 bad arguments; 3 measured nothing.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE =
  'usage: dismissal-column-shape.mjs --db <path> --site-key-bundle <site-key.bundle.mjs> ' +
  '--require-root <package.json> [--label <text>]';

const PROPOSITION =
  'confirmed_violations distribution and completed scans per org+site key, completed scans';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith('--') || value === undefined || value.startsWith('--')) return null;
    out[key.slice(2)] = value;
  }
  const allowed = new Set(['db', 'site-key-bundle', 'require-root', 'label']);
  for (const k of Object.keys(out)) if (!allowed.has(k)) return null;
  if (!out.db || !out['site-key-bundle'] || !out['require-root']) return null;
  return out;
}

function classify(value) {
  if (value === null || value === undefined) return 'null';
  return Number(value) === 0 ? 'zero' : 'nonzero';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    process.exit(2);
  }

  const require = createRequire(resolve(args['require-root']));
  const Database = require('better-sqlite3');
  const bundle = await import(pathToFileURL(resolve(args['site-key-bundle'])).href);
  if (typeof bundle.toSiteKey !== 'function') {
    console.error(USAGE);
    process.exit(2);
  }
  const { toSiteKey } = bundle;

  const db = new Database(resolve(args.db), { readonly: true, fileMustExist: true });

  const completed = db.prepare("SELECT count(*) AS n FROM scan_records WHERE status = 'completed'").get().n;
  const rows = db
    .prepare("SELECT org_id, site_url, confirmed_violations FROM scan_records WHERE status = 'completed'")
    .all();
  db.close();

  const confirmedViolations = { null: 0, zero: 0, nonzero: 0 };
  const groups = new Map();
  for (const row of rows) {
    confirmedViolations[classify(row.confirmed_violations)]++;
    const key = `${String(row.org_id)}\u0000${toSiteKey(String(row.site_url))}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const sizes = [...groups.values()].sort((a, b) => b - a);

  const result = {
    proposition: PROPOSITION,
    label: args.label ?? '',
    completed,
    confirmedViolations,
    siteKeys: groups.size,
    largestGroups: sizes.slice(0, 5),
  };

  if (completed === 0) {
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
