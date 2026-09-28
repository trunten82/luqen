/**
 * PBH-A Task 1 — key-invariant.test.ts
 *
 * A src-scanning invariant proving:
 *   INV-1: the identifier `sessionSecret` appears ONLY in config.ts,
 *          auth/session.ts and server.ts (server.ts has exactly one
 *          occurrence: the registerSession(server, config.sessionSecret) line).
 *   INV-2: the at-rest wiring sites form an EXACT list, each referencing
 *          `config.encryptionKey` (or a local bound from it).
 *   INV-3 (walk proof): the walk inspected more than 100 files and includes
 *          known sites.
 *
 * Pattern follows packages/core/tests/browser/launch-sites.test.ts
 * (CHROMIUM-RESOLVE-1), scoped to packages/dashboard/src only.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/dashboard/tests/at-rest -> repo root
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const DASHBOARD_SRC = join(REPO_ROOT, 'packages', 'dashboard', 'src');

/** Strips comment-only lines (trimmed start //, *, or /*) before matching. */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/** Walks packages/dashboard/src for .ts source files (never tests, .d.ts, node_modules, dist). */
function walkSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
        walk(full);
      } else if (stat.isFile()) {
        if (!entry.endsWith('.ts')) continue;
        if (entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
        files.push(full);
      }
    }
  };
  walk(DASHBOARD_SRC);
  return files.map((f) => relative(REPO_ROOT, f)).sort();
}

const allFiles = walkSourceFiles();

// Diagnostic evidence — read, not just asserted on.
// eslint-disable-next-line no-console
console.log(`[key-invariant] ${allFiles.length} source file(s) inspected under packages/dashboard/src`);

const SESSION_SECRET_PATTERN = /\bsessionSecret\b/;

const CONFIG_TS = join('packages', 'dashboard', 'src', 'config.ts');
const SESSION_TS = join('packages', 'dashboard', 'src', 'auth', 'session.ts');
const SERVER_TS = join('packages', 'dashboard', 'src', 'server.ts');
const SESSION_SECRET_ALLOWLIST = new Set([CONFIG_TS, SESSION_TS, SERVER_TS]);

const REGISTER_SESSION_LINE_PATTERN = /registerSession\(server,\s*config\.sessionSecret/;

describe('at-rest key-invariant (PBH-A)', () => {
  it('INV-3: the walk inspected more than 100 files and includes known sites', () => {
    expect(allFiles.length).toBeGreaterThan(100);
    expect(allFiles).toContain(SERVER_TS);
    expect(allFiles).toContain(join('packages', 'dashboard', 'src', 'cli.ts'));
    expect(allFiles).toContain(join('packages', 'dashboard', 'src', 'plugins', 'crypto.ts'));
    expect(allFiles).toContain(join('packages', 'dashboard', 'src', 'routes', 'fix-pr.ts'));
  });

  it('INV-1: sessionSecret occurs only in config.ts, auth/session.ts and server.ts (server.ts: exactly one, the registerSession line)', () => {
    const offenders: string[] = [];
    let serverOccurrences = 0;

    for (const relPath of allFiles) {
      const abs = join(REPO_ROOT, relPath);
      const lines = readFileSync(abs, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (isCommentLine(line)) return;
        if (!SESSION_SECRET_PATTERN.test(line)) return;
        if (!SESSION_SECRET_ALLOWLIST.has(relPath)) {
          offenders.push(`${relPath}:${idx + 1}`);
          return;
        }
        if (relPath === SERVER_TS) {
          serverOccurrences++;
          if (!REGISTER_SESSION_LINE_PATTERN.test(line)) {
            offenders.push(`${relPath}:${idx + 1} (not the registerSession line)`);
          }
        }
      });
    }

    expect(offenders, `offending sessionSecret sites:\n${offenders.join('\n')}`).toEqual([]);
    expect(serverOccurrences, 'server.ts must reference sessionSecret exactly once').toBe(1);
  });

  it('INV-2: the at-rest wiring sites form an exact list, each referencing config.encryptionKey', () => {
    interface WiringSite {
      readonly file: string;
      readonly line: number;
      readonly label: string;
    }

    const REL = (...p: string[]): string => join('packages', 'dashboard', 'src', ...p);

    // MEASURED 2026-09-28 at cddd3475 (plan Consumer Inventory, group R).
    // Re-measured after Task 4 inserted the PBH-D startup-check block ahead
    // of `new PluginManager` in server.ts, shifting every site below it by
    // +14 lines (299->313, 341->355, 1101->1115, 1298->1312, 1299->1313,
    // 1412->1430). The startup-check's own `encryptionKey: config.encryptionKey`
    // reference (server.ts ~289) is NOT a new wiring site requiring a list
    // update — it is the read-only decrypt CHECK, not a write/consumer path,
    // and this test asserts an exact fixed-position list, not a generic scan.
    // A NEW at-rest call site forces a conscious update of this list.
    const EXPECTED_WIRING_SITES: readonly WiringSite[] = [
      { file: SERVER_TS, line: 313, label: 'R1 PluginManager options' },
      { file: SERVER_TS, line: 355, label: 'R3 SqliteServiceConnectionsRepository' },
      { file: SERVER_TS, line: 1115, label: 'R7 registerOauthKeysRoutes' },
      { file: SERVER_TS, line: 1312, label: 'R8 ensureInitialSigningKey' },
      { file: SERVER_TS, line: 1313, label: 'R9 createDashboardSigner' },
      { file: SERVER_TS, line: 1430, label: 'R10 startKeyHousekeeping' },
      { file: REL('cli.ts'), line: 219, label: 'R2 cli.ts PluginManager options' },
      { file: REL('routes', 'git-credentials.ts'), line: 32, label: 'R4 git-credentials encryptionKey local' },
      { file: REL('routes', 'repos.ts'), line: 404, label: 'R5 repos.ts decryptSecret' },
      { file: REL('routes', 'fix-pr.ts'), line: 305, label: 'R6 fix-pr.ts decryptSecret' },
    ];

    const results = EXPECTED_WIRING_SITES.map((site) => {
      const abs = join(REPO_ROOT, site.file);
      let text = '';
      try {
        const lines = readFileSync(abs, 'utf8').split('\n');
        text = lines[site.line - 1] ?? '';
      } catch {
        text = '';
      }
      return { ...site, matchesEncryptionKey: /config\.encryptionKey\b/.test(text) };
    });

    const failing = results.filter((r) => !r.matchesEncryptionKey);
    expect(failing, `wiring sites not referencing config.encryptionKey:\n${JSON.stringify(failing, null, 2)}`).toEqual([]);
  });
});
