import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProfileDir,
  removeProfileDir,
  listInUseProfileDirs,
  sweepStaleChromeProfiles,
  PROFILE_ROOT_DIRNAME,
  PUPPETEER_TEMP_PROFILE_PREFIX,
} from '../../src/browser/profile-dir.js';

const HOUR = 60 * 60 * 1000;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'luqen-profile-test-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** A directory with some content, its mtime set `ageMs` into the past. */
function makeDir(path: string, ageMs: number, now = Date.now()): string {
  mkdirSync(join(path, 'Default'), { recursive: true });
  writeFileSync(join(path, 'Default', 'Preferences'), '{}');
  const t = new Date(now - ageMs);
  utimesSync(path, t, t);
  return path;
}

describe('createProfileDir / removeProfileDir', () => {
  it('PD1: creates a private dir under the luqen-owned root', async () => {
    const root = join(tmp, PROFILE_ROOT_DIRNAME);
    const dir = await createProfileDir(root);
    expect(dir.startsWith(root + '/')).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });

  it('PD2: removes a populated profile dir', async () => {
    const dir = await createProfileDir(join(tmp, PROFILE_ROOT_DIRNAME));
    makeDir(dir, 0);
    expect(await removeProfileDir(dir)).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('PD3: waits for a still-running browser process to exit before removing', async () => {
    const dir = await createProfileDir(join(tmp, PROFILE_ROOT_DIRNAME));
    const proc = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null as string | null });
    let settled = false;
    const pending = removeProfileDir(dir, proc).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);
    expect(existsSync(dir)).toBe(true);
    // The browser writes a last file while dying, then exits.
    writeFileSync(join(dir, 'Last Version'), '1');
    proc.exitCode = 0;
    proc.emit('exit', 0, null);
    expect(await pending).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('PD4: does not wait forever for a process that never exits', async () => {
    const dir = await createProfileDir(join(tmp, PROFILE_ROOT_DIRNAME));
    const proc = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
    expect(await removeProfileDir(dir, proc, 30)).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });
});

describe('listInUseProfileDirs', () => {
  it('IU1: reads --user-data-dir from every process command line', () => {
    const proc = join(tmp, 'proc');
    mkdirSync(join(proc, '101'), { recursive: true });
    mkdirSync(join(proc, '202'), { recursive: true });
    mkdirSync(join(proc, 'self'), { recursive: true });
    writeFileSync(join(proc, '101', 'cmdline'), ['chromium', '--headless=new', '--user-data-dir=/tmp/puppeteer_dev_chrome_profile-abc', ''].join('\0'));
    writeFileSync(join(proc, '202', 'cmdline'), ['node', 'server.js', ''].join('\0'));
    const inUse = listInUseProfileDirs(proc);
    expect(inUse).toEqual(new Set(['/tmp/puppeteer_dev_chrome_profile-abc']));
  });

  it('IU2: no process table means "unknown" (null), never "nothing in use"', () => {
    expect(listInUseProfileDirs(join(tmp, 'no-such-proc'))).toBeNull();
  });

  it('IU3: the real process table of this Linux host is readable', () => {
    if (process.platform !== 'linux') return;
    expect(listInUseProfileDirs()).toBeInstanceOf(Set);
  });
});

describe('sweepStaleChromeProfiles', () => {
  const now = Date.now();

  it('SW1: deletes stale puppeteer and luqen-owned profile dirs', async () => {
    const stalePptr = makeDir(join(tmp, `${PUPPETEER_TEMP_PROFILE_PREFIX}stale1`), 3 * HOUR, now);
    const staleEmpty = join(tmp, `${PUPPETEER_TEMP_PROFILE_PREFIX}empty1`);
    mkdirSync(staleEmpty);
    utimesSync(staleEmpty, new Date(now - 3 * HOUR), new Date(now - 3 * HOUR));
    const staleOwn = makeDir(join(tmp, PROFILE_ROOT_DIRNAME, 'profile-old'), 3 * HOUR, now);
    const result = await sweepStaleChromeProfiles({ tmpDir: tmp, now: () => now, inUse: () => new Set() });
    expect(existsSync(stalePptr)).toBe(false);
    expect(existsSync(staleEmpty)).toBe(false);
    expect(existsSync(staleOwn)).toBe(false);
    expect(result.removed.sort()).toEqual([stalePptr, staleEmpty, staleOwn].sort());
  });

  it('SW2 [in-use]: never deletes a profile a running browser uses, however old', async () => {
    const live = makeDir(join(tmp, `${PUPPETEER_TEMP_PROFILE_PREFIX}live`), 48 * HOUR, now);
    const liveOwn = makeDir(join(tmp, PROFILE_ROOT_DIRNAME, 'profile-live'), 48 * HOUR, now);
    const result = await sweepStaleChromeProfiles({
      tmpDir: tmp,
      now: () => now,
      inUse: () => new Set([live, liveOwn]),
    });
    expect(existsSync(live)).toBe(true);
    expect(existsSync(liveOwn)).toBe(true);
    expect(result.removed).toEqual([]);
    expect(result.keptInUse.sort()).toEqual([live, liveOwn].sort());
  });

  it('SW3: keeps a dir younger than the minimum age', async () => {
    const young = makeDir(join(tmp, `${PUPPETEER_TEMP_PROFILE_PREFIX}young`), 5 * 60 * 1000, now);
    const result = await sweepStaleChromeProfiles({ tmpDir: tmp, now: () => now, inUse: () => new Set() });
    expect(existsSync(young)).toBe(true);
    expect(result.keptYoung).toEqual([young]);
  });

  it('SW4 [fail-safe]: an unreadable process table deletes nothing', async () => {
    const old = makeDir(join(tmp, `${PUPPETEER_TEMP_PROFILE_PREFIX}old`), 48 * HOUR, now);
    const result = await sweepStaleChromeProfiles({ tmpDir: tmp, now: () => now, inUse: () => null });
    expect(existsSync(old)).toBe(true);
    expect(result.skipped).toBe('no-process-table');
    expect(result.removed).toEqual([]);
  });

  it('SW5: ignores unrelated names and never follows a symlink', async () => {
    const other = makeDir(join(tmp, 'some-other-app-dir'), 48 * HOUR, now);
    const target = makeDir(join(tmp, 'precious'), 48 * HOUR, now);
    const link = join(tmp, `${PUPPETEER_TEMP_PROFILE_PREFIX}link`);
    symlinkSync(target, link);
    const result = await sweepStaleChromeProfiles({ tmpDir: tmp, now: () => now, inUse: () => new Set() });
    expect(existsSync(other)).toBe(true);
    expect(existsSync(join(target, 'Default', 'Preferences'))).toBe(true);
    expect(result.removed).toEqual([]);
  });

  it('SW6: a missing tmp dir or profile root is not an error', async () => {
    const result = await sweepStaleChromeProfiles({ tmpDir: join(tmp, 'nope'), now: () => now, inUse: () => new Set() });
    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
