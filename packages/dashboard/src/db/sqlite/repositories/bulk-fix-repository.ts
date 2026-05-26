import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  BulkFix,
  BulkFixRepository,
  BulkFixStatus,
  CreateBulkFixInput,
} from '../../interfaces/bulk-fix-repository.js';

interface BulkFixRow {
  id: string;
  org_id: string;
  team_id: string | null;
  created_by: string;
  criterion: string;
  summary: string | null;
  status: BulkFixStatus;
  coordinated_pr_id: string | null;
  created_at: string;
}

function rowToRecord(row: BulkFixRow): BulkFix {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
    createdBy: row.created_by,
    criterion: row.criterion,
    summary: row.summary,
    status: row.status,
    coordinatedPrId: row.coordinated_pr_id,
    createdAt: row.created_at,
  };
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export class SqliteBulkFixRepository implements BulkFixRepository {
  constructor(private readonly db: Database.Database) {}

  async create(input: CreateBulkFixInput): Promise<BulkFix> {
    const id = input.id ?? newId('bfx');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO bulk_fixes
           (id, org_id, team_id, created_by, criterion, summary, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
      )
      .run(
        id,
        input.orgId,
        input.teamId ?? null,
        input.createdBy,
        input.criterion,
        input.summary ?? null,
        now,
      );
    const created = await this.getById(id);
    if (created === null) throw new Error('failed to read back created bulk_fix');
    return created;
  }

  async getById(id: string): Promise<BulkFix | null> {
    const row = this.db
      .prepare('SELECT * FROM bulk_fixes WHERE id = ?')
      .get(id) as BulkFixRow | undefined;
    return row !== undefined ? rowToRecord(row) : null;
  }

  async listForOrg(
    orgId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: readonly BulkFix[]; nextCursor: string | null }> {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
    const fetchN = limit + 1;
    const rows = (opts.cursor !== undefined
      ? (this.db
          .prepare(
            'SELECT * FROM bulk_fixes WHERE org_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?',
          )
          .all(orgId, opts.cursor, fetchN) as BulkFixRow[])
      : (this.db
          .prepare(
            'SELECT * FROM bulk_fixes WHERE org_id = ? ORDER BY created_at DESC LIMIT ?',
          )
          .all(orgId, fetchN) as BulkFixRow[]));

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].created_at : null;
    return { items: page.map(rowToRecord), nextCursor };
  }

  async markDispatched(id: string, coordinatedPrId: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE bulk_fixes
            SET status = 'dispatched', coordinated_pr_id = ?
          WHERE id = ?`,
      )
      .run(coordinatedPrId, id);
  }
}
