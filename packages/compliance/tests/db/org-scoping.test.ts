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

      const org1Only = await db.listJurisdictions({ orgId: 'org-1' });
      expect(org1Only).toHaveLength(1);
      expect(org1Only[0].name).toBe('Org Custom');
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
    });
  });

  describe('monitored sources', () => {
    it('filters by orgId', async () => {
      await db.createSource({ name: 'Global', url: 'https://a.com', type: 'html', schedule: 'daily' });
      await db.createSource({ name: 'Org', url: 'https://b.com', type: 'html', schedule: 'daily', orgId: 'org-1' });

      const system = await db.listSources({ orgId: 'system' });
      expect(system).toHaveLength(1);
      expect(system[0].name).toBe('Global');
    });
  });

  describe('webhooks', () => {
    it('filters by orgId', async () => {
      await db.createWebhook({ url: 'https://a.com/hook', secret: 's1', events: ['scan.complete'] });
      await db.createWebhook({ url: 'https://b.com/hook', secret: 's2', events: ['scan.complete'], orgId: 'org-1' });

      const system = await db.listWebhooks({ orgId: 'system' });
      expect(system).toHaveLength(1);
      expect(system[0].url).toBe('https://a.com/hook');
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

      expect(await db.listJurisdictions({ orgId: 'org-1' })).toHaveLength(0);
      expect(await db.listRegulations({ orgId: 'org-1' })).toHaveLength(0);
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
