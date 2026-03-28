import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScanRecord } from '../../src/db/types.js';
import type { StorageAdapter } from '../../src/db/index.js';
import type { ScanOrchestrator } from '../../src/scanner/orchestrator.js';
import type { DashboardConfig } from '../../src/config.js';

import {
  isPrivateHostname,
  validateScanUrl,
  ScanService,
} from '../../src/services/scan-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScan(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    id: 'scan-1',
    siteUrl: 'https://example.com',
    status: 'completed',
    standard: 'WCAG2AA',
    jurisdictions: [],
    createdBy: 'testuser',
    createdAt: '2026-01-01T00:00:00Z',
    orgId: 'org-1',
    ...overrides,
  };
}

function makeStorage(scanOverride?: Partial<ScanRecord> | null) {
  const scan = scanOverride === null ? null : makeScan(scanOverride ?? {});
  return {
    scans: {
      getScan: vi.fn().mockResolvedValue(scan),
      createScan: vi.fn().mockResolvedValue(scan),
      listScans: vi.fn(),
      countScans: vi.fn(),
      updateScan: vi.fn(),
      deleteScan: vi.fn(),
      deleteOrgScans: vi.fn(),
      getReport: vi.fn(),
      getTrendData: vi.fn(),
      getLatestPerSite: vi.fn(),
    },
  } as unknown as StorageAdapter;
}

function makeOrchestrator() {
  return { startScan: vi.fn() } as unknown as ScanOrchestrator;
}

function makeConfig(overrides: Partial<DashboardConfig> = {}) {
  return {
    maxConcurrentScans: 4,
    maxPages: 100,
    runner: 'htmlcs',
    complianceUrl: 'http://compliance:3000',
    ...overrides,
  } as unknown as DashboardConfig;
}

// ---------------------------------------------------------------------------
// isPrivateHostname
// ---------------------------------------------------------------------------

describe('isPrivateHostname', () => {
  it('blocks localhost', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
  });

  it('blocks 127.0.0.1', () => {
    expect(isPrivateHostname('127.0.0.1')).toBe(true);
  });

  it('blocks ::1', () => {
    expect(isPrivateHostname('::1')).toBe(true);
  });

  it('blocks 0.0.0.0', () => {
    expect(isPrivateHostname('0.0.0.0')).toBe(true);
  });

  it('blocks 10.0.0.1 (Class A private)', () => {
    expect(isPrivateHostname('10.0.0.1')).toBe(true);
  });

  it('blocks 192.168.1.1 (Class C private)', () => {
    expect(isPrivateHostname('192.168.1.1')).toBe(true);
  });

  it('blocks 172.16.0.1 (Class B private)', () => {
    expect(isPrivateHostname('172.16.0.1')).toBe(true);
  });

  it('blocks 172.31.255.255 (Class B private upper bound)', () => {
    expect(isPrivateHostname('172.31.255.255')).toBe(true);
  });

  it('allows 172.32.0.1 (NOT private)', () => {
    expect(isPrivateHostname('172.32.0.1')).toBe(false);
  });

  it('blocks 169.254.169.254 (AWS metadata)', () => {
    expect(isPrivateHostname('169.254.169.254')).toBe(true);
  });

  it('blocks 169.254.1.1 (link-local)', () => {
    expect(isPrivateHostname('169.254.1.1')).toBe(true);
  });

  it('blocks server.internal', () => {
    expect(isPrivateHostname('server.internal')).toBe(true);
  });

  it('blocks printer.local', () => {
    expect(isPrivateHostname('printer.local')).toBe(true);
  });

  it('allows example.com (public)', () => {
    expect(isPrivateHostname('example.com')).toBe(false);
  });

  it('allows 8.8.8.8 (public IP)', () => {
    expect(isPrivateHostname('8.8.8.8')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateScanUrl
// ---------------------------------------------------------------------------

describe('validateScanUrl', () => {
  it('returns URL for valid https://example.com', () => {
    const result = validateScanUrl('https://example.com');
    expect(result).toHaveProperty('url');
    expect((result as { url: URL }).url.hostname).toBe('example.com');
  });

  it('returns error for empty string', () => {
    const result = validateScanUrl('');
    expect(result).toHaveProperty('error');
  });

  it('returns error for non-URL string', () => {
    const result = validateScanUrl('not a url at all');
    expect(result).toHaveProperty('error');
  });

  it('returns error for ftp:// protocol', () => {
    const result = validateScanUrl('ftp://example.com');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('http');
  });

  it('returns error for file:/// protocol', () => {
    const result = validateScanUrl('file:///etc/passwd');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('http');
  });

  it('returns error for private IP http://192.168.1.1', () => {
    const result = validateScanUrl('http://192.168.1.1');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('private');
  });

  it('returns error for http://localhost', () => {
    const result = validateScanUrl('http://localhost');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('private');
  });
});

// ---------------------------------------------------------------------------
// ScanService.getScanForOrg
// ---------------------------------------------------------------------------

describe('ScanService.getScanForOrg', () => {
  let service: ScanService;
  let storage: StorageAdapter;

  describe('when scan exists and orgId matches', () => {
    beforeEach(() => {
      storage = makeStorage({ id: 'scan-1', orgId: 'org-1' });
      service = new ScanService(storage, makeOrchestrator(), makeConfig());
    });

    it('returns the scan', async () => {
      const result = await service.getScanForOrg('scan-1', 'org-1');
      expect(result.ok).toBe(true);
      expect(result).toHaveProperty('scan');
      expect((result as { ok: true; scan: ScanRecord }).scan.id).toBe('scan-1');
    });
  });

  describe('when scan does not exist', () => {
    beforeEach(() => {
      storage = makeStorage(null);
      service = new ScanService(storage, makeOrchestrator(), makeConfig());
    });

    it('returns not-found error', async () => {
      const result = await service.getScanForOrg('missing-id', 'org-1');
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toBe('Scan not found');
    });
  });

  describe('when orgId does not match (org isolation)', () => {
    beforeEach(() => {
      storage = makeStorage({ id: 'scan-1', orgId: 'org-1' });
      service = new ScanService(storage, makeOrchestrator(), makeConfig());
    });

    it('returns not-found error for different org', async () => {
      const result = await service.getScanForOrg('scan-1', 'org-other');
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toBe('Scan not found');
    });
  });
});
