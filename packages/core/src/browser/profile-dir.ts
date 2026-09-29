/**
 * Chromium profile (`--user-data-dir`) lifecycle — PROFILE-CLEANUP-1.
 *
 * Every browser a luqen engine launches gets its own profile directory under a
 * luqen-owned root (`<tmpdir>/luqen-chrome/profile-XXXXXX`), created before the
 * launch and removed once the browser process has exited — whether it was
 * closed or crashed. The root makes ownership unambiguous for the startup sweep.
 *
 * {@link sweepStaleChromeProfiles} reclaims directories left behind by a
 * process that died before it could clean up (SIGKILL, OOM kill, crash loop).
 * It covers luqen's own root AND puppeteer's default
 * `<tmpdir>/puppeteer_dev_chrome_profile-*` dirs, because third-party scanner
 * plugins (e.g. the axe plugin, a separate repository) launch puppeteer with
 * its default temporary profile and are outside this module's reach.
 *
 * The sweep NEVER deletes a profile a running Chromium uses: it reads every
 * process's `--user-data-dir=` from `/proc/<pid>/cmdline`, and if that table
 * cannot be read it deletes nothing at all.
 */

import { once } from 'node:events';
import { lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const PROFILE_ROOT_DIRNAME = 'luqen-chrome';
export const PUPPETEER_TEMP_PROFILE_PREFIX = 'puppeteer_dev_chrome_profile-';
const OWN_PROFILE_PREFIX = 'profile-';

/** Default wait for a browser process to exit before its profile is removed. */
const PROCESS_EXIT_WAIT_MS = 5_000;
/** Default minimum age before the sweep considers a directory stale. */
const DEFAULT_MIN_AGE_MS = 60 * 60 * 1000;

const RM_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;

/** `<tmpdir>/luqen-chrome` — the root every luqen-launched profile lives under. */
export function defaultProfileRoot(): string {
  return join(tmpdir(), PROFILE_ROOT_DIRNAME);
}

/** Create a fresh, private profile dir under `root`. */
export async function createProfileDir(root: string = defaultProfileRoot()): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  return mkdtemp(join(root, OWN_PROFILE_PREFIX));
}

/** The slice of a ChildProcess needed to know whether the browser has exited. */
export interface ExitObservable {
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  once(event: 'exit', listener: (...args: unknown[]) => void): unknown;
}

function isRunning(proc: ExitObservable | null | undefined): proc is ExitObservable {
  return proc != null && proc.exitCode === null && proc.signalCode === null;
}

async function waitForExit(proc: ExitObservable, waitMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((done) => {
    timer = setTimeout(done, waitMs);
  });
  try {
    await Promise.race([once(proc as unknown as NodeJS.EventEmitter, 'exit'), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Remove a profile dir, first waiting (bounded) for the browser that uses it to
 * exit — a dying Chromium still writes into its profile, and removing the tree
 * underneath it leaves an empty shell behind. Never throws; resolves `true`
 * when the directory is gone.
 */
export async function removeProfileDir(
  dir: string,
  proc?: ExitObservable | null,
  waitMs: number = PROCESS_EXIT_WAIT_MS,
): Promise<boolean> {
  if (isRunning(proc)) {
    await waitForExit(proc, waitMs);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await rm(dir, RM_OPTIONS);
    } catch {
      // retried once below; reported through the return value
    }
    if (!existsSync(dir)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return !existsSync(dir);
}

/**
 * Every `--user-data-dir` a live process was started with, read from
 * `/proc/<pid>/cmdline`. `null` when the process table cannot be read — callers
 * must treat that as "unknown", never as "nothing is in use".
 */
export function listInUseProfileDirs(procRoot = '/proc'): Set<string> | null {
  let pids: string[];
  try {
    pids = readdirSync(procRoot).filter((name) => /^\d+$/.test(name));
  } catch {
    return null;
  }
  const inUse = new Set<string>();
  for (const pid of pids) {
    let cmdline: string;
    try {
      cmdline = readFileSync(join(procRoot, pid, 'cmdline'), 'utf8');
    } catch {
      continue; // the process exited while we were reading
    }
    for (const arg of cmdline.split('\0')) {
      if (arg.startsWith('--user-data-dir=')) {
        inUse.add(resolve(arg.slice('--user-data-dir='.length)));
      }
    }
  }
  return inUse;
}

export interface SweepOptions {
  /** Directory holding puppeteer's temporary profiles. Default `os.tmpdir()`. */
  readonly tmpDir?: string;
  /** luqen's own profile root. Default `<tmpDir>/luqen-chrome`. */
  readonly profileRoot?: string;
  /** A dir younger than this is kept (launch-in-progress race). Default 1 h. */
  readonly minAgeMs?: number;
  readonly now?: () => number;
  /** Profiles in use by a live process; `null` = unknown (sweep nothing). */
  readonly inUse?: () => Set<string> | null;
}

export interface SweepResult {
  readonly removed: string[];
  readonly keptInUse: string[];
  readonly keptYoung: string[];
  readonly errors: { readonly path: string; readonly message: string }[];
  /** Set when the sweep deliberately did nothing. */
  readonly skipped?: 'no-process-table';
}

async function listCandidates(dir: string, prefix: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.startsWith(prefix)).map((name) => join(dir, name));
  } catch {
    return []; // a missing directory has nothing to sweep
  }
}

/**
 * Best-effort startup sweep of stale Chromium profile dirs. Deletes a
 * candidate only when it is a real directory (never a symlink), owned by this
 * user, older than `minAgeMs`, and not the `--user-data-dir` of any live process.
 */
export async function sweepStaleChromeProfiles(opts: SweepOptions = {}): Promise<SweepResult> {
  const tmp = opts.tmpDir ?? tmpdir();
  const root = opts.profileRoot ?? join(tmp, PROFILE_ROOT_DIRNAME);
  const minAgeMs = opts.minAgeMs ?? DEFAULT_MIN_AGE_MS;
  const now = (opts.now ?? Date.now)();
  const result: SweepResult = { removed: [], keptInUse: [], keptYoung: [], errors: [] };

  const inUse = (opts.inUse ?? listInUseProfileDirs)();
  if (inUse === null) return { ...result, skipped: 'no-process-table' };

  const candidates = [
    ...(await listCandidates(tmp, PUPPETEER_TEMP_PROFILE_PREFIX)),
    ...(await listCandidates(root, OWN_PROFILE_PREFIX)),
  ];
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;

  for (const path of candidates) {
    try {
      const st = await lstat(path);
      if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) continue;
      if (inUse.has(resolve(path))) {
        result.keptInUse.push(path);
      } else if (now - st.mtimeMs < minAgeMs) {
        result.keptYoung.push(path);
      } else {
        await rm(path, RM_OPTIONS);
        result.removed.push(path);
      }
    } catch (err) {
      result.errors.push({ path, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
