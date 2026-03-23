import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runScan, getStatus, type AgentOptions } from '../src/agent.js';
import type { MonitorConfig } from '../src/config.js';

// ---- Mocks ----

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(() => ({
    complianceUrl: 'https://compliance.test',
    complianceClientId: 'test-id',
    complianceClientSecret: 'test-secret',
    checkInterval: 'manual',
    userAgent: 'test-agent/1.0',
    orgId: undefined,
  })),
}));

vi.mock('../src/sources.js', () => ({
  fetchSource: vi.fn(),
  diffContent: vi.fn(),
}));

vi.mock('../src/analyzer.js', () => ({
  analyzeChanges: vi.fn(),
}));

vi.mock('../src/compliance-client.js', () => ({
  getToken: vi.fn(),
  listSources: vi.fn(),
  proposeUpdate: vi.fn(),
  updateSourceLastChecked: vi.fn(),
}));

vi.mock('../src/local-sources.js', () => ({
  loadLocalSources: vi.fn(),
}));

import { loadConfig } from '../src/config.js';
import { fetchSource, diffContent } from '../src/sources.js';
import { analyzeChanges } from '../src/analyzer.js';
import {
  getToken,
  listSources,
  proposeUpdate,
  updateSourceLastChecked,
} from '../src/compliance-client.js';
import { loadLocalSources } from '../src/local-sources.js';

const mockConfig: MonitorConfig = {
  complianceUrl: 'https://compliance.test',
  complianceClientId: 'test-id',
  complianceClientSecret: 'test-secret',
  checkInterval: 'manual',
  userAgent: 'test-agent/1.0',
  orgId: undefined,
};

const mockSource = {
  id: 'src-1',
  name: 'Test Source',
  url: 'https://example.com/law',
  type: 'html' as const,
  schedule: 'daily' as const,
  lastContentHash: 'old-hash',
  createdAt: '2025-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.mocked(loadConfig).mockReturnValue(mockConfig);
  vi.mocked(getToken).mockResolvedValue('test-token');
  vi.mocked(listSources).mockResolvedValue([mockSource]);
  vi.mocked(fetchSource).mockResolvedValue({
    content: 'fetched content',
    contentHash: 'new-hash',
    url: mockSource.url,
    type: 'html',
    fetchedAt: '2025-06-01T00:00:00Z',
  });
  vi.mocked(diffContent).mockReturnValue({ changed: false, oldHash: 'old-hash', newHash: 'new-hash' });
  vi.mocked(analyzeChanges).mockReturnValue({
    changed: true,
    summary: 'Content updated',
    sections: { added: ['new section'], removed: [], modified: [] },
  });
  vi.mocked(proposeUpdate).mockResolvedValue({
    id: 'prop-1',
    source: mockSource.url,
    detectedAt: '2025-06-01T00:00:00Z',
    type: 'amendment',
    summary: 'Change detected',
    proposedChanges: { action: 'update', entityType: 'regulation' },
    status: 'pending',
    createdAt: '2025-06-01T00:00:00Z',
  });
  vi.mocked(updateSourceLastChecked).mockResolvedValue(undefined);
  vi.mocked(loadLocalSources).mockResolvedValue([mockSource]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- runScan ----

describe('runScan', () => {
  it('returns summary with unchanged sources when no content changed', async () => {
    vi.mocked(diffContent).mockReturnValue({ changed: false, oldHash: 'old-hash', newHash: 'old-hash' });

    const result = await runScan();

    expect(result.scanned).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.changed).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.proposalsCreated).toHaveLength(0);
    expect(result.scannedAt).toBeTruthy();
  });

  it('creates proposal when content has changed', async () => {
    vi.mocked(diffContent).mockReturnValue({ changed: true, oldHash: 'old-hash', newHash: 'new-hash' });

    const result = await runScan();

    expect(result.changed).toBe(1);
    expect(result.proposalsCreated).toHaveLength(1);
    expect(proposeUpdate).toHaveBeenCalledOnce();
    expect(updateSourceLastChecked).toHaveBeenCalled();
  });

  it('uses provided config instead of loadConfig', async () => {
    const customConfig: MonitorConfig = {
      ...mockConfig,
      complianceUrl: 'https://custom.test',
    };

    await runScan({ config: customConfig });

    expect(getToken).toHaveBeenCalledWith(
      'https://custom.test',
      customConfig.complianceClientId,
      customConfig.complianceClientSecret,
    );
  });

  it('uses config orgId when options.orgId is not provided', async () => {
    const configWithOrg: MonitorConfig = { ...mockConfig, orgId: 'config-org' };
    vi.mocked(loadConfig).mockReturnValue(configWithOrg);

    await runScan({ config: configWithOrg });

    expect(listSources).toHaveBeenCalledWith('https://compliance.test', 'test-token', 'config-org');
  });

  it('options.orgId overrides config.orgId', async () => {
    const configWithOrg: MonitorConfig = { ...mockConfig, orgId: 'config-org' };

    await runScan({ config: configWithOrg, orgId: 'override-org' });

    expect(listSources).toHaveBeenCalledWith('https://compliance.test', 'test-token', 'override-org');
  });

  it('updates lastChecked even when unchanged (online mode)', async () => {
    vi.mocked(diffContent).mockReturnValue({ changed: false, oldHash: 'h', newHash: 'h' });

    await runScan();

    expect(updateSourceLastChecked).toHaveBeenCalledOnce();
  });

  it('handles source with no previous hash', async () => {
    vi.mocked(listSources).mockResolvedValue([
      { ...mockSource, lastContentHash: undefined },
    ]);
    vi.mocked(diffContent).mockReturnValue({ changed: true, oldHash: '', newHash: 'new-hash' });

    const result = await runScan();

    expect(diffContent).toHaveBeenCalledWith('', expect.any(String));
    expect(result.changed).toBe(1);
  });

  it('records error details when fetchSource throws', async () => {
    vi.mocked(fetchSource).mockRejectedValueOnce(new Error('Network timeout'));

    const result = await runScan();

    expect(result.errors).toBe(1);
    expect(result.errorDetails).toHaveLength(1);
    expect(result.errorDetails[0].sourceId).toBe('src-1');
    expect(result.errorDetails[0].error).toBe('Network timeout');
  });

  it('records string errors when non-Error is thrown', async () => {
    vi.mocked(fetchSource).mockRejectedValueOnce('string error');

    const result = await runScan();

    expect(result.errorDetails[0].error).toBe('string error');
  });

  it('passes fetchOptions to fetchSource', async () => {
    const fetchOpts = { userAgent: 'custom-agent' };
    vi.mocked(diffContent).mockReturnValue({ changed: false, oldHash: 'h', newHash: 'h' });

    await runScan({ fetchOptions: fetchOpts });

    expect(fetchSource).toHaveBeenCalledWith(
      mockSource.url,
      mockSource.type,
      expect.objectContaining({ userAgent: 'custom-agent' }),
    );
  });

  // ---- Standalone mode (sourcesFile) ----

  describe('standalone mode (sourcesFile)', () => {
    it('uses local sources when sourcesFile is specified', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(diffContent).mockReturnValue({ changed: false, oldHash: 'h', newHash: 'h' });

      const result = await runScan({ sourcesFile: '/path/to/sources.json' });

      expect(loadLocalSources).toHaveBeenCalledWith('/path/to/sources.json');
      expect(getToken).not.toHaveBeenCalled();
      expect(listSources).not.toHaveBeenCalled();
      expect(result.scanned).toBe(1);
      warnSpy.mockRestore();
    });

    it('does not call updateSourceLastChecked in standalone mode', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(diffContent).mockReturnValue({ changed: false, oldHash: 'h', newHash: 'h' });

      await runScan({ sourcesFile: '/path/to/sources.json' });

      expect(updateSourceLastChecked).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('logs change but does not create proposal in standalone mode', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(diffContent).mockReturnValue({ changed: true, oldHash: 'old', newHash: 'new' });

      const result = await runScan({ sourcesFile: '/path/to/sources.json' });

      expect(proposeUpdate).not.toHaveBeenCalled();
      expect(result.proposalsCreated).toHaveLength(0);
      // changed count in standalone = scanned - unchanged - errors
      expect(result.changed).toBe(1);
      warnSpy.mockRestore();
    });
  });

  // ---- Fallback to local sources ----

  describe('compliance service unavailable fallback', () => {
    it('falls back to local sources when getToken fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(getToken).mockRejectedValueOnce(new Error('Connection refused'));
      vi.mocked(diffContent).mockReturnValue({ changed: false, oldHash: 'h', newHash: 'h' });

      const result = await runScan();

      expect(loadLocalSources).toHaveBeenCalledWith();
      expect(result.scanned).toBe(1);
      warnSpy.mockRestore();
    });

    it('does not create proposals in fallback standalone mode', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(getToken).mockRejectedValueOnce(new Error('fail'));
      vi.mocked(diffContent).mockReturnValue({ changed: true, oldHash: 'old', newHash: 'new' });

      const result = await runScan();

      expect(proposeUpdate).not.toHaveBeenCalled();
      expect(result.proposalsCreated).toHaveLength(0);
      warnSpy.mockRestore();
    });
  });

  // ---- Multiple sources ----

  it('processes multiple sources correctly', async () => {
    const source2 = { ...mockSource, id: 'src-2', name: 'Source Two', url: 'https://example.com/two' };
    vi.mocked(listSources).mockResolvedValue([mockSource, source2]);
    vi.mocked(diffContent)
      .mockReturnValueOnce({ changed: false, oldHash: 'h', newHash: 'h' })
      .mockReturnValueOnce({ changed: true, oldHash: 'old', newHash: 'new' });

    const result = await runScan();

    expect(result.scanned).toBe(2);
    expect(result.unchanged).toBe(1);
    expect(result.changed).toBe(1);
  });
});

// ---- getStatus ----

describe('getStatus', () => {
  it('returns monitor status with sources count', async () => {
    const status = await getStatus();

    expect(status.sourcesCount).toBe(1);
    expect(status.complianceUrl).toBe('https://compliance.test');
    expect(status.pendingProposals).toBe(0);
  });

  it('returns most recent lastCheckedAt as lastScanAt', async () => {
    vi.mocked(listSources).mockResolvedValue([
      { ...mockSource, lastCheckedAt: '2025-01-01T00:00:00Z' },
      { ...mockSource, id: 'src-2', lastCheckedAt: '2025-06-01T00:00:00Z' },
    ]);

    const status = await getStatus();

    expect(status.lastScanAt).toBe('2025-06-01T00:00:00Z');
  });

  it('returns null lastScanAt when no sources have been checked', async () => {
    vi.mocked(listSources).mockResolvedValue([
      { ...mockSource, lastCheckedAt: undefined },
    ]);

    const status = await getStatus();

    expect(status.lastScanAt).toBeNull();
  });

  it('uses provided config', async () => {
    const customConfig: MonitorConfig = {
      ...mockConfig,
      complianceUrl: 'https://custom.test',
    };

    const status = await getStatus({ config: customConfig });

    expect(status.complianceUrl).toBe('https://custom.test');
  });

  it('uses options.orgId over config.orgId', async () => {
    await getStatus({ orgId: 'my-org' });

    expect(listSources).toHaveBeenCalledWith('https://compliance.test', 'test-token', 'my-org');
  });

  it('propagates errors from getToken', async () => {
    vi.mocked(getToken).mockRejectedValueOnce(new Error('Auth failed'));

    await expect(getStatus()).rejects.toThrow('Auth failed');
  });
});
