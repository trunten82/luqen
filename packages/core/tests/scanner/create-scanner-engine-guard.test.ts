/**
 * ENGINE-SSRF-1 — createScanner threads ONE SSRF policy (from
 * `allowPrivateTargets`) to discovery AND to every engine that loads a
 * scanned page in a browser. The real-browser proof that each engine honours
 * the policy lives in tests/behavioral/engine-pageload-ssrf.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScanner } from '../../src/index.js';
import * as discoverModule from '../../src/discovery/discover.js';
import * as scannerModule from '../../src/scanner/scanner.js';
import * as behavioralModule from '../../src/behavioral/index.js';
import * as lighthouseModule from '../../src/lighthouse/index.js';
import * as ibmModule from '../../src/ibm/index.js';
import * as reflowModule from '../../src/reflow/index.js';
import * as a11yTreeModule from '../../src/a11y-tree/index.js';

vi.mock('../../src/discovery/discover.js');
vi.mock('../../src/scanner/scanner.js');
vi.mock('../../src/behavioral/index.js');
vi.mock('../../src/lighthouse/index.js');
vi.mock('../../src/ibm/index.js');
vi.mock('../../src/reflow/index.js');
vi.mock('../../src/a11y-tree/index.js');

const START_URL = 'https://example.com/';
const EMPTY = { issues: [], pagesChecked: 1, errors: [] };

const ENGINE_MOCKS = [
  ['behavioral', vi.mocked(behavioralModule.runBehavioralChecks)],
  ['lighthouse', vi.mocked(lighthouseModule.runLighthouseChecks)],
  ['ibm', vi.mocked(ibmModule.runIbmChecks)],
  ['reflow', vi.mocked(reflowModule.runReflowChecks)],
  ['a11y-tree', vi.mocked(a11yTreeModule.runA11yTreeChecks)],
] as const;

function deepScanner(allowPrivateTargets?: boolean) {
  return createScanner({
    singlePage: true,
    behavioral: true,
    lighthouse: true,
    ibm: true,
    reflow: true,
    a11yTree: true,
    ...(allowPrivateTargets !== undefined ? { allowPrivateTargets } : {}),
  });
}

/** The DirectScanner createScanner handed to scanUrls, as the guard sees it. */
function directScannerGuard(): unknown {
  const client = vi.mocked(scannerModule.scanUrls).mock.calls[0][1] as unknown as { guard: unknown };
  return client.guard;
}

describe('createScanner() — engine SSRF guard threading (ENGINE-SSRF-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(discoverModule.discoverUrls).mockResolvedValue({ urls: [{ url: START_URL, discoveryMethod: 'crawl' }] });
    vi.mocked(scannerModule.scanUrls).mockResolvedValue({
      pages: [{ url: START_URL, issues: [], issueCount: 0, discoveryMethod: 'crawl' } as never],
      errors: [],
    });
    for (const [, mock] of ENGINE_MOCKS) mock.mockResolvedValue(EMPTY as never);
  });

  it.each(ENGINE_MOCKS)('[engine-guard] %s gets the strict guard by default', async (_name, mock) => {
    await deepScanner().scan(START_URL);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][1]).toMatchObject({ guard: { allowPrivate: false } });
  });

  it.each(ENGINE_MOCKS)('[engine-guard] %s gets the operator opt-out when allowPrivateTargets is set', async (_name, mock) => {
    await deepScanner(true).scan(START_URL);
    expect(mock.mock.calls[0][1]).toMatchObject({ guard: { allowPrivate: true } });
  });

  it('[engine-guard] the pa11y DirectScanner is constructed with the same policy', async () => {
    await deepScanner().scan(START_URL);
    expect(directScannerGuard()).toEqual({ allowPrivate: false });
    vi.mocked(scannerModule.scanUrls).mockClear();
    await deepScanner(true).scan(START_URL);
    expect(directScannerGuard()).toEqual({ allowPrivate: true });
  });
});
