/**
 * Per-org ACR wording overrides.
 *
 * The ACR's prose has a localized STANDARD default (from the app i18n catalog).
 * An org may override any string with custom or officially-translated wording.
 * One row per (org_id, string_key, locale). Sparse: only overridden strings are
 * stored; everything else falls back to the standard wording at resolve time.
 *
 * Optional on the StorageAdapter (same rationale as reportIdentities) — out-of-
 * repo storage backends may omit it; consumers guard with `storage.acrWording?.`.
 */

import type { AcrWordingOverride } from '../../services/acr-wording.js';

/** A persisted override row plus its audit metadata. */
export interface AcrWordingRecord extends AcrWordingOverride {
  readonly updatedAt: string;
  readonly updatedBy?: string | null;
}

/** Fields written when an admin overrides a string. */
export interface AcrWordingInput {
  readonly key: string;
  readonly locale: string;
  readonly text: string;
  readonly source: AcrWordingOverride['source'];
  readonly reviewed: boolean;
  readonly translatedBy?: string | null;
  readonly translatedAt?: string | null;
  readonly notes?: string | null;
}

export interface AcrWordingRepository {
  /** Overrides for an org, optionally filtered to one locale. */
  listForOrg(orgId: string, locale?: string): Promise<AcrWordingRecord[]>;

  /** Create or update one override. */
  upsert(orgId: string, data: AcrWordingInput, updatedBy?: string): Promise<void>;

  /** Apply many overrides at once (bulk translation upload). Returns count written. */
  bulkUpsert(orgId: string, rows: readonly AcrWordingInput[], updatedBy?: string): Promise<number>;

  /** Remove an override (reset that string to the standard wording). */
  remove(orgId: string, key: string, locale: string): Promise<void>;
}
