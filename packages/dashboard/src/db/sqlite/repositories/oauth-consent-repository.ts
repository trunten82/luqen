import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  CheckCoverageInput,
  Consent,
  ConsentCoverageResult,
  OauthConsentRepository,
  RecordConsentInput,
} from '../../interfaces/oauth-consent-repository.js';

// ---------------------------------------------------------------------------
// Private row type — matches oauth_user_consents columns verbatim.
// ---------------------------------------------------------------------------

interface OauthConsentRow {
  id: string;
  user_id: string;
  client_id: string;
  scopes: string;
  resources: string;
  consented_at: string;
  updated_at: string;
}

function rowToConsent(row: OauthConsentRow): Consent {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    scopes: JSON.parse(row.scopes) as readonly string[],
    resources: JSON.parse(row.resources) as readonly string[],
    consentedAt: row.consented_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// SqliteOauthConsentRepository — Phase 31.1 (D-20, T-31.1-01-05)
// ---------------------------------------------------------------------------

export class SqliteOauthConsentRepository implements OauthConsentRepository {
  constructor(private readonly db: Database.Database) {}

  async recordConsent(input: RecordConsentInput): Promise<Consent> {
    const now = new Date().toISOString();
    const id = randomUUID();

    // Upsert: preserve original consented_at, bump updated_at on re-consent.
    this.db
      .prepare(
        `INSERT INTO oauth_user_consents
           (id, user_id, client_id, scopes, resources, consented_at, updated_at)
         VALUES
           (@id, @userId, @clientId, @scopes, @resources, @consentedAt, @updatedAt)
         ON CONFLICT(user_id, client_id) DO UPDATE SET
           scopes = excluded.scopes,
           resources = excluded.resources,
           updated_at = excluded.updated_at`,
      )
      .run({
        id,
        userId: input.userId,
        clientId: input.clientId,
        scopes: JSON.stringify(input.scopes),
        resources: JSON.stringify(input.resources),
        consentedAt: now,
        updatedAt: now,
      });

    const row = this.db
      .prepare(
        'SELECT * FROM oauth_user_consents WHERE user_id = ? AND client_id = ?',
      )
      .get(input.userId, input.clientId) as OauthConsentRow;
    return rowToConsent(row);
  }

  async checkCoverage(input: CheckCoverageInput): Promise<ConsentCoverageResult> {
    const row = this.db
      .prepare(
        'SELECT * FROM oauth_user_consents WHERE user_id = ? AND client_id = ?',
      )
      .get(input.userId, input.clientId) as OauthConsentRow | undefined;

    if (row === undefined) {
      return {
        covered: false,
        missingScopes: [...input.requestedScopes],
        missingResources: [...input.requestedResources],
        existingConsent: null,
      };
    }

    const existing = rowToConsent(row);
    const consentedScopes = new Set(existing.scopes);
    const consentedResources = new Set(existing.resources);

    const missingScopes = input.requestedScopes.filter(
      (s) => !consentedScopes.has(s),
    );
    const missingResources = input.requestedResources.filter(
      (r) => !consentedResources.has(r),
    );

    return {
      covered: missingScopes.length === 0 && missingResources.length === 0,
      missingScopes,
      missingResources,
      existingConsent: existing,
    };
  }

  async listByUser(userId: string): Promise<readonly Consent[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM oauth_user_consents
         WHERE user_id = ?
         ORDER BY consented_at DESC`,
      )
      .all(userId) as OauthConsentRow[];
    return rows.map(rowToConsent);
  }

  async revoke(userId: string, clientId: string): Promise<void> {
    this.db
      .prepare(
        'DELETE FROM oauth_user_consents WHERE user_id = ? AND client_id = ?',
      )
      .run(userId, clientId);
  }
}
