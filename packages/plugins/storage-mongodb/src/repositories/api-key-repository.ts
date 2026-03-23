import type { Collection, Db } from 'mongodb';
import { randomBytes, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface ApiKeyRecord {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly orgId: string;
}

// ---------------------------------------------------------------------------
// MongoDB document type
// ---------------------------------------------------------------------------

interface ApiKeyDoc {
  _id: string;
  keyHash: string;
  label: string;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  orgId: string;
}

function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function docToRecord(doc: ApiKeyDoc): ApiKeyRecord {
  return {
    id: doc._id,
    label: doc.label,
    active: doc.active,
    createdAt: doc.createdAt,
    lastUsedAt: doc.lastUsedAt,
    orgId: doc.orgId,
  };
}

// ---------------------------------------------------------------------------
// MongoApiKeyRepository
// ---------------------------------------------------------------------------

export class MongoApiKeyRepository {
  private readonly collection: Collection<ApiKeyDoc>;

  constructor(db: Db) {
    this.collection = db.collection<ApiKeyDoc>('api_keys');
  }

  async storeKey(key: string, label: string, orgId?: string): Promise<string> {
    const id = randomBytes(16).toString('hex');
    const keyHash = hashApiKey(key);
    const createdAt = new Date().toISOString();

    const doc: ApiKeyDoc = {
      _id: id,
      keyHash,
      label,
      active: true,
      createdAt,
      lastUsedAt: null,
      orgId: orgId ?? 'system',
    };

    await this.collection.insertOne(doc);
    return id;
  }

  async validateKey(key: string): Promise<boolean> {
    const keyHash = hashApiKey(key);
    const doc = await this.collection.findOne({ keyHash, active: true });

    if (doc !== null) {
      await this.collection.updateOne(
        { keyHash },
        { $set: { lastUsedAt: new Date().toISOString() } },
      );
    }

    return doc !== null;
  }

  async getOrCreateKey(): Promise<{ key: string | null; isNew: boolean }> {
    const existing = await this.collection.findOne({ active: true });

    if (existing !== null) {
      return { key: null, isNew: false };
    }

    const key = generateApiKey();
    await this.storeKey(key, 'default');
    return { key, isNew: true };
  }

  async revokeAllKeys(): Promise<void> {
    await this.collection.updateMany({}, { $set: { active: false } });
  }

  async listKeys(orgId?: string): Promise<ApiKeyRecord[]> {
    const query = orgId !== undefined ? { orgId } : {};
    const docs = await this.collection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map(docToRecord);
  }

  async revokeKey(id: string): Promise<void> {
    await this.collection.updateOne({ _id: id }, { $set: { active: false } });
  }
}
