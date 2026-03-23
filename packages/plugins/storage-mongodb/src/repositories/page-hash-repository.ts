import type { Collection, Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface PageHashEntry {
  readonly siteUrl: string;
  readonly pageUrl: string;
  readonly hash: string;
  readonly orgId: string;
}

// ---------------------------------------------------------------------------
// MongoDB document type
// ---------------------------------------------------------------------------

interface PageHashDoc {
  _id: string;
  siteUrl: string;
  pageUrl: string;
  contentHash: string;
  lastScannedAt: string;
  orgId: string;
}

function makeId(siteUrl: string, pageUrl: string, orgId: string): string {
  return `${orgId}::${siteUrl}::${pageUrl}`;
}

// ---------------------------------------------------------------------------
// MongoPageHashRepository
// ---------------------------------------------------------------------------

export class MongoPageHashRepository {
  private readonly collection: Collection<PageHashDoc>;

  constructor(db: Db) {
    this.collection = db.collection<PageHashDoc>('page_hashes');
  }

  async getPageHashes(siteUrl: string, orgId: string): Promise<Map<string, string>> {
    const docs = await this.collection
      .find({ siteUrl, orgId })
      .toArray();

    const result = new Map<string, string>();
    for (const doc of docs) {
      result.set(doc.pageUrl, doc.contentHash);
    }
    return result;
  }

  async upsertPageHash(siteUrl: string, pageUrl: string, hash: string, orgId: string): Promise<void> {
    const id = makeId(siteUrl, pageUrl, orgId);
    const now = new Date().toISOString();

    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          siteUrl,
          pageUrl,
          contentHash: hash,
          lastScannedAt: now,
          orgId,
        },
        $setOnInsert: { _id: id },
      },
      { upsert: true },
    );
  }

  async upsertPageHashes(entries: ReadonlyArray<PageHashEntry>): Promise<void> {
    if (entries.length === 0) return;

    const now = new Date().toISOString();
    const bulkOps = entries.map((entry) => ({
      updateOne: {
        filter: { _id: makeId(entry.siteUrl, entry.pageUrl, entry.orgId) },
        update: {
          $set: {
            siteUrl: entry.siteUrl,
            pageUrl: entry.pageUrl,
            contentHash: entry.hash,
            lastScannedAt: now,
            orgId: entry.orgId,
          },
          $setOnInsert: {
            _id: makeId(entry.siteUrl, entry.pageUrl, entry.orgId),
          },
        },
        upsert: true,
      },
    }));

    await this.collection.bulkWrite(bulkOps);
  }
}
