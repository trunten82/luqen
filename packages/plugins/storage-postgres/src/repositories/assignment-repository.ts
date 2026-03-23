import type pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IssueAssignmentStatus = 'open' | 'assigned' | 'in-progress' | 'fixed' | 'verified';

interface IssueAssignment {
  readonly id: string;
  readonly scanId: string;
  readonly issueFingerprint: string;
  readonly wcagCriterion: string | null;
  readonly wcagTitle: string | null;
  readonly severity: string;
  readonly message: string;
  readonly selector: string | null;
  readonly pageUrl: string | null;
  readonly status: IssueAssignmentStatus;
  readonly assignedTo: string | null;
  readonly notes: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly orgId: string;
}

interface AssignmentFilters {
  readonly scanId?: string;
  readonly status?: IssueAssignmentStatus;
  readonly assignedTo?: string;
  readonly orgId?: string;
}

interface AssignmentStats {
  readonly open: number;
  readonly assigned: number;
  readonly inProgress: number;
  readonly fixed: number;
  readonly verified: number;
  readonly total: number;
}

interface CreateAssignmentInput {
  readonly id: string;
  readonly scanId: string;
  readonly issueFingerprint: string;
  readonly wcagCriterion?: string | null;
  readonly wcagTitle?: string | null;
  readonly severity: string;
  readonly message: string;
  readonly selector?: string | null;
  readonly pageUrl?: string | null;
  readonly status?: IssueAssignmentStatus;
  readonly assignedTo?: string | null;
  readonly notes?: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly orgId: string;
}

interface AssignmentRepository {
  listAssignments(filters?: AssignmentFilters): Promise<IssueAssignment[]>;
  getAssignment(id: string): Promise<IssueAssignment | null>;
  getAssignmentByFingerprint(scanId: string, fingerprint: string): Promise<IssueAssignment | null>;
  createAssignment(data: CreateAssignmentInput): Promise<IssueAssignment>;
  updateAssignment(id: string, data: { status?: IssueAssignmentStatus; assignedTo?: string; notes?: string }): Promise<void>;
  deleteAssignment(id: string): Promise<void>;
  getAssignmentStats(scanId: string): Promise<AssignmentStats>;
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

interface AssignmentRow {
  id: string;
  scan_id: string;
  issue_fingerprint: string;
  wcag_criterion: string | null;
  wcag_title: string | null;
  severity: string;
  message: string;
  selector: string | null;
  page_url: string | null;
  status: string;
  assigned_to: string | null;
  notes: string | null;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
  org_id: string;
}

function toIso(val: string | Date): string {
  if (val instanceof Date) return val.toISOString();
  return val;
}

function assignmentRowToRecord(row: AssignmentRow): IssueAssignment {
  return {
    id: row.id,
    scanId: row.scan_id,
    issueFingerprint: row.issue_fingerprint,
    wcagCriterion: row.wcag_criterion,
    wcagTitle: row.wcag_title,
    severity: row.severity,
    message: row.message,
    selector: row.selector,
    pageUrl: row.page_url,
    status: row.status as IssueAssignmentStatus,
    assignedTo: row.assigned_to,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    orgId: row.org_id,
  };
}

// ---------------------------------------------------------------------------
// PgAssignmentRepository
// ---------------------------------------------------------------------------

export class PgAssignmentRepository implements AssignmentRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listAssignments(filters: AssignmentFilters = {}): Promise<IssueAssignment[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.scanId !== undefined) {
      conditions.push(`scan_id = $${idx++}`);
      params.push(filters.scanId);
    }
    if (filters.status !== undefined) {
      conditions.push(`status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters.assignedTo !== undefined) {
      conditions.push(`assigned_to = $${idx++}`);
      params.push(filters.assignedTo);
    }
    if (filters.orgId !== undefined) {
      conditions.push(`org_id = $${idx++}`);
      params.push(filters.orgId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM issue_assignments ${where} ORDER BY created_at DESC`;
    const result = await this.pool.query<AssignmentRow>(sql, params);
    return result.rows.map(assignmentRowToRecord);
  }

  async getAssignment(id: string): Promise<IssueAssignment | null> {
    const result = await this.pool.query<AssignmentRow>(
      'SELECT * FROM issue_assignments WHERE id = $1',
      [id],
    );
    return result.rows.length > 0 ? assignmentRowToRecord(result.rows[0]) : null;
  }

  async getAssignmentByFingerprint(scanId: string, fingerprint: string): Promise<IssueAssignment | null> {
    const result = await this.pool.query<AssignmentRow>(
      'SELECT * FROM issue_assignments WHERE scan_id = $1 AND issue_fingerprint = $2',
      [scanId, fingerprint],
    );
    return result.rows.length > 0 ? assignmentRowToRecord(result.rows[0]) : null;
  }

  async createAssignment(data: CreateAssignmentInput): Promise<IssueAssignment> {
    const assignedTo = data.assignedTo?.trim() || null;
    const status: IssueAssignmentStatus = data.status ?? (assignedTo !== null ? 'assigned' : 'open');

    await this.pool.query(
      `INSERT INTO issue_assignments (id, scan_id, issue_fingerprint, wcag_criterion, wcag_title, severity, message, selector, page_url, status, assigned_to, notes, created_by, created_at, updated_at, org_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        data.id,
        data.scanId,
        data.issueFingerprint,
        data.wcagCriterion ?? null,
        data.wcagTitle ?? null,
        data.severity,
        data.message,
        data.selector ?? null,
        data.pageUrl ?? null,
        status,
        assignedTo,
        data.notes ?? null,
        data.createdBy,
        data.createdAt,
        data.updatedAt,
        data.orgId,
      ],
    );

    const created = await this.getAssignment(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve assignment after creation: ${data.id}`);
    }
    return created;
  }

  async updateAssignment(id: string, data: { status?: IssueAssignmentStatus; assignedTo?: string; notes?: string }): Promise<void> {
    const setClauses: string[] = [`updated_at = $1`];
    const params: unknown[] = [new Date().toISOString()];
    let idx = 2;

    if (data.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      params.push(data.status);
    }
    if (data.assignedTo !== undefined) {
      setClauses.push(`assigned_to = $${idx++}`);
      params.push(data.assignedTo.trim() || null);
    }
    if (data.notes !== undefined) {
      setClauses.push(`notes = $${idx++}`);
      params.push(data.notes.trim() || null);
    }

    params.push(id);
    await this.pool.query(
      `UPDATE issue_assignments SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      params,
    );
  }

  async deleteAssignment(id: string): Promise<void> {
    await this.pool.query('DELETE FROM issue_assignments WHERE id = $1', [id]);
  }

  async getAssignmentStats(scanId: string): Promise<AssignmentStats> {
    const result = await this.pool.query<{ status: string; cnt: string }>(
      'SELECT status, COUNT(*) as cnt FROM issue_assignments WHERE scan_id = $1 GROUP BY status',
      [scanId],
    );

    const stats = {
      open: 0,
      assigned: 0,
      inProgress: 0,
      fixed: 0,
      verified: 0,
      total: 0,
    };

    let total = 0;
    for (const row of result.rows) {
      const cnt = parseInt(row.cnt, 10);
      total += cnt;
      switch (row.status) {
        case 'open': stats.open = cnt; break;
        case 'assigned': stats.assigned = cnt; break;
        case 'in-progress': stats.inProgress = cnt; break;
        case 'fixed': stats.fixed = cnt; break;
        case 'verified': stats.verified = cnt; break;
      }
    }

    return { ...stats, total };
  }
}
