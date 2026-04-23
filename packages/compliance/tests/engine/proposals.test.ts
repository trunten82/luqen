import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';
import {
  proposeUpdate,
  approveUpdate,
  rejectUpdate,
  acknowledgeUpdate,
  listPendingUpdates,
} from '../../src/engine/proposals.js';

describe('proposals', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
    // Seed a jurisdiction so foreign-key-dependent operations work
    await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
  });

  afterEach(async () => {
    await db.close();
  });

  describe('proposeUpdate', () => {
    it('creates a proposal with status pending', async () => {
      const proposal = await proposeUpdate(db, {
        source: 'monitor-bot',
        type: 'new_regulation',
        affectedJurisdictionId: 'EU',
        summary: 'New regulation detected',
        proposedChanges: {
          action: 'create',
          entityType: 'regulation',
          after: {
            id: 'EU-NEW',
            jurisdictionId: 'EU',
            name: 'New Reg',
            shortName: 'NR',
            reference: 'ref',
            url: 'https://example.com',
            enforcementDate: '2025-01-01',
            status: 'active',
            scope: 'public',
            sectors: [],
            description: 'New regulation',
          },
        },
      });

      expect(proposal.status).toBe('pending');
      expect(proposal.source).toBe('monitor-bot');
      expect(proposal.id).toBeTruthy();
      expect(proposal.detectedAt).toBeTruthy();
      expect(proposal.createdAt).toBeTruthy();
    });
  });

  describe('listPendingUpdates', () => {
    it('returns only pending proposals', async () => {
      const p1 = await proposeUpdate(db, {
        source: 'bot',
        type: 'amendment',
        summary: 'Amendment',
        proposedChanges: { action: 'update', entityType: 'jurisdiction', entityId: 'EU', after: { name: 'EU Updated' } },
      });
      const p2 = await proposeUpdate(db, {
        source: 'bot',
        type: 'new_jurisdiction',
        summary: 'New jurisdiction',
        proposedChanges: { action: 'create', entityType: 'jurisdiction', after: { id: 'XX', name: 'XX', type: 'country' } },
      });

      // Approve p1
      await approveUpdate(db, p1.id, 'admin');

      const pending = await listPendingUpdates(db);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(p2.id);
    });
  });

  describe('approveUpdate', () => {
    it('applies a create-jurisdiction change and marks proposal approved', async () => {
      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'new_jurisdiction',
        summary: 'New country',
        proposedChanges: {
          action: 'create',
          entityType: 'jurisdiction',
          after: { id: 'JP', name: 'Japan', type: 'country', iso3166: 'JP' },
        },
      });

      const approved = await approveUpdate(db, proposal.id, 'admin-user');

      expect(approved.status).toBe('approved');
      expect(approved.reviewedBy).toBe('admin-user');
      expect(approved.reviewedAt).toBeTruthy();

      const jp = await db.getJurisdiction('JP');
      expect(jp).not.toBeNull();
      expect(jp!.name).toBe('Japan');
    });

    it('applies a create-regulation change', async () => {
      const regData = {
        id: 'EU-EAA',
        jurisdictionId: 'EU',
        name: 'European Accessibility Act',
        shortName: 'EAA',
        reference: 'EU 2019/882',
        url: 'https://example.com',
        enforcementDate: '2025-06-28',
        status: 'active' as const,
        scope: 'all' as const,
        sectors: [],
        description: 'EAA description',
      };

      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'new_regulation',
        summary: 'New EAA',
        proposedChanges: { action: 'create', entityType: 'regulation', after: regData },
      });

      await approveUpdate(db, proposal.id, 'admin');

      const reg = await db.getRegulation('EU-EAA');
      expect(reg).not.toBeNull();
      expect(reg!.shortName).toBe('EAA');
    });

    it('applies an update-jurisdiction change', async () => {
      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'amendment',
        summary: 'Rename EU',
        proposedChanges: {
          action: 'update',
          entityType: 'jurisdiction',
          entityId: 'EU',
          after: { name: 'European Union (Updated)' },
        },
      });

      await approveUpdate(db, proposal.id, 'admin');

      const eu = await db.getJurisdiction('EU');
      expect(eu!.name).toBe('European Union (Updated)');
    });

    it('applies a delete-jurisdiction change', async () => {
      await db.createJurisdiction({ id: 'XX', name: 'Obsolete', type: 'country' });

      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'repeal',
        summary: 'Remove XX',
        proposedChanges: {
          action: 'delete',
          entityType: 'jurisdiction',
          entityId: 'XX',
        },
      });

      await approveUpdate(db, proposal.id, 'admin');

      const xx = await db.getJurisdiction('XX');
      expect(xx).toBeNull();
    });

    it('applies a create-requirement change', async () => {
      // First create a regulation
      await db.createRegulation({
        id: 'EU-TEST',
        jurisdictionId: 'EU',
        name: 'Test Reg',
        shortName: 'TR',
        reference: 'TR-1',
        url: 'https://example.com',
        enforcementDate: '2025-01-01',
        status: 'active',
        scope: 'public',
        sectors: [],
        description: 'Test regulation',
      });

      const reqData = {
        regulationId: 'EU-TEST',
        wcagVersion: '2.1' as const,
        wcagLevel: 'A' as const,
        wcagCriterion: '1.1.1',
        obligation: 'mandatory' as const,
        notes: '',
      };

      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'new_requirement',
        summary: 'New requirement',
        proposedChanges: { action: 'create', entityType: 'requirement', after: reqData },
      });

      await approveUpdate(db, proposal.id, 'admin');

      const reqs = await db.listRequirements({ regulationId: 'EU-TEST' });
      expect(reqs.length).toBeGreaterThan(0);
    });

    it('applies an update-regulation change', async () => {
      // Create regulation first
      await db.createRegulation({
        id: 'EU-UPD',
        jurisdictionId: 'EU',
        name: 'Update Reg',
        shortName: 'UR',
        reference: 'UR-1',
        url: 'https://example.com',
        enforcementDate: '2025-01-01',
        status: 'active',
        scope: 'public',
        sectors: [],
        description: 'Before update',
      });

      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'amendment',
        summary: 'Update regulation description',
        proposedChanges: {
          action: 'update',
          entityType: 'regulation',
          entityId: 'EU-UPD',
          after: { description: 'After update' },
        },
      });

      await approveUpdate(db, proposal.id, 'admin');

      const reg = await db.getRegulation('EU-UPD');
      expect(reg!.description).toBe('After update');
    });

    it('applies a delete-regulation change', async () => {
      await db.createRegulation({
        id: 'EU-DEL',
        jurisdictionId: 'EU',
        name: 'Delete Reg',
        shortName: 'DR',
        reference: 'DR-1',
        url: 'https://example.com',
        enforcementDate: '2020-01-01',
        status: 'repealed',
        scope: 'public',
        sectors: [],
        description: 'To be deleted',
      });

      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'repeal',
        summary: 'Delete regulation',
        proposedChanges: {
          action: 'delete',
          entityType: 'regulation',
          entityId: 'EU-DEL',
        },
      });

      await approveUpdate(db, proposal.id, 'admin');

      const reg = await db.getRegulation('EU-DEL');
      expect(reg).toBeNull();
    });

    it('applies an update-requirement change', async () => {
      // Create regulation + requirement
      await db.createRegulation({
        id: 'EU-REQUPD',
        jurisdictionId: 'EU',
        name: 'Req Update Reg',
        shortName: 'RUR',
        reference: 'RUR-1',
        url: 'https://example.com',
        enforcementDate: '2025-01-01',
        status: 'active',
        scope: 'public',
        sectors: [],
        description: 'Test',
      });
      const req = await db.createRequirement({
        regulationId: 'EU-REQUPD',
        wcagVersion: '2.1',
        wcagLevel: 'A',
        wcagCriterion: '1.1.1',
        obligation: 'mandatory',
        notes: 'original',
      });

      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'amendment',
        summary: 'Update requirement notes',
        proposedChanges: {
          action: 'update',
          entityType: 'requirement',
          entityId: req.id,
          after: { notes: 'updated' },
        },
      });

      await approveUpdate(db, proposal.id, 'admin');

      const updatedReq = await db.getRequirement(req.id);
      expect(updatedReq!.notes).toBe('updated');
    });

    it('throws when update action has no entityId', async () => {
      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'amendment',
        summary: 'Missing entityId',
        proposedChanges: {
          action: 'update',
          entityType: 'jurisdiction',
          // no entityId
        },
      });

      await expect(approveUpdate(db, proposal.id, 'admin')).rejects.toThrow('entityId is required');
    });

    it('throws when delete action has no entityId', async () => {
      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'repeal',
        summary: 'Missing entityId for delete',
        proposedChanges: {
          action: 'delete',
          entityType: 'regulation',
          // no entityId
        },
      });

      await expect(approveUpdate(db, proposal.id, 'admin')).rejects.toThrow('entityId is required');
    });

    it('applies a delete-requirement change', async () => {
      // Create regulation + requirement
      await db.createRegulation({
        id: 'EU-REQDEL',
        jurisdictionId: 'EU',
        name: 'Req Delete Reg',
        shortName: 'RDR',
        reference: 'RDR-1',
        url: 'https://example.com',
        enforcementDate: '2025-01-01',
        status: 'active',
        scope: 'public',
        sectors: [],
        description: 'Test',
      });
      const req = await db.createRequirement({
        regulationId: 'EU-REQDEL',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '2.4.1',
        obligation: 'mandatory',
        notes: '',
      });

      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'repeal',
        summary: 'Delete requirement',
        proposedChanges: {
          action: 'delete',
          entityType: 'requirement',
          entityId: req.id,
        },
      });

      await approveUpdate(db, proposal.id, 'admin');

      const deletedReq = await db.getRequirement(req.id);
      expect(deletedReq).toBeNull();
    });

    it('throws when proposal does not exist', async () => {
      await expect(approveUpdate(db, 'nonexistent-id', 'admin')).rejects.toThrow();
    });
  });

  describe('rejectUpdate', () => {
    it('throws when proposal does not exist', async () => {
      await expect(rejectUpdate(db, 'nonexistent-id', 'admin')).rejects.toThrow();
    });

    it('marks proposal as rejected without applying changes', async () => {
      const proposal = await proposeUpdate(db, {
        source: 'bot',
        type: 'new_jurisdiction',
        summary: 'New country',
        proposedChanges: {
          action: 'create',
          entityType: 'jurisdiction',
          after: { id: 'ZZ', name: 'Zzland', type: 'country' },
        },
      });

      const rejected = await rejectUpdate(db, proposal.id, 'reviewer');

      expect(rejected.status).toBe('rejected');
      expect(rejected.reviewedBy).toBe('reviewer');
      expect(rejected.reviewedAt).toBeTruthy();

      // Entity should NOT have been created
      const zz = await db.getJurisdiction('ZZ');
      expect(zz).toBeNull();
    });
  });

  describe('acknowledgeUpdate', () => {
    it('skips apply when proposedChanges.after is source-tracker metadata (contentHash + diff)', async () => {
      // Regression: source-change proposals carry {contentHash, diff} with entityId pointing
      // at a source row, not a regulation. Earlier versions only skipped when after had a
      // single contentHash key, so {contentHash, diff} fell through to updateRegulation and
      // blew up with "Cannot read properties of undefined (reading 'id')".
      const proposal = await proposeUpdate(db, {
        source: 'monitor-bot',
        type: 'amendment',
        summary: 'Source content changed',
        proposedChanges: {
          action: 'update',
          entityType: 'regulation',
          entityId: 'not-a-real-regulation-id',
          before: { contentHash: 'abc' },
          after: {
            contentHash: 'def',
            diff: { added: ['line1'], removed: [], modified: [] },
          },
        },
      });

      const acked = await acknowledgeUpdate(db, proposal.id, 'reviewer');
      expect(acked.status).toBe('acknowledged');
      expect(acked.acknowledgedBy).toBe('reviewer');
    });
  });
});
