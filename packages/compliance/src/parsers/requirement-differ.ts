import type { CreateRequirementInput, ProposedChange } from '../types.js';

export interface RequirementChange {
  readonly wcagCriterion: string;
  readonly wcagVersion: string;
  readonly wcagLevel: string;
  readonly oldObligation: string;
  readonly newObligation: string;
}

export interface RequirementDiff {
  readonly regulationId: string;
  readonly added: readonly CreateRequirementInput[];
  readonly removed: readonly CreateRequirementInput[];
  readonly changed: readonly RequirementChange[];
  readonly hasChanges: boolean;
  toProposedChanges(): ProposedChange[];
}

function reqKey(r: { wcagVersion: string; wcagCriterion: string }): string {
  return `${r.wcagVersion}:${r.wcagCriterion}`;
}

export function diffRequirements(
  regulationId: string,
  current: readonly CreateRequirementInput[],
  extracted: readonly CreateRequirementInput[],
): RequirementDiff {
  const currentMap = new Map(current.map(r => [reqKey(r), r]));
  const extractedMap = new Map(extracted.map(r => [reqKey(r), r]));

  const added: CreateRequirementInput[] = [];
  const removed: CreateRequirementInput[] = [];
  const changed: RequirementChange[] = [];

  for (const [key, req] of extractedMap) {
    const existing = currentMap.get(key);
    if (existing == null) {
      added.push(req);
    } else if (existing.obligation !== req.obligation) {
      changed.push({
        wcagCriterion: req.wcagCriterion,
        wcagVersion: req.wcagVersion,
        wcagLevel: req.wcagLevel,
        oldObligation: existing.obligation,
        newObligation: req.obligation,
      });
    }
  }

  for (const [key, req] of currentMap) {
    if (!extractedMap.has(key)) {
      removed.push(req);
    }
  }

  const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0;

  return {
    regulationId,
    added,
    removed,
    changed,
    hasChanges,
    toProposedChanges(): ProposedChange[] {
      const proposals: ProposedChange[] = [];
      for (const req of added) {
        proposals.push({
          action: 'create',
          entityType: 'requirement',
          after: { ...req, regulationId } as unknown as Record<string, unknown>,
        });
      }
      for (const req of removed) {
        proposals.push({
          action: 'delete',
          entityType: 'requirement',
          entityId: `${regulationId}:${req.wcagVersion}:${req.wcagCriterion}`,
          before: req as unknown as Record<string, unknown>,
        });
      }
      for (const ch of changed) {
        proposals.push({
          action: 'update',
          entityType: 'requirement',
          entityId: `${regulationId}:${ch.wcagVersion}:${ch.wcagCriterion}`,
          before: { obligation: ch.oldObligation },
          after: { obligation: ch.newObligation, regulationId, wcagVersion: ch.wcagVersion, wcagLevel: ch.wcagLevel, wcagCriterion: ch.wcagCriterion },
        });
      }
      return proposals;
    },
  };
}
