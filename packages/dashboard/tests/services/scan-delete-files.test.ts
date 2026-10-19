/**
 * HARD-18: deleteScanAndFiles (src/services/scan-delete-access.ts), the one function that removes a scan
 * row, removes the scan's stored report file first and only from the configured reports directory.
 *
 * - A file that is already gone does not stop the delete.
 * - Any other failure to remove the file keeps the row, writes one warning without the path, and
 *   rejects, so the caller answers a server error and the delete can be retried.
 * - A stored path that does not resolve inside the reports directory is never removed: the row is
 *   kept and one warning is written.
 *
 * `unlink` is wrapped (behaviour unchanged) so one test can make it fail with EACCES, which a test
 * running as root cannot produce on a real file.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteScanAndFiles } from '../../src/services/scan-delete-access.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, unlink: vi.fn(actual.unlink) };
});

let root: string;
let reportsDir: string;
let outsideDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'luqen-scan-delete-unit-'));
  reportsDir = join(root, 'reports');
  outsideDir = join(root, 'elsewhere');
  mkdirSync(reportsDir);
  mkdirSync(outsideDir);
});

afterEach(() => {
  vi.mocked(fsPromises.unlink).mockClear();
  rmSync(root, { recursive: true, force: true });
});

function harness() {
  const deleteScan = vi.fn(async (_id: string) => undefined);
  const warn = vi.fn();
  return { storage: { scans: { deleteScan } }, deleteScan, warn, options: { reportsDir, log: { warn } } };
}

function fileAt(path: string): string {
  writeFileSync(path, '{"pages":[]}');
  return path;
}

/** Every logged value, as one string, to check that no path reached the log. */
const logged = (warn: ReturnType<typeof vi.fn>): string => JSON.stringify(warn.mock.calls);

describe('HARD-18 deleteScanAndFiles', () => {
  it('HARD-18 a report file inside the reports directory is removed with the row', async () => {
    const h = harness();
    const file = fileAt(join(reportsDir, 'site-1.json'));
    await deleteScanAndFiles(h.storage, { id: 'scan-1', jsonReportPath: file }, h.options);
    expect(existsSync(file)).toBe(false);
    expect(h.deleteScan).toHaveBeenCalledWith('scan-1');
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('HARD-18 a report file that is already gone does not stop the delete', async () => {
    const h = harness();
    await deleteScanAndFiles(h.storage, { id: 'scan-2', jsonReportPath: join(reportsDir, 'gone.json') }, h.options);
    expect(h.deleteScan).toHaveBeenCalledWith('scan-2');
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('HARD-18 a report file that cannot be removed keeps the scan row', async () => {
    const h = harness();
    const file = fileAt(join(reportsDir, 'site-3.json'));
    vi.mocked(fsPromises.unlink).mockRejectedValueOnce(
      Object.assign(new Error(`EACCES: permission denied, unlink '${file}'`), { code: 'EACCES' }),
    );
    await expect(deleteScanAndFiles(h.storage, { id: 'scan-3', jsonReportPath: file }, h.options))
      .rejects.toThrow('The scan could not be deleted');
    expect(h.deleteScan).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0]?.[0]).toEqual({ scanId: 'scan-3', code: 'EACCES' });
    expect(logged(h.warn)).not.toContain(root);
  });

  it('HARD-18 a stored report path outside the reports directory is never removed', async () => {
    const h = harness();
    const file = fileAt(join(outsideDir, 'site-4.json'));
    await expect(deleteScanAndFiles(h.storage, { id: 'scan-4', jsonReportPath: file }, h.options))
      .rejects.toThrow('The scan could not be deleted');
    expect(existsSync(file)).toBe(true);
    expect(h.deleteScan).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0]?.[0]).toEqual({ scanId: 'scan-4', reason: 'outside-reports-dir' });
    expect(logged(h.warn)).not.toContain(root);
  });

  it('HARD-18 a report path that climbs out of the reports directory is never removed', async () => {
    const h = harness();
    const file = fileAt(join(outsideDir, 'site-5.json'));
    const climbing = `${reportsDir}/../elsewhere/site-5.json`;
    await expect(deleteScanAndFiles(h.storage, { id: 'scan-5', jsonReportPath: climbing }, h.options))
      .rejects.toThrow('The scan could not be deleted');
    expect(existsSync(file)).toBe(true);
    expect(h.deleteScan).not.toHaveBeenCalled();
  });

  it('HARD-18 a directory whose name starts with the reports directory name counts as outside it', async () => {
    const h = harness();
    const sibling = `${reportsDir}-old`;
    mkdirSync(sibling);
    const file = fileAt(join(sibling, 'site-6.json'));
    await expect(deleteScanAndFiles(h.storage, { id: 'scan-6', jsonReportPath: file }, h.options))
      .rejects.toThrow('The scan could not be deleted');
    expect(existsSync(file)).toBe(true);
    expect(h.deleteScan).not.toHaveBeenCalled();
  });

  it('HARD-18 a scan without a stored report file is deleted without touching the file system', async () => {
    const h = harness();
    await deleteScanAndFiles(h.storage, { id: 'scan-7' }, h.options);
    expect(h.deleteScan).toHaveBeenCalledWith('scan-7');
    expect(fsPromises.unlink).not.toHaveBeenCalled();
  });
});
