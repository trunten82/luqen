import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DbAdapter } from '../../src/db/adapter.js';

async function makeSqliteAdapter(): Promise<DbAdapter> {
  const { SqliteAdapter } = await import('../../src/db/sqlite-adapter.js');
  const adapter = new SqliteAdapter(':memory:');
  await adapter.initialize();
  return adapter;
}

describe('Org-scoped compliance queries', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = await makeSqliteAdapter();
  });

  afterEach(async () => {
    await db.close();
  });

  describe('jurisdictions', () => {
    it('defaults org_id to system', async () => {
      const j = await db.createJurisdiction({ name: 'Test Country', type: 'country' });
      const all = await db.listJurisdictions();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(j.id);
    });

    it('filters by orgId', async () => {
      await db.createJurisdiction({ name: 'Global', type: 'country' });
      await db.createJurisdiction({ name: 'Org Custom', type: 'country', orgId: 'org-1' });

      const systemOnly = await db.listJurisdictions({ orgId: 'system' });
      expect(systemOnly).toHaveLength(1);
      expect(systemOnly[0].name).toBe('Global');

      // Hybrid: org-1 sees both system + org-1 data
      const org1Results = await db.listJurisdictions({ orgId: 'org-1' });
      expect(org1Results).toHaveLength(2);
      const names = org1Results.map(j => j.name);
      expect(names).toContain('Global');
      expect(names).toContain('Org Custom');
    });
  });

  describe('regulations', () => {
    it('filters by orgId', async () => {
      const j = await db.createJurisdiction({ name: 'Country', type: 'country' });
      await db.createRegulation({
        jurisdictionId: j.id, name: 'Global Reg', shortName: 'GR', reference: 'REF-1',
        url: 'https://example.com', enforcementDate: '2025-01-01', status: 'active',
        scope: 'public', sectors: [], description: 'A regulation',
      });
      await db.createRegulation({
        jurisdictionId: j.id, name: 'Org Reg', shortName: 'OR', reference: 'REF-2',
        url: 'https://example.com', enforcementDate: '2025-01-01', status: 'active',
        scope: 'public', sectors: [], description: 'Org regulation', orgId: 'org-1',
      });

      const systemRegs = await db.listRegulations({ orgId: 'system' });
      expect(systemRegs).toHaveLength(1);
      expect(systemRegs[0].name).toBe('Global Reg');

      // Hybrid: org-1 sees both system + org-1 data
      const org1Regs = await db.listRegulations({ orgId: 'org-1' });
      expect(org1Regs).toHaveLength(2);
      const names = org1Regs.map(r => r.name);
      expect(names).toContain('Global Reg');
      expect(names).toContain('Org Reg');
    });
  });

  describe('update proposals', () => {
    it('filters by orgId', async () => {
      await db.createUpdateProposal({
        source: 'test', detectedAt: new Date().toISOString(), type: 'new_regulation',
        summary: 'System proposal', proposedChanges: '{}',
      });
      await db.createUpdateProposal({
        source: 'test', detectedAt: new Date().toISOString(), type: 'new_regulation',
        summary: 'Org proposal', proposedChanges: '{}', orgId: 'org-1',
      });

      const system = await db.listUpdateProposals({ orgId: 'system' });
      expect(system).toHaveLength(1);
      expect(system[0].summary).toBe('System proposal');

      // Hybrid: org-1 sees both
      const org1 = await db.listUpdateProposals({ orgId: 'org-1' });
      expect(org1).toHaveLength(2);
      const summaries = org1.map(p => p.summary);
      expect(summaries).toContain('System proposal');
      expect(summaries).toContain('Org proposal');
    });
  });

  describe('monitored sources', () => {
    it('filters by orgId', async () => {
      await db.createSource({ name: 'Global', url: 'https://a.com', type: 'html', schedule: 'daily' });
      await db.createSource({ name: 'Org', url: 'https://b.com', type: 'html', schedule: 'daily', orgId: 'org-1' });

      const system = await db.listSources({ orgId: 'system' });
      expect(system).toHaveLength(1);
      expect(system[0].name).toBe('Global');

      // Hybrid: org-1 sees both
      const org1 = await db.listSources({ orgId: 'org-1' });
      expect(org1).toHaveLength(2);
      const names = org1.map(s => s.name);
      expect(names).toContain('Global');
      expect(names).toContain('Org');
    });
  });

  describe('webhooks', () => {
    it('filters by orgId', async () => {
      await db.createWebhook({ url: 'https://a.com/hook', secret: 's1', events: ['scan.complete'] });
      await db.createWebhook({ url: 'https://b.com/hook', secret: 's2', events: ['scan.complete'], orgId: 'org-1' });

      const system = await db.listWebhooks({ orgId: 'system' });
      expect(system).toHaveLength(1);
      expect(system[0].url).toBe('https://a.com/hook');

      // Hybrid: org-1 sees both
      const org1 = await db.listWebhooks({ orgId: 'org-1' });
      expect(org1).toHaveLength(2);
      const urls = org1.map(w => w.url);
      expect(urls).toContain('https://a.com/hook');
      expect(urls).toContain('https://b.com/hook');
    });
  });

  describe('hybrid query behavior', () => {
    it('returns system + org data for org-scoped reads', async () => {
      // Create system jurisdiction
      const sysJ = await db.createJurisdiction({ name: 'System Country', type: 'country' });
      // Create org-1 jurisdiction
      const orgJ = await db.createJurisdiction({ name: 'Org Country', type: 'country', orgId: 'org-1' });

      // System regulations on system jurisdiction
      await db.createRegulation({
        jurisdictionId: sysJ.id, name: 'System Reg', shortName: 'SR', reference: 'R1',
        url: 'https://example.com', enforcementDate: '2025-01-01', status: 'active',
        scope: 'public', sectors: [], description: 'System reg',
      });
      // Org regulations on org jurisdiction
      await db.createRegulation({
        jurisdictionId: orgJ.id, name: 'Org Reg', shortName: 'OR', reference: 'R2',
        url: 'https://example.com', enforcementDate: '2025-01-01', status: 'active',
        scope: 'public', sectors: [], description: 'Org reg', orgId: 'org-1',
      });

      // Org-1 read should see both system and org-1 jurisdictions
      const jurisdictions = await db.listJurisdictions({ orgId: 'org-1' });
      expect(jurisdictions).toHaveLength(2);

      // Org-1 read should see both system and org-1 regulations
      const regulations = await db.listRegulations({ orgId: 'org-1' });
      expect(regulations).toHaveLength(2);
    });

    it('returns only system data when orgId is system', async () => {
      await db.createJurisdiction({ name: 'System J', type: 'country' });
      await db.createJurisdiction({ name: 'Org J', type: 'country', orgId: 'org-1' });
      await db.createJurisdiction({ name: 'Org2 J', type: 'country', orgId: 'org-2' });

      const result = await db.listJurisdictions({ orgId: 'system' });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('System J');
    });

    it('creates data in specific org, not system', async () => {
      const j = await db.createJurisdiction({ name: 'Org Only', type: 'country', orgId: 'org-1' });

      // System query should NOT see org-1 data
      const systemResult = await db.listJurisdictions({ orgId: 'system' });
      expect(systemResult).toHaveLength(0);

      // Org-1 query should see it (plus any system data, which is none here)
      const org1Result = await db.listJurisdictions({ orgId: 'org-1' });
      expect(org1Result).toHaveLength(1);
      expect(org1Result[0].id).toBe(j.id);
    });

    it('does not leak data between non-system orgs', async () => {
      await db.createJurisdiction({ name: 'Org1 J', type: 'country', orgId: 'org-1' });
      await db.createJurisdiction({ name: 'Org2 J', type: 'country', orgId: 'org-2' });

      // Org-1 should not see org-2 data (only system + org-1)
      const org1Result = await db.listJurisdictions({ orgId: 'org-1' });
      expect(org1Result).toHaveLength(1);
      expect(org1Result[0].name).toBe('Org1 J');

      // Org-2 should not see org-1 data (only system + org-2)
      const org2Result = await db.listJurisdictions({ orgId: 'org-2' });
      expect(org2Result).toHaveLength(1);
      expect(org2Result[0].name).toBe('Org2 J');
    });
  });

  describe('deleteOrgData', () => {
    it('removes all data for an org', async () => {
      const j = await db.createJurisdiction({ name: 'Org J', type: 'country', orgId: 'org-1' });
      await db.createRegulation({
        jurisdictionId: j.id, name: 'Org Reg', shortName: 'OR', reference: 'R1',
        url: 'https://x.com', enforcementDate: '2025-01-01', status: 'active',
        scope: 'public', sectors: [], description: 'test', orgId: 'org-1',
      });

      await db.deleteOrgData('org-1');

      // After deleting org-1 data, hybrid query returns only system data (none here)
      const jurisdictions = await db.listJurisdictions({ orgId: 'org-1' });
      expect(jurisdictions).toHaveLength(0);
      const regulations = await db.listRegulations({ orgId: 'org-1' });
      expect(regulations).toHaveLength(0);
    });

    it('does not affect system data', async () => {
      await db.createJurisdiction({ name: 'Global', type: 'country' });
      await db.createJurisdiction({ name: 'Org', type: 'country', orgId: 'org-1' });

      await db.deleteOrgData('org-1');

      const systemData = await db.listJurisdictions({ orgId: 'system' });
      expect(systemData).toHaveLength(1);
      expect(systemData[0].name).toBe('Global');
    });

    it('refuses to delete system org data', async () => {
      await expect(db.deleteOrgData('system')).rejects.toThrow();
    });
  });
});
