#!/usr/bin/env node
/**
 * DEPLOY-DRAIN-1: wait for in-flight scans before the deploy restarts the dashboard.
 *
 * Scans run inside the dashboard process and nothing resumes them, so a restart
 * fails every queued/running scan ("Interrupted by server restart"). That killed
 * a customer's 50-page scan on 2026-10-08. The Deploy workflow runs this
 * IMMEDIATELY before it stops the dashboard: once the dashboard is stopped no new
 * scan can start, so there is no window between this check and the stop.
 *
 * Exit 0: no active scans (or they all finished). Exit 3: timed out with scans
 * still active — the deploy fails WITHOUT touching the running services.
 * Any other failure (DB missing, table missing) throws: "cannot read the DB" is
 * never treated as "no scans".
 *
 * The repo is public, so Actions logs are public: log only a scan-id prefix,
 * status and age — never the site URL or org.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ACTIVE_STATUSES = ['queued', 'running'];
export const EXIT_TIMEOUT = 3;

function age(createdAt, nowMs) {
  const s = Math.max(0, Math.round((nowMs - Date.parse(createdAt)) / 1000));
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

function describe(rows, nowMs) {
  return rows.map((r) => `${String(r.id).slice(0, 8)} ${r.status} ${age(r.created_at, nowMs)}`).join(', ');
}

/**
 * Poll until no scan is active or the timeout passes.
 * @returns {Promise<{ok: true, waitedMs: number} | {ok: false, waitedMs: number, active: object[]}>}
 */
export async function drain({ listActive, sleep, now, timeoutMs, pollMs, log }) {
  const started = now();
  for (;;) {
    const active = listActive();
    const waited = now() - started;
    if (active.length === 0) {
      log(waited === 0 ? 'deploy-drain: no active scans — proceeding' : `deploy-drain: scans finished after ${Math.round(waited / 1000)}s — proceeding`);
      return { ok: true, waitedMs: waited };
    }
    if (waited >= timeoutMs) {
      log(`deploy-drain: timed out after ${Math.round(timeoutMs / 1000)}s with ${active.length} active scan(s): ${describe(active, now())} — NOT restarting; re-run the deploy later, or dispatch it with force=true`);
      return { ok: false, waitedMs: waited, active };
    }
    log(`deploy-drain: waiting for ${active.length} active scan(s): ${describe(active, now())}`);
    await sleep(pollMs);
  }
}

/** DB path: LUQEN_DASHBOARD_DB, else dashboard.config.json dbPath, else <cwd>/dashboard.db. */
export function resolveDbPath({ cwd, env }) {
  if (env.LUQEN_DASHBOARD_DB) return env.LUQEN_DASHBOARD_DB;
  const cfg = join(cwd, 'dashboard.config.json');
  if (existsSync(cfg)) {
    const parsed = JSON.parse(readFileSync(cfg, 'utf8'));
    if (typeof parsed.dbPath === 'string' && parsed.dbPath) return parsed.dbPath;
  }
  return join(cwd, 'dashboard.db');
}

/** Open the dashboard DB read-only and return a query for active scans. Throws if unreadable. */
export function openActiveScanQuery(dbPath) {
  if (!existsSync(dbPath)) throw new Error(`deploy-drain: dashboard DB not found at ${dbPath}`);
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scan_records'").get();
  if (!table) {
    db.close();
    throw new Error(`deploy-drain: table scan_records not found in ${dbPath}`);
  }
  const stmt = db.prepare(
    `SELECT id, status, created_at FROM scan_records WHERE status IN (${ACTIVE_STATUSES.map(() => '?').join(',')}) ORDER BY created_at`,
  );
  return { listActive: () => stmt.all(...ACTIVE_STATUSES), close: () => db.close() };
}

async function main() {
  const timeoutMs = Number(process.env.DRAIN_TIMEOUT_SEC ?? 1800) * 1000;
  const pollMs = Number(process.env.DRAIN_POLL_SEC ?? 15) * 1000;
  const query = openActiveScanQuery(resolveDbPath({ cwd: process.cwd(), env: process.env }));
  try {
    const res = await drain({
      listActive: query.listActive,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      timeoutMs,
      pollMs,
      log: (line) => console.log(line),
    });
    process.exitCode = res.ok ? 0 : EXIT_TIMEOUT;
  } finally {
    query.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
