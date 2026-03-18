import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';

describe('SqliteAdapter', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  // --- Jurisdictions ---

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
      const fetched = await db.getJurisdiction('XX');
      expect(fetched).toBeNull();
    });

    it('lists jurisdictions with filters', async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
      await db.createJurisdiction({
        id: 'DE',
        name: 'Germany',
        type: 'country',
        parentId: 'EU',
      });
      await db.createJurisdiction({
        id: 'US',
        name: 'United States',
        type: 'country',
      });

      const all = await db.listJurisdictions();
      expect(all).toHaveLength(3);

      const countries = await db.listJurisdictions({ type: 'country' });
      expect(countries).toHaveLength(2);

      const euChildren = await db.listJurisdictions({ parentId: 'EU' });
      expect(euChildren).toHaveLength(1);
      expect(euChildren[0].id).toBe('DE');
    });

    it('updates a jurisdiction', async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
      const updated = await db.updateJurisdiction('EU', {
        name: 'EU Updated',
      });
      expect(updated.name).toBe('EU Updated');
      expect(updated.type).toBe('supranational');
    });

    it('deletes a jurisdiction', async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
      await db.deleteJurisdiction('EU');
      const fetched = await db.getJurisdiction('EU');
      expect(fetched).toBeNull();
    });
  });

  // --- Regulations ---

  describe('regulations', () => {
    beforeEach(async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
    });

    it('creates and retrieves a regulation', async () => {
      const r = await db.createRegulation({
        id: 'eu-eaa',
        jurisdictionId: 'EU',
        name: 'European Accessibility Act',
        shortName: 'EAA',
        reference: 'Directive (EU) 2019/882',
        url: 'https://example.com',
        enforcementDate: '2025-06-28',
        status: 'active',
        scope: 'all',
        sectors: ['e-commerce', 'banking'],
        description: 'Accessible products',
      });
      expect(r.id).toBe('eu-eaa');
      expect(r.sectors).toEqual(['e-commerce', 'banking']);

      const fetched = await db.getRegulation('eu-eaa');
      expect(fetched).not.toBeNull();
      expect(fetched!.shortName).toBe('EAA');
    });

    it('lists regulations with filters', async () => {
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
      await db.createRegulation({
        id: 'eu-wad',
        jurisdictionId: 'EU',
        name: 'WAD',
        shortName: 'WAD',
        reference: 'ref',
        url: 'url',
        enforcementDate: '2016-12-22',
        status: 'active',
        scope: 'public',
        sectors: [],
        description: 'desc',
      });

      const all = await db.listRegulations();
      expect(all).toHaveLength(2);

      const publicOnly = await db.listRegulations({ scope: 'public' });
      expect(publicOnly).toHaveLength(1);
      expect(publicOnly[0].id).toBe('eu-wad');
    });

    it('updates a regulation', async () => {
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
      const updated = await db.updateRegulation('eu-eaa', {
        status: 'repealed',
      });
      expect(updated.status).toBe('repealed');
      expect(updated.name).toBe('EAA');
    });

    it('deletes a regulation', async () => {
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
      await db.deleteRegulation('eu-eaa');
      expect(await db.getRegulation('eu-eaa')).toBeNull();
    });
  });

  // --- Requirements ---

  describe('requirements', () => {
    beforeEach(async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
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

    it('creates and lists requirements', async () => {
      const req = await db.createRequirement({
        regulationId: 'eu-eaa',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '*',
        obligation: 'mandatory',
      });
      expect(req.id).toBeTruthy();
      expect(req.wcagCriterion).toBe('*');

      const all = await db.listRequirements();
      expect(all).toHaveLength(1);
    });

    it('lists requirements with filters', async () => {
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

      const mandatory = await db.listRequirements({
        obligation: 'mandatory',
      });
      expect(mandatory).toHaveLength(1);

      const byCriterion = await db.listRequirements({
        wcagCriterion: '1.1.1',
      });
      expect(byCriterion).toHaveLength(1);
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
    });

    it('updates a requirement', async () => {
      const req = await db.createRequirement({
        regulationId: 'eu-eaa',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '*',
        obligation: 'mandatory',
      });
      const updated = await db.updateRequirement(req.id, {
        obligation: 'recommended',
      });
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
      const all = await db.listRequirements();
      expect(all).toHaveLength(0);
    });
  });

  // --- findRequirementsByCriteria ---

  describe('findRequirementsByCriteria', () => {
    beforeEach(async () => {
      await db.createJurisdiction({
        id: 'EU',
        name: 'European Union',
        type: 'supranational',
      });
      await db.createJurisdiction({
        id: 'US',
        name: 'United States',
        type: 'country',
      });
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
      await db.createRequirement({
        regulationId: 'eu-eaa',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '*',
        obligation: 'mandatory',
      });
      await db.createRequirement({
        regulationId: 'us-508',
        wcagVersion: '2.0',
        wcagLevel: 'AA',
        wcagCriterion: '1.1.1',
        obligation: 'mandatory',
      });
    });

    it('finds requirements by jurisdiction and criteria', async () => {
      const results = await db.findRequirementsByCriteria(
        ['EU'],
        ['1.1.1'],
      );
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].regulationName).toBeTruthy();
      expect(results[0].jurisdictionId).toBe('EU');
    });

    it('finds wildcard requirements', async () => {
      const results = await db.findRequirementsByCriteria(
        ['EU'],
        ['2.4.7'],
      );
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('finds requirements across multiple jurisdictions', async () => {
      const results = await db.findRequirementsByCriteria(
        ['EU', 'US'],
        ['1.1.1'],
      );
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  // --- Update proposals ---

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
      expect(all).toHaveLength(1);
    });

    it('filters proposals by status', async () => {
      await db.createUpdateProposal({
        source: 'src',
        type: 'amendment',
        summary: 'Change',
        proposedChanges: {
          action: 'update',
          entityType: 'regulation',
          entityId: 'x',
          after: {},
        },
      });
      const pending = await db.listUpdateProposals({ status: 'pending' });
      expect(pending).toHaveLength(1);
      const approved = await db.listUpdateProposals({
        status: 'approved',
      });
      expect(approved).toHaveLength(0);
    });

    it('updates a proposal status', async () => {
      const p = await db.createUpdateProposal({
        source: 'src',
        type: 'amendment',
        summary: 'Change',
        proposedChanges: {
          action: 'update',
          entityType: 'regulation',
          entityId: 'x',
          after: {},
        },
      });
      const updated = await db.updateUpdateProposal(p.id, {
        status: 'approved',
        reviewedBy: 'admin',
        reviewedAt: new Date().toISOString(),
      });
      expect(updated.status).toBe('approved');
    });
  });

  // --- Sources ---

  describe('monitored sources', () => {
    it('creates, lists, and deletes sources', async () => {
      const s = await db.createSource({
        name: 'W3C',
        url: 'https://w3.org',
        type: 'html',
        schedule: 'weekly',
      });
      expect(s.id).toBeTruthy();

      const all = await db.listSources();
      expect(all).toHaveLength(1);

      await db.deleteSource(s.id);
      expect(await db.listSources()).toHaveLength(0);
    });

    it('updates last checked timestamp and hash', async () => {
      const s = await db.createSource({
        name: 'W3C',
        url: 'https://w3.org',
        type: 'html',
        schedule: 'weekly',
      });
      await db.updateSourceLastChecked(s.id, 'abc123hash');
      const updated = (await db.listSources())[0];
      expect(updated.lastContentHash).toBe('abc123hash');
      expect(updated.lastCheckedAt).toBeTruthy();
    });
  });

  // --- OAuth clients ---

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

      const fetched = await db.getClientById(c.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('test-app');
    });

    it('lists and deletes clients', async () => {
      await db.createClient({
        name: 'a',
        scopes: ['read'],
        grantTypes: ['client_credentials'],
      });
      await db.createClient({
        name: 'b',
        scopes: ['read', 'write'],
        grantTypes: ['client_credentials'],
      });

      const all = await db.listClients();
      expect(all).toHaveLength(2);

      await db.deleteClient(all[0].id);
      expect(await db.listClients()).toHaveLength(1);
    });
  });

  // --- Users ---

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

  // --- Webhooks ---

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
      expect(all).toHaveLength(1);

      await db.deleteWebhook(w.id);
      expect(await db.listWebhooks()).toHaveLength(0);
    });
  });
});
