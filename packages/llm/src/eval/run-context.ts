/**
 * `createEphemeralRunDb` — an isolated, in-memory single-model database for
 * one harness run (Phase 84, HARNESS-01/T-84-02/T-84-03).
 *
 * Why this exists (T-84-03, spoofing): `getModelsForCapability`'s SQL
 * appends the system-level fallback chain UNCONDITIONALLY —
 * `WHERE ca.capability = ? AND (ca.org_id = ? OR ca.org_id = '')`
 * (sqlite-adapter.ts) — so assigning the target model at a scoped `orgId`
 * on the LIVE production database gives that assignment PRIORITY, never
 * EXCLUSIVITY: any system-level (`org_id = ''`) assignment is still a
 * candidate. A harness that seeded an org-scoped row on `llm.db` could
 * therefore silently fall through to a different model than the one under
 * test. Isolation in this module comes from the database having nothing
 * else in it at all, not from the org id.
 *
 * Why this exists (T-84-02, tampering): an eval run must never
 * read-modify-write the production `llm.db` or its `llm_usage` telemetry
 * ledger. This module constructs `new SqliteAdapter(':memory:')` —
 * better-sqlite3's native in-memory mode, no file, no cleanup step needed —
 * and exposes NO parameter, anywhere in this file, that could point the run
 * database at a file path. Any usage row `recordCompletion` writes during a
 * run lands in this in-memory instance and dies with the process.
 */
import { SqliteAdapter } from '../db/sqlite-adapter.js';
import type { CapabilityName, ProviderType } from '../types.js';

/**
 * The org id every ephemeral run seeds its single capability assignment at.
 * Passed straight through as `orgId` to the capability executor under test —
 * NOT a data-filtering parameter, just the row this module happens to use.
 */
export const EVAL_ORG_ID = '';

export interface EphemeralRunDb {
  /** The in-memory adapter. Caller owns its lifecycle — call `db.close()` when done. */
  readonly db: SqliteAdapter;
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly modelDisplayName: string;
}

export interface CreateEphemeralRunDbOptions {
  readonly providerType?: ProviderType;
  /** The id the fixture/real provider adapter will be asked for. */
  readonly modelIdOnProvider?: string;
}

/**
 * Construct a fresh `:memory:` database seeded with exactly one provider,
 * one model, and one `capability_assignments` row at `EVAL_ORG_ID` for the
 * given capability. Nothing else exists in this database — that absence is
 * the isolation mechanism.
 */
export async function createEphemeralRunDb(
  capability: CapabilityName,
  options?: CreateEphemeralRunDbOptions,
): Promise<EphemeralRunDb> {
  const db = new SqliteAdapter(':memory:');
  await db.initialize();

  const providerName = 'Eval Harness Fixture Provider';
  const modelDisplayName = 'Eval Harness Fixture Model';

  const provider = await db.createProvider({
    name: providerName,
    type: options?.providerType ?? 'ollama',
    // Deliberately unreachable — a real network call from an ephemeral run
    // is always a bug (the fixture adapter never dials out).
    baseUrl: 'http://eval-harness.invalid',
  });

  const model = await db.createModel({
    providerId: provider.id,
    modelId: options?.modelIdOnProvider ?? 'eval-fixture-model',
    displayName: modelDisplayName,
    capabilities: [capability],
  });

  await db.assignCapability({
    capability,
    modelId: model.id,
    priority: 0,
    orgId: EVAL_ORG_ID,
  });

  return {
    db,
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.id,
    modelDisplayName: model.displayName,
  };
}
