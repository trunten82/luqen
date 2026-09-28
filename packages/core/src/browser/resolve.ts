/**
 * The ONE Chromium/Chrome executable resolver used by every launch site in
 * packages/*\/src (CHROMIUM-RESOLVE-1). Every candidate path considered is
 * recorded in `tried`, in the order it was checked, so a resolution failure
 * can name every place that was looked at (the loud startup log + /health
 * check in Task 4 depend on this).
 *
 * Resolution order:
 *   1. env PUPPETEER_EXECUTABLE_PATH, when set.
 *   2. Known system binaries: /usr/bin/chromium, /usr/bin/chromium-browser,
 *      /usr/bin/google-chrome, /usr/bin/google-chrome-stable.
 *   3. The puppeteer download cache (env PUPPETEER_CACHE_DIR, else
 *      ~/.cache/puppeteer), newest version dir first — a version dir is
 *      accepted ONLY when its chrome binary FILE actually exists (an empty
 *      download dir, the measured prod root cause, is skipped).
 *   4. A playwright chromium install (~/.cache/ms-playwright), entries
 *      starting with exactly 'chromium-' (never 'chromium_headless_shell-'),
 *      newest first.
 *   5. puppeteer's own `executablePath()` — accepted only if that file
 *      exists. A throw from puppeteer's own resolver is swallowed and
 *      recorded as an attempt, never propagated.
 *
 * Nothing resolved -> throws {@link ChromiumNotFoundError} naming every
 * tried path. No caller may fall through to a bare `puppeteer.launch()`,
 * which is exactly what picks an empty/broken cache dir on prod.
 *
 * Deliberately NOT memoized: resolution is a handful of `stat` calls and
 * must reflect a browser installed (or fixed) after process startup.
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadPuppeteer } from './puppeteer-runtime.js';

export type ChromiumSource = 'env' | 'system' | 'puppeteer-cache' | 'playwright' | 'puppeteer';

export interface ResolvedChromium {
  readonly executablePath: string;
  readonly source: ChromiumSource;
  readonly tried: readonly string[];
}

export type ChromiumProbe =
  | { readonly ok: true; readonly executablePath: string; readonly source: ChromiumSource }
  | { readonly ok: false; readonly tried: readonly string[] };

export class ChromiumNotFoundError extends Error {
  override readonly name = 'ChromiumNotFoundError';
  readonly code = 'CHROMIUM_NOT_FOUND' as const;
  readonly tried: readonly string[];

  constructor(tried: readonly string[]) {
    super(
      'No Chromium/Chrome executable could be resolved. Tried:\n' +
        tried.map((p) => `  - ${p}`).join('\n') +
        '\nSet PUPPETEER_EXECUTABLE_PATH or install a system Chromium (e.g. `apt install chromium`).',
    );
    this.tried = tried;
    Object.setPrototypeOf(this, ChromiumNotFoundError.prototype);
  }
}

export interface ResolveChromiumDeps {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
  readonly fileExists?: (path: string) => boolean;
  /** Lists entry names of `dir`; returns [] when the directory does not exist. */
  readonly listDir?: (dir: string) => readonly string[];
  readonly puppeteerExecutablePath?: () => Promise<string> | string;
}

function defaultListDir(dir: string): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

async function defaultPuppeteerExecutablePath(): Promise<string> {
  const puppeteer = await loadPuppeteer();
  return puppeteer.executablePath();
}

function resolvedDeps(deps: ResolveChromiumDeps): Required<ResolveChromiumDeps> {
  const env = deps.env ?? process.env;
  return {
    env,
    homeDir: deps.homeDir ?? (env['HOME'] ?? homedir()),
    fileExists: deps.fileExists ?? existsSync,
    listDir: deps.listDir ?? defaultListDir,
    puppeteerExecutablePath: deps.puppeteerExecutablePath ?? defaultPuppeteerExecutablePath,
  };
}

const SYSTEM_BINARIES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
] as const;

/** Extracts the dotted version substring after the last '-' in an entry name. */
function extractVersion(entry: string): number[] | null {
  const idx = entry.lastIndexOf('-');
  if (idx === -1) return null;
  const raw = entry.slice(idx + 1);
  const parts = raw.split('.').map((p) => Number(p));
  if (parts.length === 0 || parts.some((p) => Number.isNaN(p))) return null;
  return parts;
}

/** Sorts entry names newest-version-first; unparseable entries sort last. */
function sortNewestFirst(entries: readonly string[]): string[] {
  return [...entries].sort((a, b) => {
    const va = extractVersion(a);
    const vb = extractVersion(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const len = Math.max(va.length, vb.length);
    for (let i = 0; i < len; i++) {
      const diff = (vb[i] ?? 0) - (va[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

export async function resolveChromium(deps: ResolveChromiumDeps = {}): Promise<ResolvedChromium> {
  const d = resolvedDeps(deps);
  const tried: string[] = [];

  // 1. Explicit env override.
  const envPath = d.env['PUPPETEER_EXECUTABLE_PATH'];
  if (envPath) {
    tried.push(envPath);
    if (d.fileExists(envPath)) {
      return { executablePath: envPath, source: 'env', tried };
    }
  }

  // 2. Known system binaries, in the documented order.
  for (const candidate of SYSTEM_BINARIES) {
    tried.push(candidate);
    if (d.fileExists(candidate)) {
      return { executablePath: candidate, source: 'system', tried };
    }
  }

  // 3. Puppeteer's own download cache — newest version dir first, accepted
  //    only when the chrome binary FILE exists (skips an empty download dir).
  const puppeteerCacheRoot = d.env['PUPPETEER_CACHE_DIR'] ?? join(d.homeDir, '.cache', 'puppeteer');
  const puppeteerChromeDir = join(puppeteerCacheRoot, 'chrome');
  const puppeteerEntries = d.listDir(puppeteerChromeDir);
  if (puppeteerEntries.length === 0) {
    tried.push(puppeteerChromeDir);
  } else {
    for (const entry of sortNewestFirst(puppeteerEntries)) {
      const candidate = join(puppeteerChromeDir, entry, 'chrome-linux64', 'chrome');
      tried.push(candidate);
      if (d.fileExists(candidate)) {
        return { executablePath: candidate, source: 'puppeteer-cache', tried };
      }
    }
  }

  // 4. A playwright chromium install — entries starting with exactly
  //    'chromium-' (never 'chromium_headless_shell-'), newest first.
  const playwrightRoot = join(d.homeDir, '.cache', 'ms-playwright');
  const playwrightEntries = d.listDir(playwrightRoot).filter((entry) => entry.startsWith('chromium-'));
  if (playwrightEntries.length === 0) {
    tried.push(playwrightRoot);
  } else {
    for (const entry of sortNewestFirst(playwrightEntries)) {
      const candidate = join(playwrightRoot, entry, 'chrome-linux64', 'chrome');
      tried.push(candidate);
      if (d.fileExists(candidate)) {
        return { executablePath: candidate, source: 'playwright', tried };
      }
    }
  }

  // 5. puppeteer's own resolver — a throw is swallowed and recorded, never
  //    propagated.
  try {
    const ownPath = await d.puppeteerExecutablePath();
    if (ownPath) {
      tried.push(ownPath);
      if (d.fileExists(ownPath)) {
        return { executablePath: ownPath, source: 'puppeteer', tried };
      }
    }
  } catch {
    // Swallowed — nothing further to record; the throw itself is not a path.
  }

  throw new ChromiumNotFoundError(tried);
}

/** Wraps {@link resolveChromium}; never throws. */
export async function probeChromium(deps: ResolveChromiumDeps = {}): Promise<ChromiumProbe> {
  try {
    const resolved = await resolveChromium(deps);
    return { ok: true, executablePath: resolved.executablePath, source: resolved.source };
  } catch (err) {
    if (err instanceof ChromiumNotFoundError) {
      return { ok: false, tried: err.tried };
    }
    return { ok: false, tried: [] };
  }
}
