import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  CoordinatedPr,
  CoordinatedPrLeg,
  CoordinatedPrLegStatus,
  CoordinatedPrApprovalStatus,
  CoordinatedPrRepository,
  CoordinatedPrStatus,
  CreateCoordinatedPrInput,
  UpdateLegPatch,
} from '../../interfaces/coordinated-pr-repository.js';

interface PrRow {
  id: string;
  org_id: string;
  team_id: string | null;
  created_by: string;
  status: CoordinatedPrStatus;
  summary: string | null;
  created_at: string;
}

interface LegRow {
  id: string;
  coordinated_pr_id: string;
  site_id: string;
  host_pr_url: string | null;
  host_pr_state: string | null;
  last_error: string | null;
  leg_status: CoordinatedPrLegStatus;
  approval_status: CoordinatedPrApprovalStatus;
}

function prRowToRecord(row: PrRow): CoordinatedPr {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
    createdBy: row.created_by,
    status: row.status,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

function legRowToRecord(row: LegRow): CoordinatedPrLeg {
  return {
    id: row.id,
    coordinatedPrId: row.coordinated_pr_id,
    siteId: row.site_id,
    hostPrUrl: row.host_pr_url,
    hostPrState: row.host_pr_state,
    lastError: row.last_error,
    legStatus: row.leg_status,
    approvalStatus: row.approval_status,
  };
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export class SqliteCoordinatedPrRepository implements CoordinatedPrRepository {
  constructor(private readonly db: Database.Database) {}

  async createCoordinatedPr(input: CreateCoordinatedPrInput): Promise<{
    pr: CoordinatedPr;
    legs: readonly CoordinatedPrLeg[];
  }> {
    const prId = input.id ?? newId('cpr');
    const now = new Date().toISOString();

    // Read the org's approval gate to seed leg.approval_status.
    const orgRow = this.db
      .prepare(
        'SELECT coordinated_pr_requires_site_approval AS gate FROM organizations WHERE id = ?',
      )
      .get(input.orgId) as { gate: number } | undefined;
    if (orgRow === undefined) {
      throw new Error(`organization not found: ${input.orgId}`);
    }
    const defaultApproval: CoordinatedPrApprovalStatus =
      orgRow.gate === 1 ? 'pending' : 'approved';

    const insertPr = this.db.prepare(
      `INSERT INTO coordinated_prs
         (id, org_id, team_id, created_by, status, summary, created_at)
       VALUES (?, ?, ?, ?, 'opening', ?, ?)`,
    );
    const insertLeg = this.db.prepare(
      `INSERT INTO coordinated_pr_legs
         (id, coordinated_pr_id, site_id, leg_status, approval_status)
       VALUES (?, ?, ?, 'queued', ?)`,
    );

    const tx = this.db.transaction(() => {
      insertPr.run(
        prId,
        input.orgId,
        input.teamId ?? null,
        input.createdBy,
        input.summary ?? null,
        now,
      );
      for (const leg of input.legs) {
        insertLeg.run(newId('cpl'), prId, leg.siteId, defaultApproval);
      }
    });
    tx();

    const result = await this.getCoordinatedPr(prId);
    if (result === null) throw new Error('failed to read back created coordinated PR');
    return result;
  }

  async getCoordinatedPr(
    id: string,
  ): Promise<{ pr: CoordinatedPr; legs: readonly CoordinatedPrLeg[] } | null> {
    const prRow = this.db
      .prepare('SELECT * FROM coordinated_prs WHERE id = ?')
      .get(id) as PrRow | undefined;
    if (prRow === undefined) return null;
    const legRows = this.db
      .prepare('SELECT * FROM coordinated_pr_legs WHERE coordinated_pr_id = ? ORDER BY id')
      .all(id) as LegRow[];
    return {
      pr: prRowToRecord(prRow),
      legs: legRows.map(legRowToRecord),
    };
  }

  async listForOrg(orgId: string, limit = 50): Promise<readonly CoordinatedPr[]> {
    const rows = this.db
      .prepare(
        'SELECT * FROM coordinated_prs WHERE org_id = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(orgId, limit) as PrRow[];
    return rows.map(prRowToRecord);
  }

  async updateLeg(legId: string, patch: UpdateLegPatch): Promise<CoordinatedPrLeg | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.hostPrUrl !== undefined) {
      sets.push('host_pr_url = ?');
      values.push(patch.hostPrUrl);
    }
    if (patch.hostPrState !== undefined) {
      sets.push('host_pr_state = ?');
      values.push(patch.hostPrState);
    }
    if (patch.lastError !== undefined) {
      sets.push('last_error = ?');
      values.push(patch.lastError);
    }
    if (patch.legStatus !== undefined) {
      sets.push('leg_status = ?');
      values.push(patch.legStatus);
    }
    if (patch.approvalStatus !== undefined) {
      sets.push('approval_status = ?');
      values.push(patch.approvalStatus);
    }
    if (sets.length === 0) {
      const existing = this.db
        .prepare('SELECT * FROM coordinated_pr_legs WHERE id = ?')
        .get(legId) as LegRow | undefined;
      return existing ? legRowToRecord(existing) : null;
    }
    values.push(legId);
    const result = this.db
      .prepare(`UPDATE coordinated_pr_legs SET ${sets.join(', ')} WHERE id = ?`)
      .run(...(values as never[]));
    if (result.changes === 0) return null;
    const row = this.db
      .prepare('SELECT * FROM coordinated_pr_legs WHERE id = ?')
      .get(legId) as LegRow | undefined;
    return row ? legRowToRecord(row) : null;
  }

  async markRolledBack(id: string, _reason?: string): Promise<boolean> {
    const tx = this.db.transaction(() => {
      const pr = this.db
        .prepare('SELECT id FROM coordinated_prs WHERE id = ?')
        .get(id) as { id: string } | undefined;
      if (pr === undefined) return false;
      this.db
        .prepare("UPDATE coordinated_prs SET status = 'rolled_back' WHERE id = ?")
        .run(id);
      this.db
        .prepare(
          `UPDATE coordinated_pr_legs
             SET leg_status = 'rolled_back'
           WHERE coordinated_pr_id = ?
             AND leg_status NOT IN ('rolled_back','failed')`,
        )
        .run(id);
      return true;
    });
    return tx() as boolean;
  }

  async recomputeStatus(id: string): Promise<CoordinatedPrStatus | null> {
    const existing = await this.getCoordinatedPr(id);
    if (existing === null) return null;
    const { pr, legs } = existing;
    if (pr.status === 'rolled_back') return pr.status;
    if (legs.length === 0) return pr.status;

    const failureMode = this.getOrgFailureMode(pr.orgId);

    const hasFailure = legs.some((l) => l.legStatus === 'failed');
    if (hasFailure && failureMode === 'all_or_nothing') {
      await this.markRolledBack(id);
      return 'rolled_back';
    }

    const isLegDone = (l: CoordinatedPrLeg): boolean =>
      l.legStatus === 'opened' ||
      l.legStatus === 'failed' ||
      l.legStatus === 'rolled_back';

    const allDone = legs.every(isLegDone);
    if (!allDone) {
      // Still in flight — keep 'opening'
      if (pr.status !== 'opening') {
        this.db
          .prepare("UPDATE coordinated_prs SET status = 'opening' WHERE id = ?")
          .run(id);
      }
      return 'opening';
    }

    const allOpened = legs.every((l) => l.legStatus === 'opened');
    const next: CoordinatedPrStatus = allOpened ? 'complete' : 'partial';
    if (pr.status !== next) {
      this.db.prepare('UPDATE coordinated_prs SET status = ? WHERE id = ?').run(next, id);
    }
    return next;
  }

  private getOrgFailureMode(orgId: string): 'best_effort' | 'all_or_nothing' {
    const row = this.db
      .prepare(
        'SELECT coordinated_pr_failure_mode AS mode FROM organizations WHERE id = ?',
      )
      .get(orgId) as { mode: string } | undefined;
    if (row === undefined) return 'best_effort';
    return row.mode === 'all_or_nothing' ? 'all_or_nothing' : 'best_effort';
  }
}
