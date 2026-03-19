import type { DbAdapter } from '../db/adapter.js';
import type {
  Jurisdiction,
  Regulation,
  Requirement,
  CreateJurisdictionInput,
  CreateRegulationInput,
  CreateRequirementInput,
} from '../types.js';

// ---- Constants for validation ----

const VALID_JURISDICTION_TYPES = new Set<string>(['supranational', 'country', 'state']);
const VALID_REGULATION_STATUSES = new Set<string>(['active', 'draft', 'repealed']);
const VALID_REGULATION_SCOPES = new Set<string>(['public', 'private', 'all']);
const VALID_WCAG_VERSIONS = new Set<string>(['2.0', '2.1', '2.2']);
const VALID_WCAG_LEVELS = new Set<string>(['A', 'AA', 'AAA']);
const VALID_OBLIGATIONS = new Set<string>(['mandatory', 'recommended', 'optional']);

// ---- Jurisdiction CRUD ----

export async function createJurisdiction(
  db: DbAdapter,
  input: CreateJurisdictionInput,
): Promise<Jurisdiction> {
  if (!VALID_JURISDICTION_TYPES.has(input.type)) {
    throw new Error(
      `Invalid type "${input.type}". Must be one of: ${[...VALID_JURISDICTION_TYPES].join(', ')}`,
    );
  }

  if (input.parentId != null) {
    const parent = await db.getJurisdiction(input.parentId);
    if (parent === null) {
      throw new Error(`Parent jurisdiction "${input.parentId}" not found`);
    }
  }

  return db.createJurisdiction(input);
}

export async function updateJurisdiction(
  db: DbAdapter,
  id: string,
  input: Partial<CreateJurisdictionInput>,
): Promise<Jurisdiction> {
  const existing = await db.getJurisdiction(id);
  if (existing === null) {
    throw new Error(`Jurisdiction "${id}" not found`);
  }

  if (input.type != null && !VALID_JURISDICTION_TYPES.has(input.type)) {
    throw new Error(
      `Invalid type "${input.type}". Must be one of: ${[...VALID_JURISDICTION_TYPES].join(', ')}`,
    );
  }

  if (input.parentId != null) {
    const parent = await db.getJurisdiction(input.parentId);
    if (parent === null) {
      throw new Error(`Parent jurisdiction "${input.parentId}" not found`);
    }
  }

  return db.updateJurisdiction(id, input);
}

export interface DeleteResult {
  readonly warning?: string;
}

export async function deleteJurisdiction(db: DbAdapter, id: string): Promise<DeleteResult> {
  const regulations = await db.listRegulations({ jurisdictionId: id });
  let warning: string | undefined;

  if (regulations.length > 0) {
    warning = `Jurisdiction "${id}" has ${regulations.length} regulation(s). Cascading delete to child regulations.`;
    // Cascade: delete all child regulations first to satisfy FK constraints
    for (const regulation of regulations) {
      await db.deleteRegulation(regulation.id);
    }
  }

  await db.deleteJurisdiction(id);

  return warning !== undefined ? { warning } : {};
}

// ---- Regulation CRUD ----

export async function createRegulation(
  db: DbAdapter,
  input: CreateRegulationInput,
): Promise<Regulation> {
  const jurisdiction = await db.getJurisdiction(input.jurisdictionId);
  if (jurisdiction === null) {
    throw new Error(`Jurisdiction "${input.jurisdictionId}" not found`);
  }

  if (!VALID_REGULATION_STATUSES.has(input.status)) {
    throw new Error(
      `Invalid status "${input.status}". Must be one of: ${[...VALID_REGULATION_STATUSES].join(', ')}`,
    );
  }

  if (!VALID_REGULATION_SCOPES.has(input.scope)) {
    throw new Error(
      `Invalid scope "${input.scope}". Must be one of: ${[...VALID_REGULATION_SCOPES].join(', ')}`,
    );
  }

  return db.createRegulation(input);
}

export async function updateRegulation(
  db: DbAdapter,
  id: string,
  input: Partial<CreateRegulationInput>,
): Promise<Regulation> {
  const existing = await db.getRegulation(id);
  if (existing === null) {
    throw new Error(`Regulation "${id}" not found`);
  }

  if (input.status != null && !VALID_REGULATION_STATUSES.has(input.status)) {
    throw new Error(
      `Invalid status "${input.status}". Must be one of: ${[...VALID_REGULATION_STATUSES].join(', ')}`,
    );
  }

  if (input.scope != null && !VALID_REGULATION_SCOPES.has(input.scope)) {
    throw new Error(
      `Invalid scope "${input.scope}". Must be one of: ${[...VALID_REGULATION_SCOPES].join(', ')}`,
    );
  }

  if (input.jurisdictionId != null) {
    const jurisdiction = await db.getJurisdiction(input.jurisdictionId);
    if (jurisdiction === null) {
      throw new Error(`Jurisdiction "${input.jurisdictionId}" not found`);
    }
  }

  return db.updateRegulation(id, input);
}

export async function deleteRegulation(db: DbAdapter, id: string): Promise<void> {
  await db.deleteRegulation(id);
}

// ---- Requirement CRUD ----

export async function createRequirement(
  db: DbAdapter,
  input: CreateRequirementInput,
): Promise<Requirement> {
  const regulation = await db.getRegulation(input.regulationId);
  if (regulation === null) {
    throw new Error(`Regulation "${input.regulationId}" not found`);
  }

  if (!VALID_WCAG_VERSIONS.has(input.wcagVersion)) {
    throw new Error(
      `Invalid WCAG version "${input.wcagVersion}". Must be one of: ${[...VALID_WCAG_VERSIONS].join(', ')}`,
    );
  }

  if (!VALID_WCAG_LEVELS.has(input.wcagLevel)) {
    throw new Error(
      `Invalid WCAG level "${input.wcagLevel}". Must be one of: ${[...VALID_WCAG_LEVELS].join(', ')}`,
    );
  }

  if (!VALID_OBLIGATIONS.has(input.obligation)) {
    throw new Error(
      `Invalid obligation "${input.obligation}". Must be one of: ${[...VALID_OBLIGATIONS].join(', ')}`,
    );
  }

  return db.createRequirement(input);
}

export async function updateRequirement(
  db: DbAdapter,
  id: string,
  input: Partial<CreateRequirementInput>,
): Promise<Requirement> {
  const existing = await db.getRequirement(id);
  if (existing === null) {
    throw new Error(`Requirement "${id}" not found`);
  }

  if (input.wcagVersion != null && !VALID_WCAG_VERSIONS.has(input.wcagVersion)) {
    throw new Error(
      `Invalid WCAG version "${input.wcagVersion}". Must be one of: ${[...VALID_WCAG_VERSIONS].join(', ')}`,
    );
  }

  if (input.wcagLevel != null && !VALID_WCAG_LEVELS.has(input.wcagLevel)) {
    throw new Error(
      `Invalid WCAG level "${input.wcagLevel}". Must be one of: ${[...VALID_WCAG_LEVELS].join(', ')}`,
    );
  }

  if (input.obligation != null && !VALID_OBLIGATIONS.has(input.obligation)) {
    throw new Error(
      `Invalid obligation "${input.obligation}". Must be one of: ${[...VALID_OBLIGATIONS].join(', ')}`,
    );
  }

  if (input.regulationId != null) {
    const regulation = await db.getRegulation(input.regulationId);
    if (regulation === null) {
      throw new Error(`Regulation "${input.regulationId}" not found`);
    }
  }

  return db.updateRequirement(id, input);
}

export async function deleteRequirement(db: DbAdapter, id: string): Promise<void> {
  const existing = await db.getRequirement(id);
  if (existing === null) {
    throw new Error(`Requirement "${id}" not found`);
  }

  await db.deleteRequirement(id);
}
