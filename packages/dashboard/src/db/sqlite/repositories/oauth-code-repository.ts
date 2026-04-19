import type Database from 'better-sqlite3';
import type {
  AuthorizationCode,
  CreateCodeInput,
  OauthCodeRepository,
} from '../../interfaces/oauth-code-repository.js';

// ---------------------------------------------------------------------------
// Private row type — matches oauth_authorization_codes columns verbatim.
// ---------------------------------------------------------------------------

interface OauthAuthorizationCodeRow {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  resource: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  org_id: string;
  created_at: string;
  expires_at: string;
}

function rowToCode(row: OauthAuthorizationCodeRow): AuthorizationCode {
  return {
    code: row.code,
    clientId: row.client_id,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    scope: row.scope,
    resource: row.resource,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    orgId: row.org_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// ---------------------------------------------------------------------------
// SqliteOauthCodeRepository — Phase 31.1 (D-30, D-31, T-31.1-01-03)
// ---------------------------------------------------------------------------

export class SqliteOauthCodeRepository implements OauthCodeRepository {
  constructor(private readonly db: Database.Database) {}

  async createCode(input: CreateCodeInput): Promise<AuthorizationCode> {
    // Defense-in-depth: reject non-S256 BEFORE the DB CHECK constraint
    // would reject it. Plan 01 task 2 acceptance criterion pins this
    // literal error string.
    if (input.codeChallengeMethod !== 'S256') {
      throw new Error('code_challenge_method must be S256');
    }

    const createdAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO oauth_authorization_codes
           (code, client_id, user_id, redirect_uri, scope, resource,
            code_challenge, code_challenge_method, org_id, created_at, expires_at)
         VALUES
           (@code, @clientId, @userId, @redirectUri, @scope, @resource,
            @codeChallenge, @codeChallengeMethod, @orgId, @createdAt, @expiresAt)`,
      )
      .run({
        code: input.code,
        clientId: input.clientId,
        userId: input.userId,
        redirectUri: input.redirectUri,
        scope: input.scope,
        resource: input.resource,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: input.codeChallengeMethod,
        orgId: input.orgId,
        createdAt,
        expiresAt: input.expiresAt,
      });

    const row = this.db
      .prepare('SELECT * FROM oauth_authorization_codes WHERE code = ?')
      .get(input.code) as OauthAuthorizationCodeRow;
    return rowToCode(row);
  }

  async findAndConsume(code: string): Promise<AuthorizationCode | null> {
    // Atomic SELECT + DELETE inside a transaction. T-31.1-01-03:
    // a replayed code is always gone by the second call.
    const nowIso = new Date().toISOString();

    const txn = this.db.transaction((codeArg: string) => {
      const row = this.db
        .prepare('SELECT * FROM oauth_authorization_codes WHERE code = ?')
        .get(codeArg) as OauthAuthorizationCodeRow | undefined;
      // Always delete — even expired rows get swept by this call.
      this.db
        .prepare('DELETE FROM oauth_authorization_codes WHERE code = ?')
        .run(codeArg);
      if (row === undefined) return null;
      if (row.expires_at < nowIso) return null;
      return rowToCode(row);
    });

    return txn(code);
  }
}
