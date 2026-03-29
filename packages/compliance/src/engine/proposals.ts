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

  await applyChange(db, proposal.proposedChanges);

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

  await applyChange(db, proposal.proposedChanges);

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

  await applyChange(db, proposal.proposedChanges);

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
