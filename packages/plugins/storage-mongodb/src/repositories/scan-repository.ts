import type { Collection, Db, Filter } from 'mongodb';

// ---------------------------------------------------------------------------
// Domain types (mirrored from dashboard for decoupling)
// ---------------------------------------------------------------------------

interface ScanRecord {
  readonly id: string;
  readonly siteUrl: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly standard: string;
  readonly jurisdictions: string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly pagesScanned?: number;
  readonly totalIssues?: number;
  readonly errors?: number;
  readonly warnings?: number;
  readonly notices?: number;
  readonly confirmedViolations?: number;
  readonly jsonReportPath?: string;
  readonly jsonReport?: string;
  readonly error?: string;
  readonly orgId: string;
}

interface ScanFilters {
  readonly status?: ScanRecord['status'];
  readonly createdBy?: string;
  readonly siteUrl?: string;
  readonly orgId?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly from?: string;
  readonly to?: string;
}

type ScanUpdateData = Partial<Omit<ScanRecord, 'id' | 'createdBy' | 'createdAt'>>;

interface CreateScanInput {
  readonly id: string;
  readonly siteUrl: string;
  readonly standard: string;
  readonly jurisdictions: string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly orgId?: string;
}

// ---------------------------------------------------------------------------
// MongoDB document type
// ---------------------------------------------------------------------------

interface ScanDoc {
  _id: string;
  siteUrl: string;
  status: string;
  standard: string;
  jurisdictions: string[];
  createdBy: string;
  createdAt: string;
  completedAt?: string;
  pagesScanned?: number;
  totalIssues?: number;
  errors?: number;
  warnings?: number;
  notices?: number;
  confirmedViolations?: number;
  jsonReportPath?: string;
  jsonReport?: string;
  error?: string;
  orgId: string;
}

function docToRecord(doc: ScanDoc): ScanRecord {
  const base: ScanRecord = {
    id: doc._id,
    siteUrl: doc.siteUrl,
    status: doc.status as ScanRecord['status'],
    standard: doc.standard,
    jurisdictions: doc.jurisdictions,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    orgId: doc.orgId,
  };

  return {
    ...base,
    ...(doc.completedAt !== undefined ? { completedAt: doc.completedAt } : {}),
    ...(doc.pagesScanned !== undefined ? { pagesScanned: doc.pagesScanned } : {}),
    ...(doc.totalIssues !== undefined ? { totalIssues: doc.totalIssues } : {}),
    ...(doc.errors !== undefined ? { errors: doc.errors } : {}),
    ...(doc.warnings !== undefined ? { warnings: doc.warnings } : {}),
    ...(doc.notices !== undefined ? { notices: doc.notices } : {}),
    ...(doc.confirmedViolations !== undefined ? { confirmedViolations: doc.confirmedViolations } : {}),
    ...(doc.jsonReportPath !== undefined ? { jsonReportPath: doc.jsonReportPath } : {}),
    ...(doc.error !== undefined ? { error: doc.error } : {}),
  };
}

function buildFilter(filters: ScanFilters): Filter<ScanDoc> {
  const query: Filter<ScanDoc> = {};

  if (filters.status !== undefined) {
    query['status'] = filters.status;
  }
  if (filters.createdBy !== undefined) {
    query['createdBy'] = filters.createdBy;
  }
  if (filters.siteUrl !== undefined) {
    query['siteUrl'] = { $regex: filters.siteUrl, $options: 'i' };
  }
  if (filters.orgId !== undefined) {
    query['orgId'] = filters.orgId;
  }
  if (filters.from !== undefined || filters.to !== undefined) {
    const range: Record<string, string> = {};
    if (filters.from !== undefined) range['$gte'] = filters.from;
    if (filters.to !== undefined) range['$lte'] = filters.to;
    query['createdAt'] = range;
  }

  return query;
}

// ---------------------------------------------------------------------------
// MongoScanRepository
// ---------------------------------------------------------------------------

export class MongoScanRepository {
  private readonly collection: Collection<ScanDoc>;

  constructor(db: Db) {
    this.collection = db.collection<ScanDoc>('scan_records');
  }

  async createScan(data: CreateScanInput): Promise<ScanRecord> {
    const doc: ScanDoc = {
      _id: data.id,
      siteUrl: data.siteUrl,
      status: 'queued',
      standard: data.standard,
      jurisdictions: [...data.jurisdictions],
      createdBy: data.createdBy,
      createdAt: data.createdAt,
      orgId: data.orgId ?? 'system',
    };

    await this.collection.insertOne(doc);

    const created = await this.getScan(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve scan record after creation: ${data.id}`);
    }
    return created;
  }

  async getScan(id: string): Promise<ScanRecord | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc !== null ? docToRecord(doc) : null;
  }

  async listScans(filters: ScanFilters = {}): Promise<ScanRecord[]> {
    const query = buildFilter(filters);
    let cursor = this.collection.find(query).sort({ createdAt: -1 });

    if (filters.offset !== undefined) {
      cursor = cursor.skip(filters.offset);
    }
    if (filters.limit !== undefined) {
      cursor = cursor.limit(filters.limit);
    }

    const docs = await cursor.toArray();
    return docs.map(docToRecord);
  }

  async countScans(filters: ScanFilters = {}): Promise<number> {
    const query = buildFilter(filters);
    return this.collection.countDocuments(query);
  }

  async updateScan(id: string, data: ScanUpdateData): Promise<ScanRecord> {
    const setFields: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id' || key === 'createdBy' || key === 'createdAt') continue;
      if (value !== undefined) {
        setFields[key] = value;
      }
    }

    if (Object.keys(setFields).length === 0) {
      const existing = await this.getScan(id);
      if (existing === null) {
        throw new Error(`Scan record not found: ${id}`);
      }
      return existing;
    }

    await this.collection.updateOne({ _id: id }, { $set: setFields });

    const updated = await this.getScan(id);
    if (updated === null) {
      throw new Error(`Scan record not found after update: ${id}`);
    }
    return updated;
  }

  async deleteScan(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: id });
  }

  async deleteOrgScans(orgId: string): Promise<void> {
    await this.collection.deleteMany({ orgId });
  }

  async getReport(id: string): Promise<Record<string, unknown> | null> {
    const doc = await this.collection.findOne(
      { _id: id },
      { projection: { jsonReport: 1 } },
    );
    if (doc === null || doc.jsonReport === undefined) return null;
    try {
      return JSON.parse(doc.jsonReport) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async getTrendData(orgId?: string): Promise<ScanRecord[]> {
    const query: Filter<ScanDoc> = { status: 'completed' };
    if (orgId !== undefined) {
      query['orgId'] = orgId;
    }

    const docs = await this.collection
      .find(query)
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map(docToRecord);
  }

  async getLatestPerSite(orgId: string): Promise<ScanRecord[]> {
    const pipeline = [
      { $match: { orgId, status: 'completed' } },
      { $sort: { createdAt: -1 as const } },
      {
        $group: {
          _id: '$siteUrl',
          doc: { $first: '$$ROOT' },
        },
      },
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { createdAt: -1 as const } },
    ];

    const docs = await this.collection.aggregate<ScanDoc>(pipeline).toArray();
    return docs.map(docToRecord);
  }
}
