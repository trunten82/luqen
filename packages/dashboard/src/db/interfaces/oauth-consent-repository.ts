/**
 * OauthConsentRepository — Phase 31.1 (MCPAUTH-02 / D-20).
 *
 * Persists per-client remembered consents. Core invariant:
 *
 *   - UNIQUE(user_id, client_id) — at most one consent row per
 *     (user, client) pair. Re-consenting (wider scopes/resources) upserts
 *     the row; `consented_at` is preserved; `updated_at` is bumped.
 *
 * Spoofing protection (T-31.1-01-05): `checkCoverage` takes a clientId;
 * consent granted for client X is never visible to client Y.
 *
 * Widening (D-20): If `requestedScopes ⊄ consentedScopes` OR
 * `requestedResources ⊄ consentedResources`, `covered=false` and the
 * /oauth/authorize handler re-shows the consent screen highlighting the
 * new permissions.
 */

export interface Consent {
  readonly id: string;
  readonly userId: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly resources: readonly string[];
  readonly consentedAt: string;
  readonly updatedAt: string;
}

export interface RecordConsentInput {
  readonly userId: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly resources: readonly string[];
}

export interface CheckCoverageInput {
  readonly userId: string;
  readonly clientId: string;
  readonly requestedScopes: readonly string[];
  readonly requestedResources: readonly string[];
}

export interface ConsentCoverageResult {
  readonly covered: boolean;
  readonly missingScopes: readonly string[];
  readonly missingResources: readonly string[];
  readonly existingConsent: Consent | null;
}

export interface OauthConsentRepository {
  recordConsent(input: RecordConsentInput): Promise<Consent>;
  checkCoverage(input: CheckCoverageInput): Promise<ConsentCoverageResult>;
  listByUser(userId: string): Promise<readonly Consent[]>;
  revoke(userId: string, clientId: string): Promise<void>;
}
