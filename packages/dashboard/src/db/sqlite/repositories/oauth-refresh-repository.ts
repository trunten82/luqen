import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  MintRefreshInput,
  OauthRefreshRepository,
  RefreshToken,
  RotateResult,
} from '../../interfaces/oauth-refresh-repository.js';

// ---------------------------------------------------------------------------
// Private row type — matches oauth_refresh_tokens columns verbatim.
// ---------------------------------------------------------------------------

interface OauthRefreshTokenRow {
  id: string;
  token_hash: string;
  chain_id: string;
  parent_id: string | null;
  client_id: string;
  user_id: string;
  org_id: string;
  scope: string;
  resource: string;
  rotated: number;
  created_at: string;
  absolute_expires_at: string;
}

function rowToToken(row: OauthRefreshTokenRow): RefreshToken {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    chainId: row.chain_id,
    parentId: row.parent_id,
    clientId: row.client_id,
    userId: row.user_id,
    orgId: row.org_id,
    scope: row.scope,
    resource: row.resource,
    rotated: row.rotated === 1,
    createdAt: row.created_at,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}

// ---------------------------------------------------------------------------
// SqliteOauthRefreshRepository — Phase 31.1 (D-29, T-31.1-01-04)
// ---------------------------------------------------------------------------

export class SqliteOauthRefreshRepository implements OauthRefreshRepository {
  constructor(private readonly db: Database.Database) {}

  async mint(input: MintRefreshInput): Promise<RefreshToken> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    // New chain ⟹ chain_id = this row's id.
    // Rotation  ⟹ inherit chain_id from the parent row.
    let chainId: string = id;
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      const parent = this.db
        .prepare('SELECT chain_id FROM oauth_refresh_tokens WHERE id = ?')
        .get(parentId) as { chain_id: string } | undefined;
      if (parent === undefined) {
        throw new Error(`Unknown parent refresh token: ${parentId}`);
      }
      chainId = parent.chain_id;
    }

    this.db
      .prepare(
        `INSERT INTO oauth_refresh_tokens
           (id, token_hash, chain_id, parent_id, client_id, user_id, org_id,
            scope, resource, rotated, created_at, absolute_expires_at)
         VALUES
           (@id, @tokenHash, @chainId, @parentId, @clientId, @userId, @orgId,
            @scope, @resource, 0, @createdAt, @absoluteExpiresAt)`,
      )
      .run({
        id,
        tokenHash: input.tokenHash,
        chainId,
        parentId,
        clientId: input.clientId,
        userId: input.userId,
        orgId: input.orgId,
        scope: input.scope,
        resource: input.resource,
        createdAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      });

    const row = this.db
      .prepare('SELECT * FROM oauth_refresh_tokens WHERE id = ?')
      .get(id) as OauthRefreshTokenRow;
    return rowToToken(row);
  }

  async rotate(
    presentedTokenHash: string,
    newTokenHash: string,
  ): Promise<RotateResult> {
    const nowIso = new Date().toISOString();

    const txn = this.db.transaction((): RotateResult => {
      const row = this.db
        .prepare('SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?')
        .get(presentedTokenHash) as OauthRefreshTokenRow | undefined;

      if (row === undefined) {
        return { kind: 'not_found' };
      }

      if (row.absolute_expires_at < nowIso) {
        // Expired: revoke the whole chain.
        this.db
          .prepare('DELETE FROM oauth_refresh_tokens WHERE chain_id = ?')
          .run(row.chain_id);
        return { kind: 'expired' };
      }

      if (row.rotated === 1) {
        // Reuse detection (T-31.1-01-04): revoke entire chain.
        const chainId = row.chain_id;
        this.db
          .prepare('DELETE FROM oauth_refresh_tokens WHERE chain_id = ?')
          .run(chainId);
        return { kind: 'reuse_detected', revokedChainId: chainId };
      }

      // Mark parent rotated.
      this.db
        .prepare('UPDATE oauth_refresh_tokens SET rotated = 1 WHERE id = ?')
        .run(row.id);

      // Insert child with same chain_id + absolute_expires_at.
      const childId = randomUUID();
      const createdAt = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO oauth_refresh_tokens
             (id, token_hash, chain_id, parent_id, client_id, user_id, org_id,
              scope, resource, rotated, created_at, absolute_expires_at)
           VALUES
             (@id, @tokenHash, @chainId, @parentId, @clientId, @userId, @orgId,
              @scope, @resource, 0, @createdAt, @absoluteExpiresAt)`,
        )
        .run({
          id: childId,
          tokenHash: newTokenHash,
          chainId: row.chain_id,
          parentId: row.id,
          clientId: row.client_id,
          userId: row.user_id,
          orgId: row.org_id,
          scope: row.scope,
          resource: row.resource,
          createdAt,
          absoluteExpiresAt: row.absolute_expires_at,
        });

      const childRow = this.db
        .prepare('SELECT * FROM oauth_refresh_tokens WHERE id = ?')
        .get(childId) as OauthRefreshTokenRow;

      // Parent row with rotated flag flipped (fresh read to pick up UPDATE).
      const parentRow = this.db
        .prepare('SELECT * FROM oauth_refresh_tokens WHERE id = ?')
        .get(row.id) as OauthRefreshTokenRow;

      return {
        kind: 'success',
        child: rowToToken(childRow),
        parent: rowToToken(parentRow),
      };
    });

    return txn();
  }

  async findByTokenHash(hash: string): Promise<RefreshToken | null> {
    const row = this.db
      .prepare('SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?')
      .get(hash) as OauthRefreshTokenRow | undefined;
    return row !== undefined ? rowToToken(row) : null;
  }

  async revokeChain(chainId: string): Promise<void> {
    this.db
      .prepare('DELETE FROM oauth_refresh_tokens WHERE chain_id = ?')
      .run(chainId);
  }

  async cleanupExpired(): Promise<number> {
    const nowIso = new Date().toISOString();
    const result = this.db
      .prepare('DELETE FROM oauth_refresh_tokens WHERE absolute_expires_at < ?')
      .run(nowIso);
    // `changes` is the count of deleted rows.
    return result.changes;
  }
}
