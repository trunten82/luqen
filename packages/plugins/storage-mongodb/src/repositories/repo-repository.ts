import type { Collection, Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface ConnectedRepo {
  readonly id: string;
  readonly siteUrlPattern: string;
  readonly repoUrl: string;
  readonly repoPath: string | null;
  readonly branch: string;
  readonly authToken: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly orgId: string;
}

// ---------------------------------------------------------------------------
// MongoDB document type
// ---------------------------------------------------------------------------

interface RepoDoc {
  _id: string;
  siteUrlPattern: string;
  repoUrl: string;
  repoPath: string | null;
  branch: string;
  authToken: string | null;
  createdBy: string;
  createdAt: string;
  orgId: string;
}

function docToRecord(doc: RepoDoc): ConnectedRepo {
  return {
    id: doc._id,
    siteUrlPattern: doc.siteUrlPattern,
    repoUrl: doc.repoUrl,
    repoPath: doc.repoPath,
    branch: doc.branch,
    authToken: doc.authToken,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    orgId: doc.orgId,
  };
}

// ---------------------------------------------------------------------------
// MongoRepoRepository
// ---------------------------------------------------------------------------

export class MongoRepoRepository {
  private readonly collection: Collection<RepoDoc>;

  constructor(db: Db) {
    this.collection = db.collection<RepoDoc>('connected_repos');
  }

  async listRepos(orgId?: string): Promise<ConnectedRepo[]> {
    const query = orgId !== undefined ? { orgId } : {};
    const docs = await this.collection.find(query).sort({ createdAt: -1 }).toArray();
    return docs.map(docToRecord);
  }

  async getRepo(id: string): Promise<ConnectedRepo | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc !== null ? docToRecord(doc) : null;
  }

  async findRepoForUrl(siteUrl: string, orgId: string): Promise<ConnectedRepo | null> {
    // Fetch all repos for the org and check pattern matching in code
    // (MongoDB $regex on the data field is inverted — we need the pattern stored
    //  in the doc to match the provided siteUrl)
    const docs = await this.collection
      .find({ orgId })
      .sort({ createdAt: -1 })
      .toArray();

    for (const doc of docs) {
      // Convert SQL LIKE pattern (%) to regex
      const pattern = doc.siteUrlPattern
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
      const regex = new RegExp(`^${pattern}$`, 'i');
      if (regex.test(siteUrl)) {
        return docToRecord(doc);
      }
    }

    return null;
  }

  async createRepo(data: {
    readonly id: string;
    readonly siteUrlPattern: string;
    readonly repoUrl: string;
    readonly repoPath?: string;
    readonly branch?: string;
    readonly authToken?: string;
    readonly createdBy: string;
    readonly orgId?: string;
  }): Promise<ConnectedRepo> {
    const now = new Date().toISOString();

    const doc: RepoDoc = {
      _id: data.id,
      siteUrlPattern: data.siteUrlPattern,
      repoUrl: data.repoUrl,
      repoPath: data.repoPath ?? null,
      branch: data.branch ?? 'main',
      authToken: data.authToken ?? null,
      createdBy: data.createdBy,
      createdAt: now,
      orgId: data.orgId ?? 'system',
    };

    await this.collection.insertOne(doc);

    const created = await this.getRepo(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve connected repo after creation: ${data.id}`);
    }
    return created;
  }

  async deleteRepo(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: id });
  }
}
