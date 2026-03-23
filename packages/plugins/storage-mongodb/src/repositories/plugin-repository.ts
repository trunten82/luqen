import type { Collection, Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

type PluginType = 'auth' | 'notification' | 'storage' | 'scanner';
type PluginStatus = 'inactive' | 'active' | 'error' | 'install-failed' | 'unhealthy';

interface PluginRecord {
  readonly id: string;
  readonly packageName: string;
  readonly type: PluginType;
  readonly version: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly status: PluginStatus;
  readonly installedAt: string;
  readonly activatedAt?: string;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// MongoDB document type
// ---------------------------------------------------------------------------

interface PluginDoc {
  _id: string;
  packageName: string;
  type: string;
  version: string;
  config: Record<string, unknown>;
  status: string;
  installedAt: string;
  activatedAt: string | null;
  error: string | null;
}

function docToRecord(doc: PluginDoc): PluginRecord {
  return {
    id: doc._id,
    packageName: doc.packageName,
    type: doc.type as PluginType,
    version: doc.version,
    config: doc.config,
    status: doc.status as PluginStatus,
    installedAt: doc.installedAt,
    ...(doc.activatedAt ? { activatedAt: doc.activatedAt } : {}),
    ...(doc.error ? { error: doc.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// MongoPluginRepository
// ---------------------------------------------------------------------------

export class MongoPluginRepository {
  private readonly collection: Collection<PluginDoc>;

  constructor(db: Db) {
    this.collection = db.collection<PluginDoc>('plugins');
  }

  async listPlugins(): Promise<PluginRecord[]> {
    const docs = await this.collection
      .find({})
      .sort({ installedAt: -1 })
      .toArray();
    return docs.map(docToRecord);
  }

  async getPlugin(id: string): Promise<PluginRecord | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc !== null ? docToRecord(doc) : null;
  }

  async getPluginByPackageName(packageName: string): Promise<PluginRecord | null> {
    const doc = await this.collection.findOne({ packageName });
    return doc !== null ? docToRecord(doc) : null;
  }

  async listByTypeAndStatus(type: string, status: string): Promise<PluginRecord[]> {
    const docs = await this.collection
      .find({ type, status })
      .sort({ installedAt: -1 })
      .toArray();
    return docs.map(docToRecord);
  }

  async listByStatus(status: string): Promise<PluginRecord[]> {
    const docs = await this.collection
      .find({ status })
      .sort({ installedAt: -1 })
      .toArray();
    return docs.map(docToRecord);
  }

  async getByPackageNameAndStatus(packageName: string, status: string): Promise<PluginRecord | null> {
    const doc = await this.collection.findOne({ packageName, status });
    return doc !== null ? docToRecord(doc) : null;
  }

  async createPlugin(data: {
    readonly id: string;
    readonly packageName: string;
    readonly type: string;
    readonly version: string;
    readonly config?: Record<string, unknown>;
    readonly status?: string;
  }): Promise<PluginRecord> {
    const now = new Date().toISOString();

    const doc: PluginDoc = {
      _id: data.id,
      packageName: data.packageName,
      type: data.type,
      version: data.version,
      config: data.config ?? {},
      status: data.status ?? 'inactive',
      installedAt: now,
      activatedAt: null,
      error: null,
    };

    await this.collection.insertOne(doc);

    const created = await this.getPlugin(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve plugin after creation: ${data.id}`);
    }
    return created;
  }

  async updatePlugin(id: string, data: Partial<{
    status: string;
    config: Record<string, unknown>;
    version: string;
    activatedAt: string | null;
    error: string | null;
  }>): Promise<void> {
    const setFields: Record<string, unknown> = {};

    if (data.status !== undefined) setFields['status'] = data.status;
    if (data.config !== undefined) setFields['config'] = data.config;
    if (data.version !== undefined) setFields['version'] = data.version;
    if (data.activatedAt !== undefined) setFields['activatedAt'] = data.activatedAt;
    if (data.error !== undefined) setFields['error'] = data.error;

    if (Object.keys(setFields).length === 0) return;

    await this.collection.updateOne({ _id: id }, { $set: setFields });
  }

  async deletePlugin(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: id });
  }
}
