/**
 * Shared adapter contract tests — SQLite (in-memory).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DbAdapter } from '../../src/db/adapter.js';

// ---------------------------------------------------------------------------
// Adapter factory helpers
// ---------------------------------------------------------------------------

async function makeSqliteAdapter(): Promise<DbAdapter> {
  const { SqliteAdapter } = await import('../../src/db/sqlite-adapter.js');
  return new SqliteAdapter(':memory:');
}

// ---------------------------------------------------------------------------
// Contract test suite factory
// ---------------------------------------------------------------------------

function runContractTests(
  suiteName: string,
  factory: () => Promise<DbAdapter>,
): void {
  describe(suiteName, () => {
    let db: DbAdapter;

    beforeEach(async () => {
      db = await factory();
      await db.initialize();
    });

    afterEach(async () => {
      await db.close();
    });

    // -----------------------------------------------------------------------
    // initialize / close
    // -----------------------------------------------------------------------

    it('initialize() creates schema without errors', async () => {
      // Already called in beforeEach — just assert the adapter is usable
      const jurisdictions = await db.listJurisdictions();
      expect(Array.isArray(jurisdictions)).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Jurisdictions
    // -----------------------------------------------------------------------

    describe('jurisdictions', () => {
      it('creates and retrieves a jurisdiction', async () => {
        const j = await db.createJurisdiction({
          id: 'EU',
          name: 'European Union',
          type: 'supranational',
        });
        expect(j.id).toBe('EU');
        expect(j.name).toBe('European Union');
        expect(j.type).toBe('supranational');
        expect(j.createdAt).toBeTruthy();

        const fetched = await db.getJurisdiction('EU');
        expect(fetched).not.toBeNull();
        expect(fetched!.name).toBe('European Union');
      });

      it('returns null for non-existent jurisdiction', async () => {
        expect(await db.getJurisdiction('DOES_NOT_EXIST')).toBeNull();
      });

      it('lists jurisdictions (no filter)', async () => {
        await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
        await db.createJurisdiction({ id: 'DE', name: 'Germany', type: 'country', parentId: 'EU' });
        await db.createJurisdiction({ id: 'US', name: 'United States', type: 'country' });

        const all = await db.listJurisdictions();
        expect(all.length).toBeGreaterThanOrEqual(3);
      });

      it('filters jurisdictions by type', async () => {
        await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
        await db.createJurisdiction({ id: 'US', name: 'United States', type: 'country' });

        const supranational = await db.listJurisdictions({ type: 'supranational' });
        expect(supranational.every(j => j.type === 'supranational')).toBe(true);
        expect(supranational.some(j => j.id === 'EU')).toBe(true);
      });

      it('filters jurisdictions by parentId', async () => {
        await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
        await db.createJurisdiction({ id: 'DE', name: 'Germany', type: 'country', parentId: 'EU' });
        await db.createJurisdiction({ id: 'US', name: 'United States', type: 'country' });

        const euChildren = await db.listJurisdictions({ parentId: 'EU' });
        expect(euChildren).toHaveLength(1);
        expect(euChildren[0].id).toBe('DE');
      });

      it('updates a jurisdiction', async () => {
        await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
        const updated = await db.updateJurisdiction('EU', { name: 'EU Updated' });
        expect(updated.name).toBe('EU Updated');
        expect(updated.type).toBe('supranational');
      });

      it('deletes a jurisdiction', async () => {
        await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
        await db.deleteJurisdiction('EU');
        expect(await db.getJurisdiction('EU')).toBeNull();
      });
    });

    // -----------------------------------------------------------------------
    // Regulations
    // -----------------------------------------------------------------------

    describe('regulations', () => {
      const baseRegulation = {
        id: 'eu-eaa',
        jurisdictionId: 'EU',
        name: 'European Accessibility Act',
        shortName: 'EAA',
        reference: 'Directive (EU) 2019/882',
        url: 'https://example.com',
        enforcementDate: '2025-06-28',
        status: 'active' as const,
        scope: 'all' as const,
        sectors: ['e-commerce', 'banking'],
        description: 'Accessible products',
      };

      beforeEach(async () => {
        await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
      });

      it('creates and retrieves a regulation', async () => {
        const r = await db.createRegulation(baseRegulation);
        expect(r.id).toBe('eu-eaa');
        expect(r.sectors).toEqual(['e-commerce', 'banking']);

        const fetched = await db.getRegulation('eu-eaa');
        expect(fetched).not.toBeNull();
        expect(fetched!.shortName).toBe('EAA');
      });

      it('returns null for non-existent regulation', async () => {
        expect(await db.getRegulation('DOES_NOT_EXIST')).toBeNull();
      });

      it('lists regulations with jurisdictionId filter', async () => {
        await db.createJurisdiction({ id: 'US', name: 'United States', type: 'country' });
        await db.createRegulation(baseRegulation);
        await db.createRegulation({
          id: 'us-508',
          jurisdictionId: 'US',
          name: 'Section 508',
          shortName: 'S508',
          reference: 'ref',
          url: 'url',
          enforcementDate: '1998-08-07',
          status: 'active',
          scope: 'public',
          sectors: [],
          description: 'desc',
        });

        const euRegs = await db.listRegulations({ jurisdictionId: 'EU' });
        expect(euRegs.every(r => r.jurisdictionId === 'EU')).toBe(true);
        expect(euRegs.some(r => r.id === 'eu-eaa')).toBe(true);
      });

      it('lists regulations with status filter', async () => {
        await db.createRegulation(baseRegulation);
        await db.createRegulation({
          ...baseRegulation,
          id: 'eu-wad',
          name: 'WAD',
          shortName: 'WAD',
          status: 'repealed',
        });

        const active = await db.listRegulations({ status: 'active' });
        expect(active.every(r => r.status === 'active')).toBe(true);

        const repealed = await db.listRegulations({ status: 'repealed' });
        expect(repealed.every(r => r.status === 'repealed')).toBe(true);
      });

      it('lists regulations with scope filter', async () => {
        await db.createRegulation(baseRegulation);
        await db.createRegulation({
          ...baseRegulation,
          id: 'eu-wad',
          name: 'WAD',
          shortName: 'WAD',
          scope: 'public',
        });

        const publicRegs = await db.listRegulations({ scope: 'public' });
        expect(publicRegs.every(r => r.scope === 'public')).toBe(true);
        expect(publicRegs.some(r => r.id === 'eu-wad')).toBe(true);
      });

      it('updates a regulation', async () => {
        await db.createRegulation(baseRegulation);
        const updated = await db.updateRegulation('eu-eaa', { status: 'repealed' });
        expect(updated.status).toBe('repealed');
        expect(updated.name).toBe('European Accessibility Act');
      });

      it('deletes a regulation', async () => {
        await db.createRegulation(baseRegulation);
        await db.deleteRegulation('eu-eaa');
        expect(await db.getRegulation('eu-eaa')).toBeNull();
      });
    });

    // -----------------------------------------------------------------------
    // Requirements
    // -----------------------------------------------------------------------

    describe('requirements', () => {
      beforeEach(async () => {
        await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
        await db.createRegulation({
          id: 'eu-eaa',
          jurisdictionId: 'EU',
          name: 'EAA',
          shortName: 'EAA',
          reference: 'ref',
          url: 'url',
          enforcementDate: '2025-06-28',
          status: 'active',
          scope: 'all',
          sectors: [],
          description: 'desc',
        });
      });

      it('creates and retrieves a requirement', async () => {
        const req = await db.createRequirement({
          regulationId: 'eu-eaa',
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          wcagCriterion: '*',
          obligation: 'mandatory',
        });
        expect(req.id).toBeTruthy();
        expect(req.wcagCriterion).toBe('*');

        const fetched = await db.getRequirement(req.id);
        expect(fetched).not.toBeNull();
        expect(fetched!.obligation).toBe('mandatory');
      });

      it('returns null for non-existent requirement', async () => {
        expect(await db.getRequirement('does-not-exist')).toBeNull();
      });

      it('lists all requirements', async () => {
        await db.createRequirement({
          regulationId: 'eu-eaa',
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          wcagCriterion: '*',
          obligation: 'mandatory',
        });
        const all = await db.listRequirements();
        expect(all.length).toBeGreaterThanOrEqual(1);
      });

      it('filters requirements by obligation', async () => {
        await db.createRequirement({
          regulationId: 'eu-eaa',
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          wcagCriterion: '*',
          obligation: 'mandatory',
        });
        await db.createRequirement({
          regulationId: 'eu-eaa',
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          wcagCriterion: '1.1.1',
          obligation: 'recommended',
        });

        const mandatory = await db.listRequirements({ obligation: 'mandatory' });
        expect(mandatory.every(r => r.obligation === 'mandatory')).toBe(true);
      });

      it('filters requirements by wcagCriterion', async () => {
        await db.createRequirement({
          regulationId: 'eu-eaa',
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          wcagCriterion: '1.1.1',
          obligation: 'mandatory',
        });
        const results = await db.listRequirements({ wcagCriterion: '1.1.1' });
        expect(results.some(r => r.wcagCriterion === '1.1.1')).toBe(true);
      });

      it('updates a requirement', async () => {
        const req = await db.createRequirement({
          regulationId: 'eu-eaa',
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          wcagCriterion: '*',
          obligation: 'mandatory',
        });
        const updated = await db.updateRequirement(req.id, { obligation: 'recommended' });
        expect(updated.obligation).toBe('recommended');
      });

      it('deletes a requirement', async () => {
        const req = await db.createRequirement({
          regulationId: 'eu-eaa',
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          wcagCriterion: '*',
          obligation: 'mandatory',
        });
        await db.deleteRequirement(req.id);
        expect(await db.getRequirement(req.id)).toBeNull();
      });

      it('bulk creates requirements', async () => {
        const results = await db.bulkCreateRequirements([
          {
            regulationId: 'eu-eaa',
            wcagVersion: '2.1',
            wcagLevel: 'AA',
            wcagCriterion: '*',
            obligation: 'mandatory',
          },
          {
            regulationId: 'eu-eaa',
            wcagVersion: '2.1',
            wcagLevel: 'A',
            wcagCriterion: '1.1.1',
            obligation: 'recommended',
          },
        ]);
        expect(results).toHaveLength(2);
        expect(results.every(r => r.id != null)).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // findRequirementsByCriteria
    // -----------------------------------------------------------------------

    describe('findRequirementsByCriteria', () => {
      beforeEach(async () => {
        await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
        await db.createJurisdiction({ id: 'US', name: 'United States', type: 'country' });
        await db.createRegulation({
          id: 'eu-eaa',
          jurisdictionId: 'EU',
          name: 'European Accessibility Act',
          shortName: 'EAA',
          reference: 'ref',
          url: 'url',
          enforcementDate: '2025-06-28',
          status: 'active',
          scope: 'all',
          sectors: [],
          description: 'desc',
        });
        await db.createRegulation({
          id: 'us-508',
          jurisdictionId: 'US',
          name: 'Section 508',
          shortName: 'Section 508',
          reference: 'ref',
          url: 'url',
          enforcementDate: '1998-08-07',
          status: 'active',
          scope: 'public',
          sectors: [],
          description: 'desc',
        });
        // Wildcard requirement for EU
        await db.createRequirement({
          regulationId: 'eu-eaa',
          wcagVersion: '2.1',
          wcagLevel: 'AA',
          wcagCriterion: '*',
          obligation: 'mandatory',
        });
        // Specific requirement for US
        await db.createRequirement({
          regulationId: 'us-508',
          wcagVersion: '2.0',
          wcagLevel: 'AA',
          wcagCriterion: '1.1.1',
          obligation: 'mandatory',
        });
      });

      it('returns empty array for empty jurisdictions', async () => {
        const results = await db.findRequirementsByCriteria([], ['1.1.1']);
        expect(results).toHaveLength(0);
      });

      it('returns empty array for empty criteria', async () => {
        const results = await db.findRequirementsByCriteria(['EU'], []);
        expect(results).toHaveLength(0);
      });

      it('finds requirements by jurisdiction and criteria', async () => {
        const results = await db.findRequirementsByCriteria(['EU'], ['1.1.1']);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].regulationName).toBeTruthy();
        expect(results[0].jurisdictionId).toBe('EU');
      });

      it('finds wildcard requirements (criterion = "*")', async () => {
        const results = await db.findRequirementsByCriteria(['EU'], ['2.4.7']);
        expect(results.length).toBeGreaterThanOrEqual(1);
        // The wildcard requirement should be included
        expect(results.some(r => r.wcagCriterion === '*')).toBe(true);
      });

      it('includes regulation metadata', async () => {
        const results = await db.findRequirementsByCriteria(['EU'], ['1.1.1']);
        expect(results.length).toBeGreaterThanOrEqual(1);
        const r = results[0];
        expect(r.regulationName).toBeTruthy();
        expect(r.regulationShortName).toBeTruthy();
        expect(r.jurisdictionId).toBeTruthy();
        expect(r.enforcementDate).toBeTruthy();
      });

      it('finds requirements across multiple jurisdictions', async () => {
        const results = await db.findRequirementsByCriteria(['EU', 'US'], ['1.1.1']);
        // EU wildcard + US explicit 1.1.1
        expect(results.length).toBeGreaterThanOrEqual(2);
      });
    });

    // -----------------------------------------------------------------------
    // Update proposals
    // -----------------------------------------------------------------------

    describe('update proposals', () => {
      it('creates and lists proposals', async () => {
        const p = await db.createUpdateProposal({
          source: 'https://example.com',
          type: 'new_regulation',
          summary: 'New law',
          proposedChanges: {
            action: 'create',
            entityType: 'regulation',
            after: { name: 'New' },
          },
        });
        expect(p.id).toBeTruthy();
        expect(p.status).toBe('pending');

        const all = await db.listUpdateProposals();
        expect(all.some(p2 => p2.id === p.id)).toBe(true);
      });

      it('retrieves a single proposal by id', async () => {
        const p = await db.createUpdateProposal({
          source: 'src',
          type: 'amendment',
          summary: 'Change',
          proposedChanges: { action: 'update', entityType: 'regulation', entityId: 'x', after: {} },
        });
        const fetched = await db.getUpdateProposal(p.id);
        expect(fetched).not.toBeNull();
        expect(fetched!.id).toBe(p.id);
      });

      it('returns null for non-existent proposal', async () => {
        expect(await db.getUpdateProposal('does-not-exist')).toBeNull();
      });

      it('filters proposals by status', async () => {
        await db.createUpdateProposal({
          source: 'src',
          type: 'amendment',
          summary: 'Change',
          proposedChanges: { action: 'update', entityType: 'regulation', entityId: 'x', after: {} },
        });
        const pending = await db.listUpdateProposals({ status: 'pending' });
        expect(pending.every(p => p.status === 'pending')).toBe(true);

        const approved = await db.listUpdateProposals({ status: 'approved' });
        expect(approved.every(p => p.status === 'approved')).toBe(true);
      });

      it('updates a proposal status', async () => {
        const p = await db.createUpdateProposal({
          source: 'src',
          type: 'amendment',
          summary: 'Change',
          proposedChanges: { action: 'update', entityType: 'regulation', entityId: 'x', after: {} },
        });
        const updated = await db.updateUpdateProposal(p.id, {
          status: 'approved',
          reviewedBy: 'admin',
          reviewedAt: new Date().toISOString(),
        });
        expect(updated.status).toBe('approved');
        expect(updated.reviewedBy).toBe('admin');
      });
    });

    // -----------------------------------------------------------------------
    // Monitored sources
    // -----------------------------------------------------------------------

    describe('monitored sources', () => {
      it('creates and lists sources', async () => {
        const s = await db.createSource({
          name: 'W3C',
          url: 'https://w3.org',
          type: 'html',
          schedule: 'weekly',
        });
        expect(s.id).toBeTruthy();

        const all = await db.listSources();
        expect(all.some(src => src.id === s.id)).toBe(true);
      });

      it('deletes a source', async () => {
        const s = await db.createSource({
          name: 'W3C',
          url: 'https://w3.org',
          type: 'html',
          schedule: 'weekly',
        });
        await db.deleteSource(s.id);
        const all = await db.listSources();
        expect(all.every(src => src.id !== s.id)).toBe(true);
      });

      it('updates lastCheckedAt and lastContentHash', async () => {
        const s = await db.createSource({
          name: 'W3C',
          url: 'https://w3.org',
          type: 'html',
          schedule: 'weekly',
        });
        await db.updateSourceLastChecked(s.id, 'abc123hash');
        const all = await db.listSources();
        const updated = all.find(src => src.id === s.id)!;
        expect(updated.lastContentHash).toBe('abc123hash');
        expect(updated.lastCheckedAt).toBeTruthy();
      });
    });

    // -----------------------------------------------------------------------
    // OAuth clients
    // -----------------------------------------------------------------------

    describe('OAuth clients', () => {
      it('creates and retrieves a client', async () => {
        const c = await db.createClient({
          name: 'test-app',
          scopes: ['read'],
          grantTypes: ['client_credentials'],
        });
        expect(c.id).toBeTruthy();
        expect(c.secret).toBeTruthy();
        expect(c.secretHash).toBeTruthy();
        expect(c.secret).not.toBe(c.secretHash);

        const fetched = await db.getClientById(c.id);
        expect(fetched).not.toBeNull();
        expect(fetched!.name).toBe('test-app');
      });

      it('returns null for non-existent client', async () => {
        expect(await db.getClientById('does-not-exist')).toBeNull();
      });

      it('lists clients', async () => {
        await db.createClient({ name: 'a', scopes: ['read'], grantTypes: ['client_credentials'] });
        await db.createClient({ name: 'b', scopes: ['read', 'write'], grantTypes: ['client_credentials'] });
        const all = await db.listClients();
        expect(all.length).toBeGreaterThanOrEqual(2);
      });

      it('deletes a client', async () => {
        const c = await db.createClient({
          name: 'del-me',
          scopes: ['read'],
          grantTypes: ['client_credentials'],
        });
        await db.deleteClient(c.id);
        expect(await db.getClientById(c.id)).toBeNull();
      });

      it('createClient returns plaintext secret before hashing', async () => {
        const c = await db.createClient({
          name: 'secret-test',
          scopes: ['read'],
          grantTypes: ['client_credentials'],
        });
        // secret must be returned once (plaintext) and must differ from hash
        expect(c.secret).toBeTruthy();
        expect(c.secret).not.toBe(c.secretHash);
        // The stored client must only have the hash, not the plaintext
        const stored = await db.getClientById(c.id);
        expect(stored!.secretHash).toBe(c.secretHash);
      });
    });

    // -----------------------------------------------------------------------
    // Users
    // -----------------------------------------------------------------------

    describe('users', () => {
      it('creates and retrieves a user by username', async () => {
        const u = await db.createUser({
          username: 'admin',
          password: 'secret123',
          role: 'admin',
        });
        expect(u.id).toBeTruthy();
        expect(u.passwordHash).toBeTruthy();
        expect(u.passwordHash).not.toBe('secret123');

        const fetched = await db.getUserByUsername('admin');
        expect(fetched).not.toBeNull();
        expect(fetched!.role).toBe('admin');
      });

      it('returns null for non-existent user', async () => {
        expect(await db.getUserByUsername('nobody')).toBeNull();
      });
    });

    // -----------------------------------------------------------------------
    // Webhooks
    // -----------------------------------------------------------------------

    describe('webhooks', () => {
      it('creates, lists, and deletes webhooks', async () => {
        const w = await db.createWebhook({
          url: 'https://example.com/hook',
          secret: 'shh',
          events: ['update.proposed'],
        });
        expect(w.id).toBeTruthy();
        expect(w.active).toBe(true);

        const all = await db.listWebhooks();
        expect(all.some(wh => wh.id === w.id)).toBe(true);

        await db.deleteWebhook(w.id);
        const afterDelete = await db.listWebhooks();
        expect(afterDelete.every(wh => wh.id !== w.id)).toBe(true);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Instantiate suites
// ---------------------------------------------------------------------------

// SQLite — always runs (in-memory, no env var needed)
runContractTests('SqliteAdapter (contract)', makeSqliteAdapter);
