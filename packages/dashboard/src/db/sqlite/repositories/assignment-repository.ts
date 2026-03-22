import type Database from 'better-sqlite3';
import type { AssignmentRepository } from '../../interfaces/assignment-repository.js';
import type {
  IssueAssignment,
  IssueAssignmentStatus,
  AssignmentFilters,
  AssignmentStats,
  CreateAssignmentInput,
} from '../../types.js';

// ---------------------------------------------------------------------------
// Private row type and conversion
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
  created_at: string;
  updated_at: string;
  org_id: string;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orgId: row.org_id,
  };
}

// ---------------------------------------------------------------------------
// SqliteAssignmentRepository
// ---------------------------------------------------------------------------

export class SqliteAssignmentRepository implements AssignmentRepository {
  constructor(private readonly db: Database.Database) {}

  async listAssignments(filters: AssignmentFilters = {}): Promise<IssueAssignment[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.scanId !== undefined) {
      conditions.push('scan_id = @scanId');
      params['scanId'] = filters.scanId;
    }
    if (filters.status !== undefined) {
      conditions.push('status = @status');
      params['status'] = filters.status;
    }
    if (filters.assignedTo !== undefined) {
      conditions.push('assigned_to = @assignedTo');
      params['assignedTo'] = filters.assignedTo;
    }
    if (filters.orgId !== undefined) {
      conditions.push('org_id = @orgId');
      params['orgId'] = filters.orgId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM issue_assignments ${where} ORDER BY created_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params) as AssignmentRow[];
    return rows.map(assignmentRowToRecord);
  }

  async getAssignment(id: string): Promise<IssueAssignment | null> {
    const stmt = this.db.prepare('SELECT * FROM issue_assignments WHERE id = ?');
    const row = stmt.get(id) as AssignmentRow | undefined;
    return row !== undefined ? assignmentRowToRecord(row) : null;
  }

  async getAssignmentByFingerprint(scanId: string, fingerprint: string): Promise<IssueAssignment | null> {
    const stmt = this.db.prepare(
      'SELECT * FROM issue_assignments WHERE scan_id = @scanId AND issue_fingerprint = @fingerprint',
    );
    const row = stmt.get({ scanId, fingerprint }) as AssignmentRow | undefined;
    return row !== undefined ? assignmentRowToRecord(row) : null;
  }

  async createAssignment(data: CreateAssignmentInput): Promise<IssueAssignment> {
    const stmt = this.db.prepare(`
      INSERT INTO issue_assignments (id, scan_id, issue_fingerprint, wcag_criterion, wcag_title, severity, message, selector, page_url, status, assigned_to, notes, created_by, created_at, updated_at, org_id)
      VALUES (@id, @scanId, @issueFingerprint, @wcagCriterion, @wcagTitle, @severity, @message, @selector, @pageUrl, @status, @assignedTo, @notes, @createdBy, @createdAt, @updatedAt, @orgId)
    `);

    const assignedTo = data.assignedTo?.trim() || null;
    const status: IssueAssignmentStatus = data.status ?? (assignedTo !== null ? 'assigned' : 'open');

    stmt.run({
      id: data.id,
      scanId: data.scanId,
      issueFingerprint: data.issueFingerprint,
      wcagCriterion: data.wcagCriterion ?? null,
      wcagTitle: data.wcagTitle ?? null,
      severity: data.severity,
      message: data.message,
      selector: data.selector ?? null,
      pageUrl: data.pageUrl ?? null,
      status,
      assignedTo,
      notes: data.notes ?? null,
      createdBy: data.createdBy,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      orgId: data.orgId,
    });

    const created = await this.getAssignment(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve assignment after creation: ${data.id}`);
    }
    return created;
  }

  async updateAssignment(id: string, data: { status?: IssueAssignmentStatus; assignedTo?: string; notes?: string }): Promise<void> {
    const setClauses: string[] = ['updated_at = @updatedAt'];
    const params: Record<string, unknown> = { id, updatedAt: new Date().toISOString() };

    if (data.status !== undefined) {
      setClauses.push('status = @status');
      params['status'] = data.status;
    }
    if (data.assignedTo !== undefined) {
      setClauses.push('assigned_to = @assignedTo');
      params['assignedTo'] = data.assignedTo.trim() || null;
    }
    if (data.notes !== undefined) {
      setClauses.push('notes = @notes');
      params['notes'] = data.notes.trim() || null;
    }

    const stmt = this.db.prepare(
      `UPDATE issue_assignments SET ${setClauses.join(', ')} WHERE id = @id`,
    );
    stmt.run(params);
  }

  async deleteAssignment(id: string): Promise<void> {
    this.db.prepare('DELETE FROM issue_assignments WHERE id = ?').run(id);
  }

  async getAssignmentStats(scanId: string): Promise<AssignmentStats> {
    const stmt = this.db.prepare(
      'SELECT status, COUNT(*) as cnt FROM issue_assignments WHERE scan_id = ? GROUP BY status',
    );
    const rows = stmt.all(scanId) as Array<{ status: string; cnt: number }>;

    const result = {
      open: 0,
      assigned: 0,
      inProgress: 0,
      fixed: 0,
      verified: 0,
      total: 0,
    };

    let total = 0;
    for (const row of rows) {
      total += row.cnt;
      switch (row.status) {
        case 'open': result.open = row.cnt; break;
        case 'assigned': result.assigned = row.cnt; break;
        case 'in-progress': result.inProgress = row.cnt; break;
        case 'fixed': result.fixed = row.cnt; break;
        case 'verified': result.verified = row.cnt; break;
      }
    }

    return { ...result, total };
  }
}
