import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type {
  CreateShareLinkInput,
  ShareLink,
  ShareLinkRepository,
} from '../../interfaces/share-link-repository.js';

// ---------------------------------------------------------------------------
// Private row type — matches SQL columns verbatim (snake_case).
// ---------------------------------------------------------------------------

interface ShareLinkRow {
  id: string;
  conversation_id: string;
  org_id: string;
  anchor_message_id: string | null;
  created_by_user_id: string;
  created_at: string;
  revoked_at: string | null;
}

// ---------------------------------------------------------------------------
// Token generator
// ---------------------------------------------------------------------------

/**
 * Generate a 22-character URL-safe token from 16 random bytes (128 bits).
 * Buffer.toString('base64url') (Node 16+) emits no padding for 16-byte
 * inputs, yielding exactly 22 chars from the [A-Za-z0-9_-] alphabet.
 */
function generateToken(): string {
  return randomBytes(16).toString('base64url');
}

// ---------------------------------------------------------------------------
// SqliteShareLinkRepository
// ---------------------------------------------------------------------------

export class SqliteShareLinkRepository implements ShareLinkRepository {
  constructor(private readonly db: Database.Database) {}

  async createShareLink(input: CreateShareLinkInput): Promise<ShareLink> {
    const id = generateToken();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO agent_share_links
           (id, conversation_id, org_id, anchor_message_id,
            created_by_user_id, created_at, revoked_at)
         VALUES
           (@id, @conversationId, @orgId, @anchorMessageId,
            @createdByUserId, @createdAt, NULL)`,
      )
      .run({
        id,
        conversationId: input.conversationId,
        orgId: input.orgId,
        anchorMessageId: input.anchorMessageId,
        createdByUserId: input.createdByUserId,
        createdAt: now,
      });

    const row = this.db
      .prepare('SELECT * FROM agent_share_links WHERE id = ?')
      .get(id) as ShareLinkRow;
    return this.rowToShareLink(row);
  }

  async getShareLink(id: string): Promise<ShareLink | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM agent_share_links
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .get(id) as ShareLinkRow | undefined;
    return row !== undefined ? this.rowToShareLink(row) : null;
  }

  async listForConversation(
    conversationId: string,
    orgId: string,
  ): Promise<ShareLink[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_share_links
         WHERE conversation_id = @conversationId
           AND org_id = @orgId
           AND revoked_at IS NULL
         ORDER BY created_at DESC`,
      )
      .all({ conversationId, orgId }) as ShareLinkRow[];
    return rows.map((r) => this.rowToShareLink(r));
  }

  async revokeShareLink(id: string, orgId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE agent_share_links
         SET revoked_at = @now
         WHERE id = @id
           AND org_id = @orgId
           AND revoked_at IS NULL`,
      )
      .run({ id, orgId, now });
    return result.changes > 0;
  }

  // ── Private mapper ──────────────────────────────────────────────────

  private rowToShareLink(row: ShareLinkRow): ShareLink {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      orgId: row.org_id,
      anchorMessageId: row.anchor_message_id,
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    };
  }
}
