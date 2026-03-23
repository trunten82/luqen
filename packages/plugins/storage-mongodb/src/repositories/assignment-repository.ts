import type { Collection, Db, Filter } from 'mongodb';

// ---------------------------------------------------------------------------
// Domain types
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

// ---------------------------------------------------------------------------
// MongoDB document type
// ---------------------------------------------------------------------------

interface AssignmentDoc {
  _id: string;
  scanId: string;
  issueFingerprint: string;
  wcagCriterion: string | null;
  wcagTitle: string | null;
  severity: string;
  message: string;
  selector: string | null;
  pageUrl: string | null;
  status: string;
  assignedTo: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  orgId: string;
}

function docToRecord(doc: AssignmentDoc): IssueAssignment {
  return {
    id: doc._id,
    scanId: doc.scanId,
    issueFingerprint: doc.issueFingerprint,
    wcagCriterion: doc.wcagCriterion,
    wcagTitle: doc.wcagTitle,
    severity: doc.severity,
    message: doc.message,
    selector: doc.selector,
    pageUrl: doc.pageUrl,
    status: doc.status as IssueAssignmentStatus,
    assignedTo: doc.assignedTo,
    notes: doc.notes,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    orgId: doc.orgId,
  };
}

// ---------------------------------------------------------------------------
// MongoAssignmentRepository
// ---------------------------------------------------------------------------

export class MongoAssignmentRepository {
  private readonly collection: Collection<AssignmentDoc>;

  constructor(db: Db) {
    this.collection = db.collection<AssignmentDoc>('issue_assignments');
  }

  async listAssignments(filters: AssignmentFilters = {}): Promise<IssueAssignment[]> {
    const query: Filter<AssignmentDoc> = {};

    if (filters.scanId !== undefined) query['scanId'] = filters.scanId;
    if (filters.status !== undefined) query['status'] = filters.status;
    if (filters.assignedTo !== undefined) query['assignedTo'] = filters.assignedTo;
    if (filters.orgId !== undefined) query['orgId'] = filters.orgId;

    const docs = await this.collection.find(query).sort({ createdAt: -1 }).toArray();
    return docs.map(docToRecord);
  }

  async getAssignment(id: string): Promise<IssueAssignment | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc !== null ? docToRecord(doc) : null;
  }

  async getAssignmentByFingerprint(scanId: string, fingerprint: string): Promise<IssueAssignment | null> {
    const doc = await this.collection.findOne({ scanId, issueFingerprint: fingerprint });
    return doc !== null ? docToRecord(doc) : null;
  }

  async createAssignment(data: CreateAssignmentInput): Promise<IssueAssignment> {
    const assignedTo = data.assignedTo?.trim() || null;
    const status: IssueAssignmentStatus = data.status ?? (assignedTo !== null ? 'assigned' : 'open');

    const doc: AssignmentDoc = {
      _id: data.id,
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
    };

    await this.collection.insertOne(doc);

    const created = await this.getAssignment(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve assignment after creation: ${data.id}`);
    }
    return created;
  }

  async updateAssignment(
    id: string,
    data: { status?: IssueAssignmentStatus; assignedTo?: string; notes?: string },
  ): Promise<void> {
    const setFields: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (data.status !== undefined) setFields['status'] = data.status;
    if (data.assignedTo !== undefined) setFields['assignedTo'] = data.assignedTo.trim() || null;
    if (data.notes !== undefined) setFields['notes'] = data.notes.trim() || null;

    await this.collection.updateOne({ _id: id }, { $set: setFields });
  }

  async deleteAssignment(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: id });
  }

  async getAssignmentStats(scanId: string): Promise<AssignmentStats> {
    const pipeline = [
      { $match: { scanId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ];

    const results = await this.collection.aggregate<{ _id: string; count: number }>(pipeline).toArray();

    const stats: AssignmentStats = {
      open: 0,
      assigned: 0,
      inProgress: 0,
      fixed: 0,
      verified: 0,
      total: 0,
    };

    let total = 0;
    const mutable = stats as Record<string, number>;

    for (const row of results) {
      total += row.count;
      switch (row._id) {
        case 'open': mutable['open'] = row.count; break;
        case 'assigned': mutable['assigned'] = row.count; break;
        case 'in-progress': mutable['inProgress'] = row.count; break;
        case 'fixed': mutable['fixed'] = row.count; break;
        case 'verified': mutable['verified'] = row.count; break;
      }
    }

    return { ...stats, total };
  }
}
