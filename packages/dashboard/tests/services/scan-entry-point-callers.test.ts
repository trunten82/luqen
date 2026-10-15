/**
 * Each scan entry point is called only from the files it is meant for.
 *
 * The scan service's methods that start or control scans without a request (the scheduled
 * start, the stored-row start, startup recovery) and the permissioned retry and cancel entries
 * have a fixed set of callers. A call from anywhere else is a new way to start or control a
 * scan and has to be added here on purpose.
 */
import { describe, it, expect } from 'vitest';
import { join, sep } from 'node:path';
import { isCommentLine, readSources } from '../helpers/source-walk.js';

const SRC_ROOT = join(__dirname, '..', '..', 'src');
const at = (...parts: string[]): string => parts.join(sep);

const SCAN_SERVICE = at('services', 'scan-service.ts');
const LIFECYCLE = at('services', 'scan-lifecycle.ts');
const SCHEDULER = 'scheduler.ts';
const SERVER = 'server.ts';
const SCAN_ROUTES = at('routes', 'scan.ts');

/** Entry point name, and every source file (relative to src) that may mention a call to it. */
export const ENTRY_POINT_CALLERS: Readonly<Record<string, readonly string[]>> = {
  startScheduledScan: [SCAN_SERVICE, SCHEDULER],
  runDueSchedules: [SCHEDULER],
  startScheduler: [SCHEDULER, SERVER],
  startStoredScan: [SCAN_SERVICE, LIFECYCLE],
  recoverQueuedScans: [SCAN_SERVICE, LIFECYCLE, SERVER],
  retryScan: [SCAN_SERVICE, LIFECYCLE],
  cancelScan: [SCAN_SERVICE, LIFECYCLE],
  retryScanAuthorized: [SCAN_SERVICE, SCAN_ROUTES],
  cancelScanAuthorized: [SCAN_SERVICE, SCAN_ROUTES],
};

/** For each entry point, the files in `sources` with a non-comment line calling it. */
export function callersByEntryPoint(
  sources: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  for (const name of Object.keys(ENTRY_POINT_CALLERS)) {
    const call = new RegExp(`(^|[^A-Za-z0-9_])${name}\\(`);
    const files = [...sources.entries()]
      .filter(([, text]) => text.split('\n').some((line) => !isCommentLine(line) && call.test(line)))
      .map(([file]) => file);
    found.set(name, files);
  }
  return found;
}

describe('scan entry point callers', () => {
  it('entry points: every call sits in a file that is meant to make it', () => {
    const found = callersByEntryPoint(readSources(SRC_ROOT));
    for (const [name, allowed] of Object.entries(ENTRY_POINT_CALLERS)) {
      const offenders = (found.get(name) ?? []).filter((file) => !allowed.includes(file));
      expect(offenders, `${name} is called from a file outside its callers`).toEqual([]);
    }
  });

  it('entry points: the walker finds the real call for each entry point', () => {
    const found = callersByEntryPoint(readSources(SRC_ROOT));
    for (const name of Object.keys(ENTRY_POINT_CALLERS)) {
      expect(found.get(name) ?? [], `no call to ${name} was found: the matcher cannot see it`).not.toEqual([]);
    }
  });

  it('entry points: a call in a file outside the list is reported and a comment mention is not', () => {
    const sources = new Map<string, string>([
      [at('routes', 'extra.ts'), 'await app.scanService.startScheduledScan(schedule, now);\n'],
      [at('routes', 'note.ts'), '// startScheduledScan( is described here\n/* recoverQueuedScans( */\n'],
      [at('routes', 'name.ts'), 'const retryScanAuthorizedHelper = 1; mystartScheduledScan(1);\n'],
    ]);
    const found = callersByEntryPoint(sources);
    expect(found.get('startScheduledScan')).toEqual([at('routes', 'extra.ts')]);
    expect(found.get('recoverQueuedScans')).toEqual([]);
    expect(found.get('retryScan')).toEqual([]);
  });
});
