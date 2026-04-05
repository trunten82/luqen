import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/compliance-client.js', () => ({
  listJurisdictions: vi.fn(),
  listRegulations: vi.fn(),
  checkCompliance: vi.fn(),
}));

vi.mock('../../src/auth/service-token.js', () => ({
  ServiceTokenManager: vi.fn().mockImplementation(() => ({
    getToken: vi.fn().mockResolvedValue('mock-global-token'),
    destroy: vi.fn(),
  })),
}));

import { ComplianceService } from '../../src/services/compliance-service.js';
import { ServiceTokenManager } from '../../src/auth/service-token.js';
import {
  listJurisdictions,
  listRegulations,
} from '../../src/compliance-client.js';
import type { DashboardConfig } from '../../src/config.js';
import type { OrgRepository } from '../../src/db/interfaces/org-repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<DashboardConfig> = {}): DashboardConfig {
  return {
    port: 5000,
    complianceUrl: 'http://localhost:4000',
    webserviceUrl: 'http://localhost:3000',
    reportsDir: '/tmp/reports',
    dbPath: '/tmp/test.db',
    sessionSecret: 'test-secret-at-least-32-characters',
    maxConcurrentScans: 2,
    maxPages: 100,
    complianceClientId: 'dashboard',
    complianceClientSecret: 'secret',
    runner: 'htmlcs',
    ...overrides,
  };
}

function makeJurisdiction(id: string, name: string) {
  return { id, name, type: 'country', iso3166: id.toUpperCase() };
}

function makeRegulation(id: string, name: string, shortName: string, jurisdictionId: string) {
  return { id, name, shortName, jurisdictionId, enforcementDate: '2025-01-01' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComplianceService', () => {
  let config: DashboardConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = makeConfig();
  });

  // ── getOrgToken ──────────────────────────────────────────────────────────

  describe('getOrgToken()', () => {
    it('returns org-specific token when org has credentials', async () => {
      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('global-token'),
        destroy: vi.fn(),
      };

      // Mock ServiceTokenManager constructor for org-level manager creation
      const orgTokenManager = {
        getToken: vi.fn().mockResolvedValue('org-specific-token'),
        destroy: vi.fn(),
      };
      (ServiceTokenManager as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        function () { return orgTokenManager; },
      );

      const orgRepo: OrgRepository = {
        getOrgComplianceCredentials: vi.fn().mockResolvedValue({
          clientId: 'org-client-id',
          clientSecret: 'org-client-secret',
        }),
        updateOrgComplianceClient: vi.fn(),
      } as unknown as OrgRepository;

      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager, orgRepo);
      const token = await service.getOrgToken('org-1');

      expect(token).toBe('org-specific-token');
      expect(orgRepo.getOrgComplianceCredentials).toHaveBeenCalledWith('org-1');
    });

    it('falls back to global token when org has no credentials', async () => {
      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('global-fallback-token'),
        destroy: vi.fn(),
      };

      const orgRepo: OrgRepository = {
        getOrgComplianceCredentials: vi.fn().mockResolvedValue(null),
        updateOrgComplianceClient: vi.fn(),
      } as unknown as OrgRepository;

      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager, orgRepo);
      const token = await service.getOrgToken('org-1');

      expect(token).toBe('global-fallback-token');
    });

    it('falls back to global token when orgRepository is undefined', async () => {
      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('global-fallback-token'),
        destroy: vi.fn(),
      };

      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager);
      const token = await service.getOrgToken('org-1');

      expect(token).toBe('global-fallback-token');
    });

    it('caches token managers per org (second call reuses cached)', async () => {
      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('global-token'),
        destroy: vi.fn(),
      };

      const orgTokenManager = {
        getToken: vi.fn().mockResolvedValue('org-cached-token'),
        destroy: vi.fn(),
      };
      (ServiceTokenManager as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        function () { return orgTokenManager; },
      );

      const orgRepo: OrgRepository = {
        getOrgComplianceCredentials: vi.fn().mockResolvedValue({
          clientId: 'org-client-id',
          clientSecret: 'org-client-secret',
        }),
        updateOrgComplianceClient: vi.fn(),
      } as unknown as OrgRepository;

      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager, orgRepo);
      await service.getOrgToken('org-1');
      await service.getOrgToken('org-1');

      // getOrgComplianceCredentials should only be called once (cached on second call)
      expect(orgRepo.getOrgComplianceCredentials).toHaveBeenCalledTimes(1);
      expect(orgTokenManager.getToken).toHaveBeenCalledTimes(2);
    });
  });

  // ── destroyOrgTokenManagers ──────────────────────────────────────────────

  describe('destroyOrgTokenManagers()', () => {
    it('clears the cache and destroys all managers', async () => {
      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('global-token'),
        destroy: vi.fn(),
      };

      const orgTokenManager = {
        getToken: vi.fn().mockResolvedValue('org-token'),
        destroy: vi.fn(),
      };
      (ServiceTokenManager as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        function () { return orgTokenManager; },
      );

      const orgRepo: OrgRepository = {
        getOrgComplianceCredentials: vi.fn().mockResolvedValue({
          clientId: 'org-client-id',
          clientSecret: 'org-client-secret',
        }),
        updateOrgComplianceClient: vi.fn(),
      } as unknown as OrgRepository;

      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager, orgRepo);
      await service.getOrgToken('org-1');

      service.destroyOrgTokenManagers();

      expect(orgTokenManager.destroy).toHaveBeenCalledTimes(1);

      // After destroy, next call should create a new manager
      await service.getOrgToken('org-1');
      expect(orgRepo.getOrgComplianceCredentials).toHaveBeenCalledTimes(2);
    });
  });

  // ── listJurisdictions ────────────────────────────────────────────────────

  describe('listJurisdictions()', () => {
    it('caches results on repeated calls', async () => {
      const jurisdictions = [makeJurisdiction('uk', 'United Kingdom')];
      (listJurisdictions as ReturnType<typeof vi.fn>).mockResolvedValue(jurisdictions);

      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('token'),
        destroy: vi.fn(),
      };
      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager);

      const first = await service.listJurisdictions('token-1');
      const second = await service.listJurisdictions('token-1');

      expect(first).toEqual(jurisdictions);
      expect(second).toEqual(jurisdictions);
      expect(listJurisdictions).toHaveBeenCalledTimes(1);
    });
  });

  // ── listRegulations ──────────────────────────────────────────────────────

  describe('listRegulations()', () => {
    it('caches results on repeated calls', async () => {
      const regulations = [makeRegulation('eaa', 'European Accessibility Act', 'EAA', 'eu')];
      (listRegulations as ReturnType<typeof vi.fn>).mockResolvedValue(regulations);

      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('token'),
        destroy: vi.fn(),
      };
      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager);

      const first = await service.listRegulations('token-1');
      const second = await service.listRegulations('token-1');

      expect(first).toEqual(regulations);
      expect(second).toEqual(regulations);
      expect(listRegulations).toHaveBeenCalledTimes(1);
    });
  });

  // ── safeListJurisdictions ────────────────────────────────────────────────

  describe('safeListJurisdictions()', () => {
    it('returns empty array on error', async () => {
      (listJurisdictions as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('token'),
        destroy: vi.fn(),
      };
      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager);

      const result = await service.safeListJurisdictions('token-1');

      expect(result).toEqual([]);
    });
  });

  // ── safeListRegulations ──────────────────────────────────────────────────

  describe('safeListRegulations()', () => {
    it('returns empty array on error', async () => {
      (listRegulations as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('token'),
        destroy: vi.fn(),
      };
      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager);

      const result = await service.safeListRegulations('token-1');

      expect(result).toEqual([]);
    });
  });

  // ── clearCache ───────────────────────────────────────────────────────────

  describe('clearCache()', () => {
    it('empties the cache so next call fetches fresh data', async () => {
      const jurisdictions = [makeJurisdiction('uk', 'United Kingdom')];
      (listJurisdictions as ReturnType<typeof vi.fn>).mockResolvedValue(jurisdictions);
      (listRegulations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('token'),
        destroy: vi.fn(),
      };
      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager);

      await service.listJurisdictions('token-1');
      expect(listJurisdictions).toHaveBeenCalledTimes(1);

      service.clearCache();

      await service.listJurisdictions('token-1');
      expect(listJurisdictions).toHaveBeenCalledTimes(2);
    });
  });

  // ── getComplianceLookupData ──────────────────────────────────────────────

  describe('getComplianceLookupData()', () => {
    it('returns combined jurisdictions and regulations', async () => {
      const jurisdictions = [makeJurisdiction('uk', 'United Kingdom')];
      const regulations = [makeRegulation('eaa', 'European Accessibility Act', 'EAA', 'eu')];

      (listJurisdictions as ReturnType<typeof vi.fn>).mockResolvedValue(jurisdictions);
      (listRegulations as ReturnType<typeof vi.fn>).mockResolvedValue(regulations);

      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('token'),
        destroy: vi.fn(),
      };
      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager);

      const result = await service.getComplianceLookupData('token-1', 'org-1');

      expect(result.jurisdictions).toEqual([{ id: 'uk', name: 'United Kingdom' }]);
      expect(result.regulations).toEqual([{
        id: 'eaa',
        name: 'European Accessibility Act',
        shortName: 'EAA',
        jurisdictionId: 'eu',
      }]);
      expect(result.warning).toBe('');
    });

    it('returns warning and empty arrays when compliance service fails', async () => {
      (listJurisdictions as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection refused'));

      const globalTokenManager = {
        getToken: vi.fn().mockResolvedValue('token'),
        destroy: vi.fn(),
      };
      const service = new ComplianceService(config, () => globalTokenManager as unknown as ServiceTokenManager);

      const result = await service.getComplianceLookupData('token-1');

      expect(result.jurisdictions).toEqual([]);
      expect(result.regulations).toEqual([]);
      expect(result.warning).toContain('unreachable');
    });
  });
});
