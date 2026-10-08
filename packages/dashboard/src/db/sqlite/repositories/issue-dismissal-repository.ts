import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  IssueDismissal,
  IssueDismissalEvent,
  IssueDismissalRepository,
  IssueDismissalStatus,
  IssueDismissalAction,
  MarkIssueDismissalInput,
  MarkIssueDismissalResult,
  RevokeIssueDismissalInput,
  RevokeIssueDismissalResult,
} from '../../interfaces/issue-dismissal-repository.js';
import { insertAuditRow } from './audit-repository.js';

// ---------------------------------------------------------------------------
// Private row types and conversion
// ---------------------------------------------------------------------------

interface DismissalRow {
  id: string;
  org_id: string;
  site_url: string;
  site_key: string;
  code: string;
  selector: string;
  reason: string;
  status: string;
  created_by: string;
  created_by_id: string | null;
  created_at: string;
  revoked_by: string | null;
  revoked_by_id: string | null;
  revoked_at: string | null;
  revoke_comment: string | null;
}

interface EventRow {
  id: string;
  dismissal_id: string;
  org_id: string;
  action: string;
  actor: string;
  actor_id: string | null;
  at: string;
  text: string | null;
}

function rowToDismissal(row: DismissalRow): IssueDismissal {
  return {
    id: row.id,
    orgId: row.org_id,
    siteUrl: row.site_url,
    siteKey: row.site_key,
    code: row.code,
    selector: row.selector,
    reason: row.reason,
    status: row.status as IssueDismissalStatus,
    createdBy: row.created_by,
    createdById: row.created_by_id,
    createdAt: row.created_at,
    revokedBy: row.revoked_by,
    revokedById: row.revoked_by_id,
    revokedAt: row.revoked_at,
    revokeComment: row.revoke_comment,
  };
}

function rowToEvent(row: EventRow): IssueDismissalEvent {
  return {
    id: row.id,
    dismissalId: row.dismissal_id,
    orgId: row.org_id,
    action: row.action as IssueDismissalAction,
    actor: row.actor,
    actorId: row.actor_id,
    at: row.at,
    text: row.text,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

// ---------------------------------------------------------------------------
// SqliteIssueDismissalRepository
// ---------------------------------------------------------------------------

export class SqliteIssueDismissalRepository implements IssueDismissalRepository {
  constructor(private readonly db: Database.Database) {}

  async mark(input: MarkIssueDismissalInput): Promise<MarkIssueDismissalResult> {
    try {
      return this.db.transaction((): MarkIssueDismissalResult => {
        const existing = this.selectActive(input);
        if (existing) return { kind: 'conflict', existing };

        const id = randomUUID();
        const now = new Date().toISOString();

        this.db.prepare(`
          INSERT INTO issue_dismissals
            (id, org_id, site_url, site_key, code, selector, reason, status, created_by, created_by_id, created_at)
          VALUES
            (@id, @orgId, @siteUrl, @siteKey, @code, @selector, @reason, 'active', @actor, @actorId, @now)
        `).run({
          id,
          orgId: input.orgId,
          siteUrl: input.siteUrl,
          siteKey: input.siteKey,
          code: input.code,
          selector: input.selector,
          reason: input.reason,
          actor: input.actor,
          actorId: input.actorId ?? null,
          now,
        });

        this.insertEvent({
          dismissalId: id,
          orgId: input.orgId,
          action: 'mark',
          actor: input.actor,
          actorId: input.actorId ?? null,
          at: now,
          text: input.reason,
        });

        insertAuditRow(this.db, {
          actor: input.actor,
          actorId: input.actorId,
          action: 'issue_dismissal.mark',
          resourceType: 'issue_dismissal',
          resourceId: id,
          details: {
            siteUrl: input.siteUrl,
            code: input.code,
            selector: input.selector,
            reason: input.reason,
          },
          ipAddress: input.ipAddress,
          orgId: input.orgId,
        });

        return { kind: 'created', dismissal: this.requireById(id) };
      })();
    } catch (err) {
      if (isUniqueViolation(err)) {
        // A concurrent writer won the race for the same active key.
        const existing = this.selectActive(input);
        if (existing) return { kind: 'conflict', existing };
      }
      throw err;
    }
  }

  async revoke(input: RevokeIssueDismissalInput): Promise<RevokeIssueDismissalResult> {
    return this.db.transaction((): RevokeIssueDismissalResult => {
      const now = new Date().toISOString();
      const update = this.db.prepare(`
        UPDATE issue_dismissals
        SET status = 'revoked',
            revoked_by = @actor,
            revoked_by_id = @actorId,
            revoked_at = @now,
            revoke_comment = @comment
        WHERE id = @id AND org_id = @orgId AND status = 'active'
      `).run({
        id: input.id,
        orgId: input.orgId,
        actor: input.actor,
        actorId: input.actorId ?? null,
        comment: input.comment,
        now,
      });

      if (update.changes === 0) {
        const row = this.db.prepare(
          'SELECT * FROM issue_dismissals WHERE id = @id AND org_id = @orgId',
        ).get({ id: input.id, orgId: input.orgId }) as DismissalRow | undefined;
        if (!row) return { kind: 'not-found' };
        return { kind: 'already-revoked', dismissal: rowToDismissal(row) };
      }

      const dismissal = this.requireById(input.id);

      this.insertEvent({
        dismissalId: input.id,
        orgId: input.orgId,
        action: 'revoke',
        actor: input.actor,
        actorId: input.actorId ?? null,
        at: now,
        text: input.comment,
      });

      insertAuditRow(this.db, {
        actor: input.actor,
        actorId: input.actorId,
        action: 'issue_dismissal.revoke',
        resourceType: 'issue_dismissal',
        resourceId: input.id,
        details: {
          siteUrl: dismissal.siteUrl,
          code: dismissal.code,
          selector: dismissal.selector,
          comment: input.comment,
        },
        ipAddress: input.ipAddress,
        orgId: input.orgId,
      });

      return { kind: 'revoked', dismissal };
    })();
  }

  async getById(id: string): Promise<IssueDismissal | null> {
    const row = this.db.prepare('SELECT * FROM issue_dismissals WHERE id = @id').get({ id }) as
      | DismissalRow
      | undefined;
    return row ? rowToDismissal(row) : null;
  }

  async listActiveForSite(orgId: string, siteKey: string): Promise<readonly IssueDismissal[]> {
    const rows = this.db.prepare(`
      SELECT * FROM issue_dismissals
      WHERE org_id = @orgId AND site_key = @siteKey AND status = 'active'
      ORDER BY created_at ASC, rowid ASC
    `).all({ orgId, siteKey }) as DismissalRow[];
    return rows.map(rowToDismissal);
  }

  async listForSite(orgId: string, siteKey: string): Promise<readonly IssueDismissal[]> {
    const rows = this.db.prepare(`
      SELECT * FROM issue_dismissals
      WHERE org_id = @orgId AND site_key = @siteKey
      ORDER BY created_at DESC, rowid DESC
    `).all({ orgId, siteKey }) as DismissalRow[];
    return rows.map(rowToDismissal);
  }

  async listEvents(dismissalId: string): Promise<readonly IssueDismissalEvent[]> {
    const rows = this.db.prepare(`
      SELECT * FROM issue_dismissal_events
      WHERE dismissal_id = @dismissalId
      ORDER BY at ASC, rowid ASC
    `).all({ dismissalId }) as EventRow[];
    return rows.map(rowToEvent);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private selectActive(key: {
    orgId: string;
    siteKey: string;
    code: string;
    selector: string;
  }): IssueDismissal | null {
    const row = this.db.prepare(`
      SELECT * FROM issue_dismissals
      WHERE org_id = @orgId AND site_key = @siteKey AND code = @code
        AND selector = @selector AND status = 'active'
    `).get({
      orgId: key.orgId,
      siteKey: key.siteKey,
      code: key.code,
      selector: key.selector,
    }) as DismissalRow | undefined;
    return row ? rowToDismissal(row) : null;
  }

  private requireById(id: string): IssueDismissal {
    const row = this.db.prepare('SELECT * FROM issue_dismissals WHERE id = @id').get({ id }) as
      | DismissalRow
      | undefined;
    if (!row) throw new Error(`issue dismissal ${id} not found after write`);
    return rowToDismissal(row);
  }

  private insertEvent(event: Omit<IssueDismissalEvent, 'id'>): void {
    this.db.prepare(`
      INSERT INTO issue_dismissal_events (id, dismissal_id, org_id, action, actor, actor_id, at, text)
      VALUES (@id, @dismissalId, @orgId, @action, @actor, @actorId, @at, @text)
    `).run({ id: randomUUID(), ...event });
  }
}
