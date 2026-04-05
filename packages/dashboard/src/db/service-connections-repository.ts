/**
 * Service Connections Repository
 *
 * Persistent storage for the three outbound service connections the dashboard
 * talks to: compliance, branding, and llm. Secrets are encrypted at rest via
 * the existing `encryptSecret` / `decryptSecret` helpers in `plugins/crypto.ts`,
 * keyed on `config.sessionSecret` — same pattern as git-credentials.
 *
 * Precedence (see phase 06 CONTEXT D-12..D-14):
 *   - DB value wins over config when a row exists
 *   - Missing row → admin route synthesizes a row from config with
 *     `source: 'config'`
 *   - Repository methods only ever return DB-backed rows and therefore
 *     always set `source: 'db'`.
 */

export type ServiceId = 'compliance' | 'branding' | 'llm';

export interface ServiceConnection {
  readonly serviceId: ServiceId;
  readonly url: string;
  readonly clientId: string;
  /** Decrypted client secret. Empty string means "no secret configured". */
  readonly clientSecret: string;
  readonly hasSecret: boolean;
  /** ISO-8601 timestamp of the most recent write. */
  readonly updatedAt: string;
  readonly updatedBy: string | null;
  /**
   * Where this row was sourced from.
   * - 'db'     → returned by the repository (always).
   * - 'config' → synthesized by the admin route handler when no DB row
   *              exists for a service (per-service fallback, D-14).
   */
  readonly source: 'db' | 'config';
}

export interface ServiceConnectionUpsertInput {
  readonly serviceId: ServiceId;
  readonly url: string;
  readonly clientId: string;
  /**
   * Blank-to-keep semantics:
   *   - `null`         → keep the existing encrypted secret unchanged.
   *   - `''` (empty)   → clear the stored secret (sets empty-string
   *                      placeholder, never calls the cipher).
   *   - non-empty str  → encrypt and store as the new secret.
   */
  readonly clientSecret: string | null;
  readonly updatedBy: string | null;
}

export interface ServiceConnectionsRepository {
  list(): Promise<ServiceConnection[]>;
  get(serviceId: ServiceId): Promise<ServiceConnection | null>;
  upsert(input: ServiceConnectionUpsertInput): Promise<ServiceConnection>;
  clearSecret(serviceId: ServiceId, updatedBy: string | null): Promise<void>;
}
