import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';
import {
  proposeUpdate,
  approveUpdate,
  rejectUpdate,
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

    it('throws when proposal does not exist', async () => {
      await expect(approveUpdate(db, 'nonexistent-id', 'admin')).rejects.toThrow();
    });
  });

  describe('rejectUpdate', () => {
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
});
