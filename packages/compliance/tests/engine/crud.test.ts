import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import {
  createJurisdiction,
  updateJurisdiction,
  deleteJurisdiction,
  createRegulation,
  updateRegulation,
  deleteRegulation,
  createRequirement,
  updateRequirement,
  deleteRequirement,
} from '../../src/engine/crud.js';

// ---------- helpers ----------

async function buildDb(): Promise<SqliteAdapter> {
  const db = new SqliteAdapter(':memory:');
  await db.initialize();
  return db;
}

// ---------- jurisdiction CRUD tests ----------

describe('createJurisdiction', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = await buildDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates a jurisdiction with valid type', async () => {
    const result = await createJurisdiction(db, {
      id: 'EU',
      name: 'European Union',
      type: 'supranational',
    });

    expect(result.id).toBe('EU');
    expect(result.name).toBe('European Union');
    expect(result.type).toBe('supranational');
  });

  it('creates a jurisdiction with a valid parentId', async () => {
    await createJurisdiction(db, {
      id: 'EU',
      name: 'European Union',
      type: 'supranational',
    });

    const result = await createJurisdiction(db, {
      id: 'DE',
      name: 'Germany',
      type: 'country',
      parentId: 'EU',
      iso3166: 'DE',
    });

    expect(result.parentId).toBe('EU');
  });

  it('rejects invalid type', async () => {
    await expect(
      createJurisdiction(db, {
        id: 'XX',
        name: 'Invalid',
        type: 'invalid-type' as never,
      }),
    ).rejects.toThrow(/invalid type/i);
  });

  it('rejects non-existent parentId', async () => {
    await expect(
      createJurisdiction(db, {
        id: 'DE',
        name: 'Germany',
        type: 'country',
        parentId: 'NONEXISTENT',
      }),
    ).rejects.toThrow(/parent jurisdiction.*not found/i);
  });

  it('rejects duplicate id', async () => {
    await createJurisdiction(db, { id: 'EU', name: 'European Union', type: 'supranational' });

    await expect(
      createJurisdiction(db, { id: 'EU', name: 'Duplicate', type: 'supranational' }),
    ).rejects.toThrow();
  });
});

describe('updateJurisdiction', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = await buildDb();
    await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
  });

  afterEach(async () => {
    await db.close();
  });

  it('updates jurisdiction name', async () => {
    const result = await updateJurisdiction(db, 'EU', { name: 'EU (updated)' });
    expect(result.name).toBe('EU (updated)');
  });

  it('rejects update of non-existent jurisdiction', async () => {
    await expect(
      updateJurisdiction(db, 'NONEXISTENT', { name: 'ghost' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects update with invalid type', async () => {
    await expect(
      updateJurisdiction(db, 'EU', { type: 'bad-type' as never }),
    ).rejects.toThrow(/invalid type/i);
  });

  it('rejects update with non-existent parentId', async () => {
    await expect(
      updateJurisdiction(db, 'EU', { parentId: 'MISSING' }),
    ).rejects.toThrow(/parent jurisdiction.*not found/i);
  });
});

describe('deleteJurisdiction', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = await buildDb();
    await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
  });

  afterEach(async () => {
    await db.close();
  });

  it('deletes a jurisdiction without regulations', async () => {
    await deleteJurisdiction(db, 'EU');
    const found = await db.getJurisdiction('EU');
    expect(found).toBeNull();
  });

  it('returns a warning when jurisdiction has child regulations', async () => {
    await db.createRegulation({
      id: 'eu-eaa',
      jurisdictionId: 'EU',
      name: 'European Accessibility Act',
      shortName: 'EAA',
      reference: 'Directive 2019/882',
      url: 'https://example.com',
      enforcementDate: '2025-06-28',
      status: 'active',
      scope: 'all',
      sectors: [],
      description: 'EAA',
    });

    const result = await deleteJurisdiction(db, 'EU');
    expect(result.warning).toMatch(/regulation/i);
  });
});

// ---------- regulation CRUD tests ----------

describe('createRegulation', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = await buildDb();
    await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates a regulation with valid input', async () => {
    const result = await createRegulation(db, {
      id: 'eu-eaa',
      jurisdictionId: 'EU',
      name: 'European Accessibility Act',
      shortName: 'EAA',
      reference: 'Directive 2019/882',
      url: 'https://example.com',
      enforcementDate: '2025-06-28',
      status: 'active',
      scope: 'all',
      sectors: ['e-commerce'],
      description: 'EAA',
    });

    expect(result.id).toBe('eu-eaa');
    expect(result.jurisdictionId).toBe('EU');
  });

  it('rejects non-existent jurisdictionId', async () => {
    await expect(
      createRegulation(db, {
        id: 'reg-1',
        jurisdictionId: 'MISSING',
        name: 'Fake Reg',
        shortName: 'FR',
        reference: 'ref',
        url: 'https://example.com',
        enforcementDate: '2025-01-01',
        status: 'active',
        scope: 'all',
        sectors: [],
        description: 'desc',
      }),
    ).rejects.toThrow(/jurisdiction.*not found/i);
  });

  it('rejects invalid status', async () => {
    await expect(
      createRegulation(db, {
        id: 'reg-1',
        jurisdictionId: 'EU',
        name: 'Fake Reg',
        shortName: 'FR',
        reference: 'ref',
        url: 'https://example.com',
        enforcementDate: '2025-01-01',
        status: 'invalid' as never,
        scope: 'all',
        sectors: [],
        description: 'desc',
      }),
    ).rejects.toThrow(/invalid status/i);
  });

  it('rejects invalid scope', async () => {
    await expect(
      createRegulation(db, {
        id: 'reg-1',
        jurisdictionId: 'EU',
        name: 'Fake Reg',
        shortName: 'FR',
        reference: 'ref',
        url: 'https://example.com',
        enforcementDate: '2025-01-01',
        status: 'active',
        scope: 'both' as never,
        sectors: [],
        description: 'desc',
      }),
    ).rejects.toThrow(/invalid scope/i);
  });
});

describe('updateRegulation', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = await buildDb();
    await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
    await db.createRegulation({
      id: 'eu-eaa',
      jurisdictionId: 'EU',
      name: 'European Accessibility Act',
      shortName: 'EAA',
      reference: 'Directive 2019/882',
      url: 'https://example.com',
      enforcementDate: '2025-06-28',
      status: 'active',
      scope: 'all',
      sectors: [],
      description: 'EAA',
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('updates a regulation name', async () => {
    const result = await updateRegulation(db, 'eu-eaa', { name: 'EAA (updated)' });
    expect(result.name).toBe('EAA (updated)');
  });

  it('rejects update of non-existent regulation', async () => {
    await expect(
      updateRegulation(db, 'nonexistent', { name: 'ghost' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects update with invalid status', async () => {
    await expect(
      updateRegulation(db, 'eu-eaa', { status: 'bad' as never }),
    ).rejects.toThrow(/invalid status/i);
  });

  it('rejects update with invalid scope', async () => {
    await expect(
      updateRegulation(db, 'eu-eaa', { scope: 'everything' as never }),
    ).rejects.toThrow(/invalid scope/i);
  });

  it('rejects update with non-existent jurisdictionId', async () => {
    await expect(
      updateRegulation(db, 'eu-eaa', { jurisdictionId: 'MISSING' }),
    ).rejects.toThrow(/jurisdiction.*not found/i);
  });
});

describe('deleteRegulation', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = await buildDb();
    await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
    await db.createRegulation({
      id: 'eu-eaa',
      jurisdictionId: 'EU',
      name: 'European Accessibility Act',
      shortName: 'EAA',
      reference: 'Directive 2019/882',
      url: 'https://example.com',
      enforcementDate: '2025-06-28',
      status: 'active',
      scope: 'all',
      sectors: [],
      description: 'EAA',
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('deletes a regulation', async () => {
    await deleteRegulation(db, 'eu-eaa');
    const found = await db.getRegulation('eu-eaa');
    expect(found).toBeNull();
  });
});

// ---------- requirement CRUD tests ----------

describe('createRequirement', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = await buildDb();
    await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
    await db.createRegulation({
      id: 'eu-eaa',
      jurisdictionId: 'EU',
      name: 'European Accessibility Act',
      shortName: 'EAA',
      reference: 'Directive 2019/882',
      url: 'https://example.com',
      enforcementDate: '2025-06-28',
      status: 'active',
      scope: 'all',
      sectors: [],
      description: 'EAA',
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates a requirement with valid input', async () => {
    const result = await createRequirement(db, {
      regulationId: 'eu-eaa',
      wcagVersion: '2.1',
      wcagLevel: 'AA',
      wcagCriterion: '*',
      obligation: 'mandatory',
    });

    expect(result.regulationId).toBe('eu-eaa');
    expect(result.wcagCriterion).toBe('*');
    expect(result.obligation).toBe('mandatory');
  });

  it('rejects non-existent regulationId', async () => {
    await expect(
      createRequirement(db, {
        regulationId: 'MISSING',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '*',
        obligation: 'mandatory',
      }),
    ).rejects.toThrow(/regulation.*not found/i);
  });

  it('rejects invalid wcagVersion', async () => {
    await expect(
      createRequirement(db, {
        regulationId: 'eu-eaa',
        wcagVersion: '3.0' as never,
        wcagLevel: 'AA',
        wcagCriterion: '1.1.1',
        obligation: 'mandatory',
      }),
    ).rejects.toThrow(/invalid wcag version/i);
  });

  it('rejects invalid wcagLevel', async () => {
    await expect(
      createRequirement(db, {
        regulationId: 'eu-eaa',
        wcagVersion: '2.1',
        wcagLevel: 'B' as never,
        wcagCriterion: '1.1.1',
        obligation: 'mandatory',
      }),
    ).rejects.toThrow(/invalid wcag level/i);
  });

  it('rejects invalid obligation', async () => {
    await expect(
      createRequirement(db, {
        regulationId: 'eu-eaa',
        wcagVersion: '2.1',
        wcagLevel: 'AA',
        wcagCriterion: '1.1.1',
        obligation: 'required' as never,
      }),
    ).rejects.toThrow(/invalid obligation/i);
  });
});

describe('updateRequirement', () => {
  let db: SqliteAdapter;
  let requirementId: string;

  beforeEach(async () => {
    db = await buildDb();
    await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
    await db.createRegulation({
      id: 'eu-eaa',
      jurisdictionId: 'EU',
      name: 'European Accessibility Act',
      shortName: 'EAA',
      reference: 'Directive 2019/882',
      url: 'https://example.com',
      enforcementDate: '2025-06-28',
      status: 'active',
      scope: 'all',
      sectors: [],
      description: 'EAA',
    });
    const req = await db.createRequirement({
      regulationId: 'eu-eaa',
      wcagVersion: '2.1',
      wcagLevel: 'AA',
      wcagCriterion: '*',
      obligation: 'mandatory',
    });
    requirementId = req.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it('updates a requirement obligation', async () => {
    const result = await updateRequirement(db, requirementId, { obligation: 'recommended' });
    expect(result.obligation).toBe('recommended');
  });

  it('rejects update of non-existent requirement', async () => {
    await expect(
      updateRequirement(db, 'nonexistent', { obligation: 'optional' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects update with invalid obligation', async () => {
    await expect(
      updateRequirement(db, requirementId, { obligation: 'required' as never }),
    ).rejects.toThrow(/invalid obligation/i);
  });

  it('rejects update with invalid wcagLevel', async () => {
    await expect(
      updateRequirement(db, requirementId, { wcagLevel: 'C' as never }),
    ).rejects.toThrow(/invalid wcag level/i);
  });

  it('rejects update with invalid wcagVersion', async () => {
    await expect(
      updateRequirement(db, requirementId, { wcagVersion: '3.0' as never }),
    ).rejects.toThrow(/invalid wcag version/i);
  });

  it('rejects update with non-existent regulationId', async () => {
    await expect(
      updateRequirement(db, requirementId, { regulationId: 'MISSING-REG' }),
    ).rejects.toThrow(/regulation.*not found/i);
  });
});

describe('deleteRequirement', () => {
  let db: SqliteAdapter;
  let requirementId: string;

  beforeEach(async () => {
    db = await buildDb();
    await db.createJurisdiction({ id: 'EU', name: 'European Union', type: 'supranational' });
    await db.createRegulation({
      id: 'eu-eaa',
      jurisdictionId: 'EU',
      name: 'European Accessibility Act',
      shortName: 'EAA',
      reference: 'Directive 2019/882',
      url: 'https://example.com',
      enforcementDate: '2025-06-28',
      status: 'active',
      scope: 'all',
      sectors: [],
      description: 'EAA',
    });
    const req = await db.createRequirement({
      regulationId: 'eu-eaa',
      wcagVersion: '2.1',
      wcagLevel: 'AA',
      wcagCriterion: '1.1.1',
      obligation: 'mandatory',
    });
    requirementId = req.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it('deletes a requirement', async () => {
    await deleteRequirement(db, requirementId);
    const found = await db.getRequirement(requirementId);
    expect(found).toBeNull();
  });

  it('rejects deletion of non-existent requirement', async () => {
    await expect(deleteRequirement(db, 'nonexistent')).rejects.toThrow(/not found/i);
  });
});
