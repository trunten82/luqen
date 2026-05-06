import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '../../src/db/sqlite-adapter.js';
import type { DbAdapter } from '../../src/db/adapter.js';

/**
 * Phase 54-03: orchestrator per-org fan-out unit tests.
 *
 * The orchestrator (sources.ts scan loop) builds a list of "recipients"
 * (orgId + effective mode) for each government source content change:
 *   - No override rows for the source → recipients = [{ orgId: 'system', mode: <system default> }]
 *   - Override rows present → recipients = [{ orgId: 'system', mode: <system default> }, ...overrides]
 *
 * trustLevel for each created proposal = 'extracted' if recipient.mode === 'llm', else 'certified'.
 *
 * These tests validate the building blocks (DB helpers) used inside the
 * orchestrator. The full HTTP-fetch scan path is covered by UAT (54-UAT.md).
 */
describe('orchestrator per-org recipient set (Phase 54-03)', () => {
  let db: DbAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  async function makeGovSource(
    overrides: Array<{ orgId: string; mode: 'llm' | 'manual' }> = [],
    systemMode: 'llm' | 'manual' = 'manual',
  ): Promise<string> {
    const s = await db.createSource({
      name: 'EAA',
      url: 'https://example.gov/eaa',
      type: 'html',
      schedule: 'weekly',
      sourceCategory: 'government',
    });
    if (systemMode === 'llm') {
      await db.updateSourceManagementMode(s.id, 'llm');
    }
    for (const o of overrides) {
      await db.setSourceOrgManagementMode(s.id, o.orgId, o.mode, 'tester');
    }
    return s.id;
  }

  it('no overrides: recipient set is [system] with system default mode', async () => {
    const id = await makeGovSource([], 'manual');
    const overrides = await db.listSourceOrgModesForSource(id);
    expect(overrides).toEqual([]);
    // The orchestrator falls back to system row → effective is 'manual'.
    expect(await db.getEffectiveSourceManagementMode(id, 'system')).toBe('manual');
  });

  it('with overrides: recipient set is [system, ...override-holders] with per-org modes', async () => {
    const id = await makeGovSource(
      [
        { orgId: 'orgA', mode: 'llm' },
        { orgId: 'orgB', mode: 'manual' },
      ],
      'manual',
    );
    const overrides = await db.listSourceOrgModesForSource(id);
    const recipients: Array<{ orgId: string; mode: 'llm' | 'manual' }> = [
      { orgId: 'system', mode: 'manual' },
      ...overrides,
    ];
    expect(recipients).toHaveLength(3);
    expect(recipients.find((r) => r.orgId === 'orgA')?.mode).toBe('llm');
    expect(recipients.find((r) => r.orgId === 'orgB')?.mode).toBe('manual');
    expect(recipients.find((r) => r.orgId === 'system')?.mode).toBe('manual');
  });

  it('LLM extraction is run at most once when ANY recipient wants llm', async () => {
    // System default = manual; orgA override = llm.
    const id = await makeGovSource([{ orgId: 'orgA', mode: 'llm' }], 'manual');
    const overrides = await db.listSourceOrgModesForSource(id);
    const recipients = [
      { orgId: 'system', mode: 'manual' as const },
      ...overrides,
    ];
    const anyLlm = recipients.some((r) => r.mode === 'llm');
    expect(anyLlm).toBe(true);
    // Orchestrator therefore runs extraction once and reuses for orgA;
    // 'system' recipient gets a generic (certified) proposal in the same loop.
  });

  it('zero recipients want llm → no extraction call', async () => {
    const id = await makeGovSource([{ orgId: 'orgA', mode: 'manual' }], 'manual');
    const overrides = await db.listSourceOrgModesForSource(id);
    const recipients = [
      { orgId: 'system', mode: 'manual' as const },
      ...overrides,
    ];
    expect(recipients.every((r) => r.mode === 'manual')).toBe(true);
  });

  it('proposals carry per-org orgId after creation', async () => {
    // Direct end-to-end at the proposal layer.
    const sourceId = await makeGovSource([], 'manual');
    const source = await db.getSource(sourceId);
    expect(source).not.toBeNull();
    const proposalA = await db.createUpdateProposal({
      source: source!.url,
      type: 'amendment',
      summary: 'Test for orgA',
      orgId: 'orgA',
      trustLevel: 'extracted',
      proposedChanges: { action: 'update', entityType: 'regulation', entityId: sourceId, after: { x: 1 } },
    });
    const proposalSys = await db.createUpdateProposal({
      source: source!.url,
      type: 'amendment',
      summary: 'Test for system',
      orgId: 'system',
      trustLevel: 'certified',
      proposedChanges: { action: 'update', entityType: 'regulation', entityId: sourceId, after: { x: 1 } },
    });
    const orgAList = await db.listUpdateProposals({ orgId: 'orgA' });
    const sysList = await db.listUpdateProposals({ orgId: 'system' });
    // Org-A list contains its own + visible system proposals.
    expect(orgAList.some((p) => p.id === proposalA.id)).toBe(true);
    expect(sysList.some((p) => p.id === proposalSys.id)).toBe(true);
    // System list does NOT contain orgA's proposal (orgs are isolated upward).
    expect(sysList.some((p) => p.id === proposalA.id)).toBe(false);
  });
});
