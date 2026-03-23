import type { Collection, Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface ScanSchedule {
  readonly id: string;
  readonly siteUrl: string;
  readonly standard: string;
  readonly scanMode: string;
  readonly jurisdictions: string[];
  readonly frequency: string;
  readonly nextRunAt: string;
  readonly lastRunAt: string | null;
  readonly enabled: boolean;
  readonly createdBy: string;
  readonly orgId: string;
  readonly runner: string | null;
  readonly incremental: boolean;
}

interface CreateScheduleInput {
  readonly id: string;
  readonly siteUrl: string;
  readonly standard: string;
  readonly scanMode: string;
  readonly jurisdictions: string[];
  readonly frequency: string;
  readonly nextRunAt: string;
  readonly createdBy: string;
  readonly orgId: string;
  readonly runner?: string;
  readonly incremental?: boolean;
}

// ---------------------------------------------------------------------------
// MongoDB document type
// ---------------------------------------------------------------------------

interface ScheduleDoc {
  _id: string;
  siteUrl: string;
  standard: string;
  scanMode: string;
  jurisdictions: string[];
  frequency: string;
  nextRunAt: string;
  lastRunAt: string | null;
  enabled: boolean;
  createdBy: string;
  orgId: string;
  runner: string | null;
  incremental: boolean;
}

function docToRecord(doc: ScheduleDoc): ScanSchedule {
  return {
    id: doc._id,
    siteUrl: doc.siteUrl,
    standard: doc.standard,
    scanMode: doc.scanMode,
    jurisdictions: doc.jurisdictions,
    frequency: doc.frequency,
    nextRunAt: doc.nextRunAt,
    lastRunAt: doc.lastRunAt,
    enabled: doc.enabled,
    createdBy: doc.createdBy,
    orgId: doc.orgId,
    runner: doc.runner,
    incremental: doc.incremental,
  };
}

// ---------------------------------------------------------------------------
// MongoScheduleRepository
// ---------------------------------------------------------------------------

export class MongoScheduleRepository {
  private readonly collection: Collection<ScheduleDoc>;

  constructor(db: Db) {
    this.collection = db.collection<ScheduleDoc>('scan_schedules');
  }

  async listSchedules(orgId?: string): Promise<ScanSchedule[]> {
    const query = orgId !== undefined ? { orgId } : {};
    const docs = await this.collection.find(query).sort({ nextRunAt: 1 }).toArray();
    return docs.map(docToRecord);
  }

  async getSchedule(id: string): Promise<ScanSchedule | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc !== null ? docToRecord(doc) : null;
  }

  async createSchedule(data: CreateScheduleInput): Promise<ScanSchedule> {
    const doc: ScheduleDoc = {
      _id: data.id,
      siteUrl: data.siteUrl,
      standard: data.standard,
      scanMode: data.scanMode,
      jurisdictions: [...data.jurisdictions],
      frequency: data.frequency,
      nextRunAt: data.nextRunAt,
      lastRunAt: null,
      enabled: true,
      createdBy: data.createdBy,
      orgId: data.orgId,
      runner: data.runner ?? 'htmlcs',
      incremental: data.incremental ?? false,
    };

    await this.collection.insertOne(doc);

    const created = await this.getSchedule(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve schedule after creation: ${data.id}`);
    }
    return created;
  }

  async updateSchedule(
    id: string,
    data: Partial<{ enabled: boolean; nextRunAt: string; lastRunAt: string }>,
  ): Promise<void> {
    const setFields: Record<string, unknown> = {};

    if (data.enabled !== undefined) setFields['enabled'] = data.enabled;
    if (data.nextRunAt !== undefined) setFields['nextRunAt'] = data.nextRunAt;
    if (data.lastRunAt !== undefined) setFields['lastRunAt'] = data.lastRunAt;

    if (Object.keys(setFields).length === 0) return;

    await this.collection.updateOne({ _id: id }, { $set: setFields });
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: id });
  }

  async getDueSchedules(): Promise<ScanSchedule[]> {
    const now = new Date().toISOString();
    const docs = await this.collection
      .find({ nextRunAt: { $lte: now }, enabled: true })
      .toArray();
    return docs.map(docToRecord);
  }
}
