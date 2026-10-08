import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
// @ts-expect-error — plain ESM script outside the package, no type declarations.
import { drain, openActiveScanQuery, resolveDbPath } from '../../../../scripts/deploy-drain.mjs';

interface Row { id: string; status: string; created_at: string }

/** A fake clock whose sleep advances time, so waits run instantly. */
function fakeClock(start = Date.parse('2026-10-08T10:00:00Z')) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe('drain', () => {
  it('[EVIDENCE] returns immediately when no scan is queued or running', async () => {
    const clock = fakeClock();
    const lines: string[] = [];
    const res = await drain({ listActive: () => [], ...clock, timeoutMs: 60_000, pollMs: 5_000, log: (l: string) => lines.push(l) });
    expect(res).toEqual({ ok: true, waitedMs: 0 });
    expect(lines.join('\n')).toMatch(/no active scans/);
  });

  it('[EVIDENCE] WAITS while a scan is running and proceeds once it finishes', async () => {
    const clock = fakeClock();
    let polls = 0;
    const running: Row = { id: 'abaf761c-f809-4d74-8641-f063fa1005da', status: 'running', created_at: '2026-10-08T09:59:00.000Z' };
    const listActive = () => (++polls <= 3 ? [running] : []);
    const lines: string[] = [];
    const res = await drain({ listActive, ...clock, timeoutMs: 60_000, pollMs: 5_000, log: (l: string) => lines.push(l) });
    expect(res).toEqual({ ok: true, waitedMs: 15_000 });
    expect(lines.filter((l) => l.includes('waiting')).length).toBe(3);
    expect(lines[0]).toMatch(/abaf761c running/);
  });

  it('[EVIDENCE] gives up at the timeout and reports the scans still active', async () => {
    const clock = fakeClock();
    const stuck: Row = { id: '12345678-aaaa', status: 'queued', created_at: '2026-10-08T09:00:00.000Z' };
    const lines: string[] = [];
    const res = await drain({ listActive: () => [stuck], ...clock, timeoutMs: 20_000, pollMs: 5_000, log: (l: string) => lines.push(l) });
    expect(res.ok).toBe(false);
    expect(res.active).toEqual([stuck]);
    expect(lines.at(-1)).toMatch(/timed out after 20s.*12345678 queued/);
  });

  it('[SYMMETRY] logs only a scan-id prefix, status and age — never site URL or org (public Actions logs)', async () => {
    const clock = fakeClock();
    const row = { id: 'abcdef01-0000', status: 'running', created_at: '2026-10-08T09:58:00.000Z', site_url: 'https://secret.example', org_id: 'org-secret' };
    const lines: string[] = [];
    let n = 0;
    await drain({ listActive: () => (n++ === 0 ? [row] : []), ...clock, timeoutMs: 60_000, pollMs: 1_000, log: (l: string) => lines.push(l) });
    const all = lines.join('\n');
    expect(all).toContain('abcdef01 running 2m0s');
    expect(all).not.toMatch(/secret|org-/);
  });
});

describe('openActiveScanQuery (real SQLite)', () => {
  function tempDb(withTable = true) {
    const dir = mkdtempSync(join(tmpdir(), 'drain-'));
    const path = join(dir, 'dashboard.db');
    const db = new Database(path);
    if (withTable) {
      db.exec('CREATE TABLE scan_records (id TEXT PRIMARY KEY, site_url TEXT, status TEXT, created_at TEXT, org_id TEXT)');
      const ins = db.prepare('INSERT INTO scan_records VALUES (?,?,?,?,?)');
      ins.run('a1', 'https://x', 'completed', '2026-10-08T09:00:00Z', 'o');
      ins.run('b2', 'https://x', 'running', '2026-10-08T09:01:00Z', 'o');
      ins.run('c3', 'https://x', 'queued', '2026-10-08T09:02:00Z', 'o');
      ins.run('d4', 'https://x', 'failed', '2026-10-08T09:03:00Z', 'o');
    }
    db.close();
    return { dir, path };
  }

  it('[EVIDENCE] lists exactly the queued and running scans, oldest first, with no site or org columns', () => {
    const { dir, path } = tempDb();
    try {
      const q = openActiveScanQuery(path);
      expect(q.listActive()).toEqual([
        { id: 'b2', status: 'running', created_at: '2026-10-08T09:01:00Z' },
        { id: 'c3', status: 'queued', created_at: '2026-10-08T09:02:00Z' },
      ]);
      q.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('[EVIDENCE] fails loudly when the DB file is missing — never reads "no file" as "no scans"', () => {
    expect(() => openActiveScanQuery('/nonexistent/dashboard.db')).toThrow(/dashboard DB not found/);
  });

  it('[EVIDENCE] fails loudly when scan_records is missing', () => {
    const { dir, path } = tempDb(false);
    try {
      expect(() => openActiveScanQuery(path)).toThrow(/scan_records/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('resolveDbPath', () => {
  it('prefers LUQEN_DASHBOARD_DB, then dashboard.config.json dbPath', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drain-cfg-'));
    try {
      writeFileSync(join(dir, 'dashboard.config.json'), JSON.stringify({ dbPath: '/data/dash.db' }));
      expect(resolveDbPath({ cwd: dir, env: { LUQEN_DASHBOARD_DB: '/env/x.db' } })).toBe('/env/x.db');
      expect(resolveDbPath({ cwd: dir, env: {} })).toBe('/data/dash.db');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('falls back to <cwd>/dashboard.db when there is no config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drain-nocfg-'));
    try {
      expect(resolveDbPath({ cwd: dir, env: {} })).toBe(join(dir, 'dashboard.db'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
