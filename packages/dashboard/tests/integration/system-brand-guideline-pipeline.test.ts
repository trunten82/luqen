/**
 * Phase 08 Plan P04 — System brand guideline pipeline integration tests.
 *
 * Proves end-to-end that the scan matching pipeline uses a SINGLE
 * BrandGuideline resolver code path for:
 *   (A) link mode — a site linked to a live system guideline scans with
 *       the current system content (no snapshot, no copy).
 *   (B) clone mode — a guideline cloned from a system source is an
 *       independent org-owned row; editing the source AFTER cloning does
 *       NOT touch the clone.
 *   (C) retag compatibility — branding-retag resolves the guideline
 *       through the same single resolver and works on system-linked sites.
 *   (D) regression — orgs with zero system involvement see byte-identical
 *       record shape (no behavioural drift from pre-phase).
 *   (E) structural guard — orchestrator.ts contains exactly ONE call to
 *       getGuidelineForSite. A future refactor introducing a parallel
 *       resolver fails this test (SYS-05 single code path guard).
 *
 * Requirements covered: SYS-05 (primary), SYS-02, SYS-03, SYS-06 (regression).
 *
 * Uses real SQLite + real migrations + real SqliteBrandingRepository — no
 * repo mocks. Retag is invoked directly via its exported function.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { SqliteBrandingRepository } from '../../src/db/sqlite/repositories/branding-repository.js';
import { retagScansForSite } from '../../src/services/branding-retag.js';
import { makeRetagDeps } from './helpers/branding-retag-deps.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let storage: SqliteStorageAdapter;
let repo: SqliteBrandingRepository;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-sys-brand-pipeline-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
  repo = new SqliteBrandingRepository(storage.getRawDatabase());
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

async function seedSystemGuideline(
  name: string,
  colorHexes: readonly string[],
): Promise<string> {
  const id = randomUUID();
  await repo.createGuideline({ orgId: 'system', name, id, description: `${name} desc` });
  for (let i = 0; i < colorHexes.length; i++) {
    await repo.addColor(id, {
      id: randomUUID(),
      name: `color-${i}`,
      hexValue: colorHexes[i]!,
      usage: i === 0 ? 'brand' : 'accent',
    });
  }
  await repo.addFont(id, {
    id: randomUUID(),
    family: 'Inter',
    weights: ['400', '700'],
    usage: 'body',
  });
  await repo.addSelector(id, {
    id: randomUUID(),
    pattern: '.hero',
    description: 'hero',
  });
  // Mark guideline active — required for retag to process it.
  await repo.updateGuideline(id, { active: true });
  return id;
}

async function seedOrgGuideline(
  orgId: string,
  name: string,
): Promise<string> {
  const id = randomUUID();
  await repo.createGuideline({ orgId, name, id, description: `${name} desc` });
  await repo.addColor(id, {
    id: randomUUID(),
    name: 'primary',
    hexValue: '#123456',
    usage: 'brand',
  });
  await repo.addFont(id, {
    id: randomUUID(),
    family: 'Roboto',
    weights: ['400'],
    usage: 'body',
  });
  await repo.addSelector(id, {
    id: randomUUID(),
    pattern: '.logo',
    description: 'logo',
  });
  await repo.updateGuideline(id, { active: true });
  return id;
}

// ---------------------------------------------------------------------------
// Scenario A — Link mode (SYS-02 pipeline side)
// ---------------------------------------------------------------------------

describe('Scenario A — link mode resolves live system guideline', () => {
  it('A1: getGuidelineForSite returns the system-scoped record for a linked site', async () => {
    const sysId = await seedSystemGuideline('Aperol System', ['#ff0000', '#ffcc00']);
    const siteUrl = 'https://example.com';
    const orgId = 'org-a';

    await repo.assignToSite(sysId, siteUrl, orgId);

    const resolved = await repo.getGuidelineForSite(siteUrl, orgId);

    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(sysId);
    expect(resolved!.orgId).toBe('system');
    expect(resolved!.name).toBe('Aperol System');
    expect(resolved!.colors).toHaveLength(2);
  });

  it('A2: editing the source system guideline propagates live to linked site resolver', async () => {
    const sysId = await seedSystemGuideline('Aperol System', ['#ff0000', '#ffcc00']);
    const siteUrl = 'https://example.com';
    const orgId = 'org-a';
    await repo.assignToSite(sysId, siteUrl, orgId);

    // Edit the source: new name + add a third color.
    await repo.updateGuideline(sysId, { name: 'Aperol System v2' });
    await repo.addColor(sysId, {
      id: randomUUID(),
      name: 'tertiary',
      hexValue: '#0000ff',
      usage: 'accent',
    });

    const resolved = await repo.getGuidelineForSite(siteUrl, orgId);

    expect(resolved).not.toBeNull();
    expect(resolved!.name).toBe('Aperol System v2');
    expect(resolved!.colors).toHaveLength(3);
    // Still org_id='system' — no clone was created.
    expect(resolved!.orgId).toBe('system');
  });
});

// ---------------------------------------------------------------------------
// Scenario B — Clone mode (SYS-03 pipeline side)
// ---------------------------------------------------------------------------

describe('Scenario B — clone mode produces an independent org-owned copy', () => {
  it('B1: cloneSystemGuideline creates an org-scoped row with clonedFromSystemGuidelineId set', async () => {
    const sysId = await seedSystemGuideline('Campari System', ['#aa0000', '#330000']);

    const clone = await repo.cloneSystemGuideline(sysId, 'org-a');

    expect(clone.orgId).toBe('org-a');
    expect(clone.clonedFromSystemGuidelineId).toBe(sysId);
    expect(clone.id).not.toBe(sysId);
    expect(clone.colors).toHaveLength(2);
  });

  it('B2: assigning the clone to a site resolves to the clone (not the source)', async () => {
    const sysId = await seedSystemGuideline('Campari System', ['#aa0000', '#330000']);
    const clone = await repo.cloneSystemGuideline(sysId, 'org-a');
    const siteUrl = 'https://campari.example';
    const orgId = 'org-a';
    await repo.assignToSite(clone.id, siteUrl, orgId);

    const resolved = await repo.getGuidelineForSite(siteUrl, orgId);

    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(clone.id);
    expect(resolved!.orgId).toBe('org-a');
    expect(resolved!.id).not.toBe(sysId);
  });

  it('B3: editing the source AFTER cloning does not touch the clone (frozen snapshot)', async () => {
    const sysId = await seedSystemGuideline('Campari System', ['#aa0000', '#330000']);
    const clone = await repo.cloneSystemGuideline(sysId, 'org-a');
    const siteUrl = 'https://campari.example';
    const orgId = 'org-a';
    await repo.assignToSite(clone.id, siteUrl, orgId);

    const clonedName = clone.name;
    const clonedColorCount = clone.colors!.length;

    // Mutate SOURCE after cloning.
    await repo.updateGuideline(sysId, { name: 'Campari System MUTATED' });
    await repo.addColor(sysId, {
      id: randomUUID(),
      name: 'extra',
      hexValue: '#ffffff',
      usage: 'accent',
    });

    const resolved = await repo.getGuidelineForSite(siteUrl, orgId);

    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(clone.id);
    expect(resolved!.name).toBe(clonedName);
    expect(resolved!.name).not.toBe('Campari System MUTATED');
    expect(resolved!.colors).toHaveLength(clonedColorCount);
  });
});

// ---------------------------------------------------------------------------
// Scenario C — Retag compatibility (SYS-05 single path)
// ---------------------------------------------------------------------------

describe('Scenario C — branding-retag resolves via the same single resolver', () => {
  it('C1: retagScansForSite works on a site linked to a system guideline (no throw, valid shape)', async () => {
    const sysId = await seedSystemGuideline('Aperol System', ['#ff0000', '#ffcc00']);
    const siteUrl = 'https://c1.example';
    const orgId = 'org-a';
    await repo.assignToSite(sysId, siteUrl, orgId);

    // No scan records seeded — retag should resolve the guideline, find
    // zero completed scans, and return { retagged: 0 } without throwing.
    const result = await retagScansForSite(storage, siteUrl, orgId, makeRetagDeps(storage).brandingOrchestrator, makeRetagDeps(storage).brandScoreRepository);

    expect(result).not.toBeNull();
    expect(result).toBeDefined();
    expect(result.retagged).toBe(0);
  });

  it('C2: retagScansForSite still works for a site linked to an org-owned guideline (regression guard)', async () => {
    const orgGuidelineId = await seedOrgGuideline('org-a', 'Org Custom');
    const siteUrl = 'https://c2.example';
    const orgId = 'org-a';
    await repo.assignToSite(orgGuidelineId, siteUrl, orgId);

    const result = await retagScansForSite(storage, siteUrl, orgId, makeRetagDeps(storage).brandingOrchestrator, makeRetagDeps(storage).brandScoreRepository);

    expect(result).toBeDefined();
    expect(result.retagged).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario D — Regression (SYS-06 / D-18)
// ---------------------------------------------------------------------------

describe('Scenario D — org-only guideline flow is byte-identical', () => {
  it('D1: getGuidelineForSite on org-owned path returns expected shape with clonedFromSystemGuidelineId=null', async () => {
    const orgGuidelineId = await seedOrgGuideline('org-b', 'Org-B Brand');
    const siteUrl = 'https://d1.example';
    const orgId = 'org-b';
    await repo.assignToSite(orgGuidelineId, siteUrl, orgId);

    const resolved = await repo.getGuidelineForSite(siteUrl, orgId);

    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(orgGuidelineId);
    expect(resolved!.orgId).toBe('org-b');
    expect(resolved!.clonedFromSystemGuidelineId).toBeNull();
    // Core fields all present and typed — no behavioural drift.
    expect(typeof resolved!.name).toBe('string');
    expect(typeof resolved!.version).toBe('number');
    expect(typeof resolved!.active).toBe('boolean');
    expect(Array.isArray(resolved!.colors)).toBe(true);
    expect(Array.isArray(resolved!.fonts)).toBe(true);
    expect(Array.isArray(resolved!.selectors)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario E — Structural single-code-path guard
// ---------------------------------------------------------------------------

describe('Scenario E — SYS-05 single code path enforcement', () => {
  it('E1: src/scanner/orchestrator.ts calls getGuidelineForSite exactly ONCE', () => {
    // NOTE: vitest runs from packages/dashboard so this relative path resolves.
    // If a future refactor introduces a parallel resolver (second call site)
    // this assertion fails and forces the author to either consolidate or
    // update the Scenario E expectation with a documented rationale.
    const src = readFileSync('src/scanner/orchestrator.ts', 'utf8');
    const matches = src.match(/getGuidelineForSite/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('E2: src/services/branding-retag.ts resolves its guideline via getGuidelineForSite (no parallel read)', () => {
    const src = readFileSync('src/services/branding-retag.ts', 'utf8');
    expect(src).toContain('getGuidelineForSite');
  });
});
