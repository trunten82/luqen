/**
 * PBH-A Task 1 — key-invariant.test.ts
 *
 * A src-scanning invariant proving:
 *   INV-1: the identifier `sessionSecret` appears ONLY in config.ts,
 *          auth/session.ts and server.ts (server.ts has exactly one
 *          occurrence: the registerSession(server, config.sessionSecret) line).
 *   HARD-09: the at-rest wiring sites form an EXACT list, each found by its call
 *          expression (never a line number) and referencing `config.encryptionKey`
 *          (or a local bound from it); every other reference is a named exemption.
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

// ── at-rest consumers of the encryption key, found by call expression ──────────
const KEY_REFERENCE = /config\.encryptionKey\b/;

interface AnchoredSite {
  readonly file: string;
  /** The call expression the site is anchored on; exactly one non-comment line of the file must match it. */
  readonly anchor: RegExp;
  /** How many lines after the anchor line may carry the key reference (0 = the anchor line itself). */
  readonly window: number;
  readonly label: string;
}

const SRC = (...p: string[]): string => join('packages', 'dashboard', 'src', ...p);

interface ResolvedSite {
  readonly problem?: string;
  /** `file:line` of every key-reference line this site claims. */
  readonly claimed: readonly string[];
}

/** Resolves one anchored site; the problem text names the label and what was wrong. */
function resolveAnchoredSite(site: AnchoredSite): ResolvedSite {
  let lines: string[];
  try {
    lines = readFileSync(join(REPO_ROOT, site.file), 'utf8').split('\n');
  } catch {
    return { problem: `${site.label}: ${site.file} could not be read`, claimed: [] };
  }
  const hits: number[] = [];
  lines.forEach((line, idx) => {
    if (!isCommentLine(line) && site.anchor.test(line)) hits.push(idx);
  });
  if (hits.length !== 1) {
    const what = hits.length === 0 ? 'no line matches' : `${hits.length} lines match`;
    return { problem: `${site.label}: ${what} the anchor ${String(site.anchor)} in ${site.file}`, claimed: [] };
  }
  const start = hits[0];
  const claimed: string[] = [];
  for (let i = start; i <= start + site.window && i < lines.length; i++) {
    if (!isCommentLine(lines[i]) && KEY_REFERENCE.test(lines[i])) claimed.push(`${site.file}:${i + 1}`);
  }
  if (claimed.length === 0) {
    return { problem: `${site.label}: config.encryptionKey is not within ${site.window} line(s) of the anchor in ${site.file}`, claimed: [] };
  }
  return { claimed };
}

// Each at-rest consumer of the encryption key, anchored by its call expression (never by line number).
// The list is exact: a new at-rest call site needs a conscious edit here.
const ANCHORED_SITES: readonly AnchoredSite[] = [
  { file: SERVER_TS, anchor: /new PluginManager\(/, window: 5, label: 'R1 PluginManager options' },
  { file: SERVER_TS, anchor: /new SqliteServiceConnectionsRepository\(/, window: 3, label: 'R3 SqliteServiceConnectionsRepository' },
  { file: SERVER_TS, anchor: /registerOauthKeysRoutes\(/, window: 0, label: 'R7 registerOauthKeysRoutes' },
  { file: SERVER_TS, anchor: /ensureInitialSigningKey\(/, window: 0, label: 'R8 ensureInitialSigningKey' },
  { file: SERVER_TS, anchor: /createDashboardSigner\(/, window: 0, label: 'R9 createDashboardSigner' },
  { file: SERVER_TS, anchor: /startKeyHousekeeping\(/, window: 0, label: 'R10 startKeyHousekeeping' },
  { file: SRC('cli.ts'), anchor: /new PluginManager\(/, window: 3, label: 'R2 cli.ts PluginManager options' },
  { file: SRC('routes', 'git-credentials.ts'), anchor: /const encryptionKey = /, window: 0, label: 'R4 git-credentials encryptionKey local' },
  { file: SRC('routes', 'repos.ts'), anchor: /decryptSecret\(credential\.encryptedToken/, window: 0, label: 'R5 repos.ts decryptSecret' },
  { file: SRC('routes', 'fix-pr.ts'), anchor: /decryptSecret\(credential\.encryptedToken/, window: 0, label: 'R6 fix-pr.ts decryptSecret' },
];

// References that are deliberately not at-rest wiring sites.
const NAMED_EXEMPTIONS: readonly AnchoredSite[] = [
  { file: SERVER_TS, anchor: /checkAtRestDecryption\(/, window: 2, label: 'E1 read-only startup decrypt check' },
];
// E2: src/config.ts defines and validates the key; every line of it is exempt.
const CONFIG_EXEMPT_FILE = CONFIG_TS;

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

  it('HARD-09 wiring sites are found by expression not by line number', () => {
    const problems: string[] = [];
    for (const site of [...ANCHORED_SITES, ...NAMED_EXEMPTIONS]) {
      const found = resolveAnchoredSite(site);
      if (found.problem !== undefined) problems.push(found.problem);
    }
    expect(problems, `anchored at-rest sites that did not resolve:\n${problems.join('\n')}`).toEqual([]);
  });

  it('HARD-09 every config encryptionKey reference is a listed wiring site or a named exemption', () => {
    // Whether each site resolves is the other test's job; here only the claimed lines matter.
    const claims = new Map<string, number>();
    for (const site of [...ANCHORED_SITES, ...NAMED_EXEMPTIONS]) {
      for (const ref of resolveAnchoredSite(site).claimed) claims.set(ref, (claims.get(ref) ?? 0) + 1);
    }
    const doubleClaimed = [...claims].filter(([, n]) => n > 1).map(([ref, n]) => `${ref} (claimed by ${n} sites)`);

    const unclaimed: string[] = [];
    for (const relPath of allFiles) {
      if (relPath === CONFIG_EXEMPT_FILE) continue;
      readFileSync(join(REPO_ROOT, relPath), 'utf8').split('\n').forEach((line, idx) => {
        if (isCommentLine(line) || !KEY_REFERENCE.test(line)) return;
        if (!claims.has(`${relPath}:${idx + 1}`)) unclaimed.push(`${relPath}:${idx + 1}`);
      });
    }

    expect(doubleClaimed, `lines claimed by more than one site:\n${doubleClaimed.join('\n')}`).toEqual([]);
    expect(unclaimed, `config.encryptionKey references that are neither a listed site nor an exemption:\n${unclaimed.join('\n')}`).toEqual([]);
  });
});
