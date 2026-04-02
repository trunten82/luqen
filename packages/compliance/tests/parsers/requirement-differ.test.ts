import { describe, it, expect } from 'vitest';
import { diffRequirements } from '../../src/parsers/requirement-differ.js';
import type { CreateRequirementInput } from '../../src/types.js';

const REG_ID = 'EU-EAA';

function makeReq(
  wcagVersion: '2.0' | '2.1' | '2.2',
  wcagCriterion: string,
  obligation: CreateRequirementInput['obligation'],
  wcagLevel: 'A' | 'AA' | 'AAA' = 'A',
): CreateRequirementInput {
  return {
    regulationId: REG_ID,
    wcagVersion,
    wcagLevel,
    wcagCriterion,
    obligation,
  };
}

describe('diffRequirements', () => {
  describe('when sets are identical', () => {
    it('returns no added, removed, or changed requirements', () => {
      const reqs = [
        makeReq('2.1', '1.1.1', 'mandatory'),
        makeReq('2.1', '1.2.1', 'recommended'),
      ];

      const diff = diffRequirements(REG_ID, reqs, reqs);

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.changed).toHaveLength(0);
    });

    it('reports hasChanges as false', () => {
      const reqs = [makeReq('2.1', '1.1.1', 'mandatory')];
      const diff = diffRequirements(REG_ID, reqs, reqs);
      expect(diff.hasChanges).toBe(false);
    });

    it('returns empty proposed changes array', () => {
      const reqs = [makeReq('2.1', '1.1.1', 'mandatory')];
      const diff = diffRequirements(REG_ID, reqs, reqs);
      expect(diff.toProposedChanges()).toHaveLength(0);
    });
  });

  describe('when current is empty', () => {
    it('detects all extracted requirements as added', () => {
      const extracted = [
        makeReq('2.1', '1.1.1', 'mandatory'),
        makeReq('2.1', '1.2.1', 'recommended'),
      ];

      const diff = diffRequirements(REG_ID, [], extracted);

      expect(diff.added).toHaveLength(2);
      expect(diff.removed).toHaveLength(0);
      expect(diff.changed).toHaveLength(0);
      expect(diff.hasChanges).toBe(true);
    });
  });

  describe('when extracted is empty', () => {
    it('detects all current requirements as removed', () => {
      const current = [
        makeReq('2.1', '1.1.1', 'mandatory'),
        makeReq('2.1', '2.1.1', 'optional'),
      ];

      const diff = diffRequirements(REG_ID, current, []);

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(2);
      expect(diff.changed).toHaveLength(0);
      expect(diff.hasChanges).toBe(true);
    });
  });

  describe('detecting added requirements', () => {
    it('identifies new requirements not present in current', () => {
      const current = [makeReq('2.1', '1.1.1', 'mandatory')];
      const extracted = [
        makeReq('2.1', '1.1.1', 'mandatory'),
        makeReq('2.1', '1.3.1', 'mandatory', 'AA'),
        makeReq('2.2', '2.4.7', 'recommended', 'AA'),
      ];

      const diff = diffRequirements(REG_ID, current, extracted);

      expect(diff.added).toHaveLength(2);
      const addedCriteria = diff.added.map(r => r.wcagCriterion);
      expect(addedCriteria).toContain('1.3.1');
      expect(addedCriteria).toContain('2.4.7');
    });

    it('includes full requirement data for added entries', () => {
      const extracted = [makeReq('2.1', '1.1.1', 'mandatory', 'A')];
      const diff = diffRequirements(REG_ID, [], extracted);

      expect(diff.added[0]).toMatchObject({
        wcagVersion: '2.1',
        wcagCriterion: '1.1.1',
        wcagLevel: 'A',
        obligation: 'mandatory',
      });
    });
  });

  describe('detecting removed requirements', () => {
    it('identifies requirements present in current but not in extracted', () => {
      const current = [
        makeReq('2.1', '1.1.1', 'mandatory'),
        makeReq('2.1', '1.2.1', 'recommended'),
        makeReq('2.1', '3.3.1', 'optional'),
      ];
      const extracted = [makeReq('2.1', '1.1.1', 'mandatory')];

      const diff = diffRequirements(REG_ID, current, extracted);

      expect(diff.removed).toHaveLength(2);
      const removedCriteria = diff.removed.map(r => r.wcagCriterion);
      expect(removedCriteria).toContain('1.2.1');
      expect(removedCriteria).toContain('3.3.1');
    });

    it('treats different wcagVersion as different keys', () => {
      const current = [makeReq('2.0', '1.1.1', 'mandatory')];
      const extracted = [makeReq('2.1', '1.1.1', 'mandatory')];

      const diff = diffRequirements(REG_ID, current, extracted);

      // 2.0:1.1.1 removed, 2.1:1.1.1 added
      expect(diff.removed).toHaveLength(1);
      expect(diff.added).toHaveLength(1);
      expect(diff.removed[0].wcagVersion).toBe('2.0');
      expect(diff.added[0].wcagVersion).toBe('2.1');
    });
  });

  describe('detecting changed requirements', () => {
    it('identifies obligation changes for matching criterion keys', () => {
      const current = [makeReq('2.1', '1.1.1', 'recommended')];
      const extracted = [makeReq('2.1', '1.1.1', 'mandatory')];

      const diff = diffRequirements(REG_ID, current, extracted);

      expect(diff.changed).toHaveLength(1);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
    });

    it('captures old and new obligation in changed entries', () => {
      const current = [makeReq('2.1', '2.4.1', 'optional', 'AA')];
      const extracted = [makeReq('2.1', '2.4.1', 'mandatory', 'AA')];

      const diff = diffRequirements(REG_ID, current, extracted);

      expect(diff.changed[0]).toMatchObject({
        wcagCriterion: '2.4.1',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        oldObligation: 'optional',
        newObligation: 'mandatory',
      });
    });

    it('detects multiple obligation changes', () => {
      const current = [
        makeReq('2.1', '1.1.1', 'optional'),
        makeReq('2.1', '1.3.1', 'recommended'),
        makeReq('2.1', '2.4.1', 'mandatory'),
      ];
      const extracted = [
        makeReq('2.1', '1.1.1', 'mandatory'),
        makeReq('2.1', '1.3.1', 'mandatory'),
        makeReq('2.1', '2.4.1', 'mandatory'),
      ];

      const diff = diffRequirements(REG_ID, current, extracted);

      expect(diff.changed).toHaveLength(2);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
    });

    it('does not flag as changed when only notes differ (obligation same)', () => {
      const current = [{ ...makeReq('2.1', '1.1.1', 'mandatory'), notes: 'old note' }];
      const extracted = [{ ...makeReq('2.1', '1.1.1', 'mandatory'), notes: 'new note' }];

      const diff = diffRequirements(REG_ID, current, extracted);

      expect(diff.changed).toHaveLength(0);
      expect(diff.hasChanges).toBe(false);
    });
  });

  describe('toProposedChanges', () => {
    it('generates create proposals for added requirements', () => {
      const extracted = [makeReq('2.1', '1.1.1', 'mandatory', 'A')];
      const diff = diffRequirements(REG_ID, [], extracted);
      const proposals = diff.toProposedChanges();

      expect(proposals).toHaveLength(1);
      expect(proposals[0].action).toBe('create');
      expect(proposals[0].entityType).toBe('requirement');
      expect(proposals[0].after).toMatchObject({
        wcagCriterion: '1.1.1',
        wcagVersion: '2.1',
        obligation: 'mandatory',
        regulationId: REG_ID,
      });
    });

    it('generates delete proposals for removed requirements', () => {
      const current = [makeReq('2.1', '3.3.1', 'optional')];
      const diff = diffRequirements(REG_ID, current, []);
      const proposals = diff.toProposedChanges();

      expect(proposals).toHaveLength(1);
      expect(proposals[0].action).toBe('delete');
      expect(proposals[0].entityType).toBe('requirement');
      expect(proposals[0].entityId).toBe(`${REG_ID}:2.1:3.3.1`);
      expect(proposals[0].before).toMatchObject({ wcagCriterion: '3.3.1' });
    });

    it('generates update proposals for changed requirements', () => {
      const current = [makeReq('2.1', '1.4.3', 'recommended', 'AA')];
      const extracted = [makeReq('2.1', '1.4.3', 'mandatory', 'AA')];
      const diff = diffRequirements(REG_ID, current, extracted);
      const proposals = diff.toProposedChanges();

      expect(proposals).toHaveLength(1);
      expect(proposals[0].action).toBe('update');
      expect(proposals[0].entityType).toBe('requirement');
      expect(proposals[0].entityId).toBe(`${REG_ID}:2.1:1.4.3`);
      expect(proposals[0].before).toEqual({ obligation: 'recommended' });
      expect(proposals[0].after).toMatchObject({
        obligation: 'mandatory',
        regulationId: REG_ID,
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '1.4.3',
      });
    });

    it('generates mixed proposals for a combination of changes', () => {
      const current = [
        makeReq('2.1', '1.1.1', 'mandatory'),
        makeReq('2.1', '1.2.1', 'optional'),
        makeReq('2.1', '2.1.1', 'recommended'),
      ];
      const extracted = [
        makeReq('2.1', '1.1.1', 'mandatory'),   // unchanged
        makeReq('2.1', '1.2.1', 'mandatory'),   // obligation changed
        makeReq('2.1', '3.1.1', 'mandatory'),   // new
        // 2.1.1 removed
      ];

      const diff = diffRequirements(REG_ID, current, extracted);
      const proposals = diff.toProposedChanges();

      expect(proposals).toHaveLength(3);
      const actions = proposals.map(p => p.action).sort();
      expect(actions).toEqual(['create', 'delete', 'update']);
    });

    it('returns empty array when no changes', () => {
      const reqs = [makeReq('2.1', '1.1.1', 'mandatory')];
      const diff = diffRequirements(REG_ID, reqs, reqs);
      expect(diff.toProposedChanges()).toHaveLength(0);
    });
  });

  describe('regulationId propagation', () => {
    it('stores the regulationId on the returned diff', () => {
      const diff = diffRequirements('MY-REG', [], []);
      expect(diff.regulationId).toBe('MY-REG');
    });

    it('uses regulationId from argument (not from input) in create proposals', () => {
      const req = makeReq('2.1', '1.1.1', 'mandatory');
      const diff = diffRequirements('OVERRIDE-REG', [], [req]);
      const proposals = diff.toProposedChanges();

      expect(proposals[0].after).toMatchObject({ regulationId: 'OVERRIDE-REG' });
    });

    it('uses regulationId in entityId for delete proposals', () => {
      const req = makeReq('2.1', '1.1.1', 'mandatory');
      const diff = diffRequirements('MY-REG-2', [req], []);
      const proposals = diff.toProposedChanges();

      expect(proposals[0].entityId).toMatch(/^MY-REG-2:/);
    });
  });

  describe('hasChanges flag', () => {
    it('is true when there are only added requirements', () => {
      const diff = diffRequirements(REG_ID, [], [makeReq('2.1', '1.1.1', 'mandatory')]);
      expect(diff.hasChanges).toBe(true);
    });

    it('is true when there are only removed requirements', () => {
      const diff = diffRequirements(REG_ID, [makeReq('2.1', '1.1.1', 'mandatory')], []);
      expect(diff.hasChanges).toBe(true);
    });

    it('is true when there are only obligation changes', () => {
      const current = [makeReq('2.1', '1.1.1', 'optional')];
      const extracted = [makeReq('2.1', '1.1.1', 'mandatory')];
      const diff = diffRequirements(REG_ID, current, extracted);
      expect(diff.hasChanges).toBe(true);
    });

    it('is false when both sets are empty', () => {
      const diff = diffRequirements(REG_ID, [], []);
      expect(diff.hasChanges).toBe(false);
    });
  });
});
