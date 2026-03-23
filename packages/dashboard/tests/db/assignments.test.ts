import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;
let scanId: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();

  // Create a scan as prerequisite (assignments reference scanId)
  scanId = randomUUID();
  await storage.scans.createScan({
    id: scanId,
    siteUrl: 'https://example.com',
    standard: 'WCAG2AA',
    jurisdictions: ['EU'],
    createdBy: 'alice',
    createdAt: new Date().toISOString(),
    orgId: 'org-1',
  });
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

function makeAssignmentInput(overrides: Partial<Parameters<typeof storage.assignments.createAssignment>[0]> = {}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    scanId,
    issueFingerprint: randomUUID(),
    severity: 'error',
    message: 'Missing alt text',
    createdBy: 'alice',
    createdAt: now,
    updatedAt: now,
    orgId: 'org-1',
    ...overrides,
  };
}

describe('AssignmentRepository', () => {
  describe('createAssignment', () => {
    it('sets status=open when no assignedTo provided', async () => {
      const input = makeAssignmentInput();
      const assignment = await storage.assignments.createAssignment(input);
      expect(assignment.status).toBe('open');
      expect(assignment.assignedTo).toBeNull();
    });

    it('sets status=assigned when assignedTo is set', async () => {
      const input = makeAssignmentInput({ assignedTo: 'bob' });
      const assignment = await storage.assignments.createAssignment(input);
      expect(assignment.status).toBe('assigned');
      expect(assignment.assignedTo).toBe('bob');
    });

    it('stores all provided fields', async () => {
      const now = new Date().toISOString();
      const input = makeAssignmentInput({
        wcagCriterion: '1.1.1',
        wcagTitle: 'Non-text Content',
        severity: 'error',
        message: 'Image missing alt attribute',
        selector: 'img.logo',
        pageUrl: 'https://example.com/about',
        notes: 'Needs immediate fix',
        createdBy: 'alice',
        createdAt: now,
        updatedAt: now,
        orgId: 'org-1',
      });
      const assignment = await storage.assignments.createAssignment(input);
      expect(assignment.wcagCriterion).toBe('1.1.1');
      expect(assignment.wcagTitle).toBe('Non-text Content');
      expect(assignment.selector).toBe('img.logo');
      expect(assignment.pageUrl).toBe('https://example.com/about');
      expect(assignment.notes).toBe('Needs immediate fix');
      expect(assignment.scanId).toBe(scanId);
      expect(assignment.orgId).toBe('org-1');
    });
  });

  describe('getAssignment', () => {
    it('returns assignment by ID', async () => {
      const input = makeAssignmentInput();
      await storage.assignments.createAssignment(input);
      const result = await storage.assignments.getAssignment(input.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(input.id);
    });

    it('returns null for non-existent ID', async () => {
      const result = await storage.assignments.getAssignment('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getAssignmentByFingerprint', () => {
    it('finds by scanId and fingerprint', async () => {
      const fingerprint = randomUUID();
      const input = makeAssignmentInput({ issueFingerprint: fingerprint });
      await storage.assignments.createAssignment(input);

      const result = await storage.assignments.getAssignmentByFingerprint(scanId, fingerprint);
      expect(result).not.toBeNull();
      expect(result?.issueFingerprint).toBe(fingerprint);
    });

    it('returns null when fingerprint not found', async () => {
      const result = await storage.assignments.getAssignmentByFingerprint(scanId, 'no-such-fp');
      expect(result).toBeNull();
    });
  });

  describe('listAssignments', () => {
    it('returns empty array when no assignments', async () => {
      const result = await storage.assignments.listAssignments();
      expect(result).toEqual([]);
    });

    it('orders by created_at DESC', async () => {
      const base = Date.now();
      const id1 = randomUUID();
      const id2 = randomUUID();
      const id3 = randomUUID();

      await storage.assignments.createAssignment(makeAssignmentInput({ id: id1, createdAt: new Date(base + 1000).toISOString(), updatedAt: new Date(base + 1000).toISOString() }));
      await storage.assignments.createAssignment(makeAssignmentInput({ id: id2, createdAt: new Date(base + 3000).toISOString(), updatedAt: new Date(base + 3000).toISOString() }));
      await storage.assignments.createAssignment(makeAssignmentInput({ id: id3, createdAt: new Date(base + 2000).toISOString(), updatedAt: new Date(base + 2000).toISOString() }));

      const result = await storage.assignments.listAssignments();
      expect(result[0].id).toBe(id2);
      expect(result[1].id).toBe(id3);
      expect(result[2].id).toBe(id1);
    });

    it('filters by scanId', async () => {
      // Create second scan
      const otherScanId = randomUUID();
      await storage.scans.createScan({
        id: otherScanId,
        siteUrl: 'https://other.com',
        standard: 'WCAG2AA',
        jurisdictions: [],
        createdBy: 'alice',
        createdAt: new Date().toISOString(),
        orgId: 'org-1',
      });

      await storage.assignments.createAssignment(makeAssignmentInput({ scanId }));
      await storage.assignments.createAssignment(makeAssignmentInput({ scanId: otherScanId }));

      const result = await storage.assignments.listAssignments({ scanId });
      expect(result).toHaveLength(1);
      expect(result[0].scanId).toBe(scanId);
    });

    it('filters by status', async () => {
      await storage.assignments.createAssignment(makeAssignmentInput({ assignedTo: 'bob' })); // 'assigned'
      await storage.assignments.createAssignment(makeAssignmentInput()); // 'open'

      const openResults = await storage.assignments.listAssignments({ status: 'open' });
      expect(openResults).toHaveLength(1);
      expect(openResults[0].status).toBe('open');

      const assignedResults = await storage.assignments.listAssignments({ status: 'assigned' });
      expect(assignedResults).toHaveLength(1);
      expect(assignedResults[0].status).toBe('assigned');
    });

    it('filters by assignedTo', async () => {
      await storage.assignments.createAssignment(makeAssignmentInput({ assignedTo: 'bob' }));
      await storage.assignments.createAssignment(makeAssignmentInput({ assignedTo: 'carol' }));

      const result = await storage.assignments.listAssignments({ assignedTo: 'bob' });
      expect(result).toHaveLength(1);
      expect(result[0].assignedTo).toBe('bob');
    });

    it('filters by orgId', async () => {
      await storage.assignments.createAssignment(makeAssignmentInput({ orgId: 'org-1' }));
      await storage.assignments.createAssignment(makeAssignmentInput({ orgId: 'org-2' }));

      const result = await storage.assignments.listAssignments({ orgId: 'org-1' });
      expect(result).toHaveLength(1);
      expect(result[0].orgId).toBe('org-1');
    });

    it('handles combined filters', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      await storage.assignments.createAssignment(makeAssignmentInput({ id: id1, orgId: 'org-1', assignedTo: 'bob' }));
      await storage.assignments.createAssignment(makeAssignmentInput({ id: id2, orgId: 'org-1' })); // open

      const result = await storage.assignments.listAssignments({ orgId: 'org-1', status: 'assigned' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(id1);
    });
  });

  describe('updateAssignment', () => {
    it('updates status', async () => {
      const input = makeAssignmentInput();
      await storage.assignments.createAssignment(input);
      await storage.assignments.updateAssignment(input.id, { status: 'in-progress' });
      const updated = await storage.assignments.getAssignment(input.id);
      expect(updated?.status).toBe('in-progress');
    });

    it('updates assignedTo and trims whitespace', async () => {
      const input = makeAssignmentInput();
      await storage.assignments.createAssignment(input);
      await storage.assignments.updateAssignment(input.id, { assignedTo: '  carol  ' });
      const updated = await storage.assignments.getAssignment(input.id);
      expect(updated?.assignedTo).toBe('carol');
    });

    it('updates notes', async () => {
      const input = makeAssignmentInput();
      await storage.assignments.createAssignment(input);
      await storage.assignments.updateAssignment(input.id, { notes: 'Fixed in PR #42' });
      const updated = await storage.assignments.getAssignment(input.id);
      expect(updated?.notes).toBe('Fixed in PR #42');
    });

    it('sets updatedAt on update', async () => {
      const input = makeAssignmentInput();
      await storage.assignments.createAssignment(input);
      const before = input.updatedAt;
      // Small pause to ensure time difference
      await new Promise((r) => setTimeout(r, 5));
      await storage.assignments.updateAssignment(input.id, { status: 'fixed' });
      const updated = await storage.assignments.getAssignment(input.id);
      expect(updated?.updatedAt).not.toBe(before);
    });
  });

  describe('deleteAssignment', () => {
    it('removes the assignment', async () => {
      const input = makeAssignmentInput();
      await storage.assignments.createAssignment(input);
      await storage.assignments.deleteAssignment(input.id);
      expect(await storage.assignments.getAssignment(input.id)).toBeNull();
    });
  });

  describe('getAssignmentStats', () => {
    it('returns counts per status', async () => {
      await storage.assignments.createAssignment(makeAssignmentInput()); // open
      await storage.assignments.createAssignment(makeAssignmentInput({ assignedTo: 'bob' })); // assigned
      const ip = makeAssignmentInput({ status: 'in-progress' });
      await storage.assignments.createAssignment(ip);

      const stats = await storage.assignments.getAssignmentStats(scanId);
      expect(stats.open).toBe(1);
      expect(stats.assigned).toBe(1);
      expect(stats.inProgress).toBe(1);
      expect(stats.fixed).toBe(0);
      expect(stats.verified).toBe(0);
      expect(stats.total).toBe(3);
    });

    it('returns all zeros for scan with no assignments', async () => {
      const stats = await storage.assignments.getAssignmentStats('no-such-scan');
      expect(stats).toEqual({ open: 0, assigned: 0, inProgress: 0, fixed: 0, verified: 0, total: 0 });
    });
  });
});
