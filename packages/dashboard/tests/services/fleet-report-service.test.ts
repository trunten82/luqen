import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { buildFleetReportBundle, FLEET_REPORT_MAX_SITES } from '../../src/services/fleet-report-service.js';
import type { StorageAdapter } from '../../src/db/adapter.js';
import type { ScanRecord } from '../../src/db/types.js';

function scan(partial: Partial<ScanRecord> & { id: string; siteUrl: string }): ScanRecord {
  return {
    status: 'completed',
    standard: 'WCAG2AA',
    jurisdictions: [],
    regulations: [],
    createdBy: 'u',
    createdAt: '2026-05-31T00:00:00Z',
    orgId: 'system',
    ...partial,
  } as ScanRecord;
}

// A minimal report JSON the normalizer accepts.
const REPORT_JSON = {
  summary: { pagesScanned: 1, totalIssues: 0, byLevel: { error: 0, warning: 0, notice: 0 } },
  pages: [{ url: 'https://a.example.com', issues: [] }],
};

function makeStorage(scans: ScanRecord[]): StorageAdapter {
  return {
    scans: {
      getLatestPerSite: async () => scans,
      getReport: async () => REPORT_JSON,
      getScansForSite: async (_o: string, siteUrl: string) => scans.filter((s) => s.siteUrl === siteUrl),
    },
    manualTests: { getManualTests: async () => [] },
    remediationEvents: { listForSite: async () => [] },
  } as unknown as StorageAdapter;
}

// gzip magic bytes.
function isGzip(buf: Buffer): boolean {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

describe('buildFleetReportBundle', () => {
  it('returns a valid gzip with just a MANIFEST when the org has no completed scans', async () => {
    const res = await buildFleetReportBundle(makeStorage([]), 'system', { generatedAt: '2026-05-31' });
    expect(isGzip(res.buffer)).toBe(true);
    expect(res.included).toBe(0);
    expect(res.candidates).toBe(0);
    expect(res.truncated).toBe(0);
    // The tar contains a MANIFEST.txt — its plaintext survives gunzip of the outer layer.
    const inner = gunzipSync(res.buffer);
    expect(inner.toString('latin1')).toContain('MANIFEST.txt');
  });

  it('includes one VPAT PDF per completed site and reports counts', async () => {
    const res = await buildFleetReportBundle(
      makeStorage([
        scan({ id: 's1', siteUrl: 'https://a.example.com' }),
        scan({ id: 's2', siteUrl: 'https://b.example.com' }),
      ]),
      'system',
      { generatedAt: '2026-05-31' },
    );
    expect(isGzip(res.buffer)).toBe(true);
    expect(res.candidates).toBe(2);
    expect(res.included).toBe(2);
    expect(res.truncated).toBe(0);
    const inner = gunzipSync(res.buffer).toString('latin1');
    expect(inner).toContain('vpat_a.example.com.pdf');
    expect(inner).toContain('vpat_b.example.com.pdf');
  });

  it('excludes non-completed scans', async () => {
    const res = await buildFleetReportBundle(
      makeStorage([
        scan({ id: 's1', siteUrl: 'https://a.example.com' }),
        scan({ id: 's2', siteUrl: 'https://b.example.com', status: 'running' }),
      ]),
      'system',
      { generatedAt: '2026-05-31' },
    );
    expect(res.candidates).toBe(1);
    expect(res.included).toBe(1);
  });

  it('caps at FLEET_REPORT_MAX_SITES and reports the remainder as truncated', async () => {
    const many = Array.from({ length: FLEET_REPORT_MAX_SITES + 5 }, (_, i) =>
      scan({ id: `s${i}`, siteUrl: `https://s${i}.example.com` }),
    );
    const res = await buildFleetReportBundle(makeStorage(many), 'system', { generatedAt: '2026-05-31' });
    expect(res.candidates).toBe(FLEET_REPORT_MAX_SITES + 5);
    expect(res.included).toBe(FLEET_REPORT_MAX_SITES);
    expect(res.truncated).toBe(5);
  });
});
