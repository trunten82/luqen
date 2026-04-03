import type { DbAdapter } from '../db/adapter.js';
import type {
  UpdateProposal,
  CreateUpdateProposalInput,
  ProposedChange,
  CreateJurisdictionInput,
  CreateRegulationInput,
  CreateRequirementInput,
} from '../types.js';

export async function proposeUpdate(
  db: DbAdapter,
  input: CreateUpdateProposalInput,
): Promise<UpdateProposal> {
  return db.createUpdateProposal(input);
}

/** Apply change only if proposedChanges contain real entity data (not just contentHash metadata). */
async function safeApplyChange(db: DbAdapter, change: ProposedChange): Promise<void> {
  const { after } = change;
  const isContentHashOnly = after != null
    && 'contentHash' in after
    && Object.keys(after).length === 1;
  if (isContentHashOnly) return;

  // Handle LLM requirement diff proposals (batch of added/removed/changed)
  if (after != null && 'diff' in after && change.entityType === 'requirement') {
    await applyRequirementDiff(db, after as Record<string, unknown>);
    return;
  }

  await applyChange(db, change);
}

/** Apply a batch requirement diff from LLM extraction. */
async function applyRequirementDiff(
  db: DbAdapter,
  after: Record<string, unknown>,
): Promise<void> {
  const diff = after['diff'] as { added?: unknown[]; removed?: unknown[]; changed?: unknown[] } | undefined;
  if (!diff) return;

  for (const req of diff.added ?? []) {
    try {
      await db.createRequirement(req as CreateRequirementInput);
    } catch { /* skip duplicates */ }
  }

  for (const req of diff.removed ?? []) {
    const r = req as { regulationId?: string; wcagVersion?: string; wcagCriterion?: string };
    if (r.regulationId && r.wcagCriterion) {
      const existing = await db.listRequirements({ regulationId: r.regulationId });
      const match = existing.find(
        (e) => e.wcagCriterion === r.wcagCriterion && e.wcagVersion === r.wcagVersion,
      );
      if (match) {
        await db.deleteRequirement(match.id);
      }
    }
  }

  for (const ch of diff.changed ?? []) {
    const c = ch as { wcagCriterion?: string; wcagVersion?: string; newObligation?: string };
    if (!c.wcagCriterion || !c.newObligation) continue;
    // Find and update the requirement by criterion + version
    const afterData = after as Record<string, unknown>;
    const regId = (afterData['regulationId'] ?? '') as string;
    if (!regId) continue;
    const existing = await db.listRequirements({ regulationId: regId });
    const match = existing.find(
      (e) => e.wcagCriterion === c.wcagCriterion && e.wcagVersion === c.wcagVersion,
    );
    if (match) {
      await db.updateRequirement(match.id, { obligation: c.newObligation as 'mandatory' | 'recommended' | 'optional' | 'excluded' });
    }
  }
}

async function applyChange(db: DbAdapter, change: ProposedChange): Promise<void> {
  const { action, entityType, entityId, after } = change;

  if (action === 'create') {
    if (entityType === 'jurisdiction') {
      await db.createJurisdiction(after as unknown as CreateJurisdictionInput);
    } else if (entityType === 'regulation') {
      await db.createRegulation(after as unknown as CreateRegulationInput);
    } else if (entityType === 'requirement') {
      await db.createRequirement(after as unknown as CreateRequirementInput);
    }
    return;
  }

  if (action === 'update') {
    if (entityId == null) {
      throw new Error(`entityId is required for update action`);
    }
    if (entityType === 'jurisdiction') {
      await db.updateJurisdiction(entityId, after as Partial<CreateJurisdictionInput>);
    } else if (entityType === 'regulation') {
      await db.updateRegulation(entityId, after as Partial<CreateRegulationInput>);
    } else if (entityType === 'requirement') {
      await db.updateRequirement(entityId, after as Partial<CreateRequirementInput>);
    }
    return;
  }

  if (action === 'delete') {
    if (entityId == null) {
      throw new Error(`entityId is required for delete action`);
    }
    if (entityType === 'jurisdiction') {
      await db.deleteJurisdiction(entityId);
    } else if (entityType === 'regulation') {
      await db.deleteRegulation(entityId);
    } else if (entityType === 'requirement') {
      await db.deleteRequirement(entityId);
    }
    return;
  }
}

export async function approveUpdate(
  db: DbAdapter,
  proposalId: string,
  reviewedBy: string,
): Promise<UpdateProposal> {
  const proposal = await db.getUpdateProposal(proposalId);
  if (proposal == null) {
    throw new Error(`UpdateProposal not found: ${proposalId}`);
  }

  await safeApplyChange(db, proposal.proposedChanges);

  const now = new Date().toISOString();
  return db.updateUpdateProposal(proposalId, {
    status: 'approved',
    reviewedBy,
    reviewedAt: now,
  });
}

export async function rejectUpdate(
  db: DbAdapter,
  proposalId: string,
  reviewedBy: string,
): Promise<UpdateProposal> {
  const proposal = await db.getUpdateProposal(proposalId);
  if (proposal == null) {
    throw new Error(`UpdateProposal not found: ${proposalId}`);
  }

  const now = new Date().toISOString();
  return db.updateUpdateProposal(proposalId, {
    status: 'rejected',
    reviewedBy,
    reviewedAt: now,
  });
}

export async function listPendingUpdates(db: DbAdapter): Promise<UpdateProposal[]> {
  return db.listUpdateProposals({ status: 'pending' });
}

export async function acknowledgeUpdate(
  db: DbAdapter,
  proposalId: string,
  acknowledgedBy: string,
  notes?: string,
): Promise<UpdateProposal> {
  const proposal = await db.getUpdateProposal(proposalId);
  if (proposal == null) {
    throw new Error(`UpdateProposal not found: ${proposalId}`);
  }

  await safeApplyChange(db, proposal.proposedChanges);

  const now = new Date().toISOString();
  return db.updateUpdateProposal(proposalId, {
    status: 'acknowledged',
    acknowledgedBy,
    acknowledgedAt: now,
    notes: notes ?? undefined,
  });
}

export async function reviewUpdate(
  db: DbAdapter,
  proposalId: string,
  reviewedBy: string,
  notes?: string,
): Promise<UpdateProposal> {
  const proposal = await db.getUpdateProposal(proposalId);
  if (proposal == null) {
    throw new Error(`UpdateProposal not found: ${proposalId}`);
  }

  await safeApplyChange(db, proposal.proposedChanges);

  const now = new Date().toISOString();
  return db.updateUpdateProposal(proposalId, {
    status: 'reviewed',
    reviewedBy,
    reviewedAt: now,
    notes: notes ?? undefined,
  });
}

export async function dismissUpdate(
  db: DbAdapter,
  proposalId: string,
  reviewedBy: string,
  notes?: string,
): Promise<UpdateProposal> {
  const proposal = await db.getUpdateProposal(proposalId);
  if (proposal == null) {
    throw new Error(`UpdateProposal not found: ${proposalId}`);
  }

  const now = new Date().toISOString();
  return db.updateUpdateProposal(proposalId, {
    status: 'dismissed',
    reviewedBy,
    reviewedAt: now,
    notes: notes ?? undefined,
  });
}
