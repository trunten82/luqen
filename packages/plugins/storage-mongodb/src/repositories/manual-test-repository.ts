import type { Collection, Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

type ManualTestStatus = 'untested' | 'pass' | 'fail' | 'na';

interface ManualTestResult {
  readonly id: string;
  readonly scanId: string;
  readonly criterionId: string;
  readonly status: ManualTestStatus;
  readonly notes: string | null;
  readonly testedBy: string | null;
  readonly testedAt: string | null;
  readonly orgId: string;
}

interface UpsertManualTestInput {
  readonly scanId: string;
  readonly criterionId: string;
  readonly status: ManualTestStatus;
  readonly notes?: string | null;
  readonly testedBy?: string | null;
  readonly testedAt?: string | null;
  readonly orgId?: string;
}

// ---------------------------------------------------------------------------
// MongoDB document type
// ---------------------------------------------------------------------------

interface ManualTestDoc {
  _id: string;
  scanId: string;
  criterionId: string;
  status: string;
  notes: string | null;
  testedBy: string | null;
  testedAt: string | null;
  orgId: string;
}

function docToRecord(doc: ManualTestDoc): ManualTestResult {
  return {
    id: doc._id,
    scanId: doc.scanId,
    criterionId: doc.criterionId,
    status: doc.status as ManualTestStatus,
    notes: doc.notes,
    testedBy: doc.testedBy,
    testedAt: doc.testedAt,
    orgId: doc.orgId,
  };
}

// ---------------------------------------------------------------------------
// MongoManualTestRepository
// ---------------------------------------------------------------------------

export class MongoManualTestRepository {
  private readonly collection: Collection<ManualTestDoc>;

  constructor(db: Db) {
    this.collection = db.collection<ManualTestDoc>('manual_test_results');
  }

  async getManualTests(scanId: string): Promise<ManualTestResult[]> {
    const docs = await this.collection
      .find({ scanId })
      .sort({ criterionId: 1 })
      .toArray();
    return docs.map(docToRecord);
  }

  async upsertManualTest(data: UpsertManualTestInput): Promise<ManualTestResult> {
    const now = new Date().toISOString();
    const id = `mt-${data.scanId}-${data.criterionId}`;
    const orgId = data.orgId ?? 'system';
    const testedAt = data.testedAt ?? now;

    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          scanId: data.scanId,
          criterionId: data.criterionId,
          status: data.status,
          notes: data.notes ?? null,
          testedBy: data.testedBy ?? null,
          testedAt,
          orgId,
        },
        $setOnInsert: { _id: id },
      },
      { upsert: true },
    );

    return {
      id,
      scanId: data.scanId,
      criterionId: data.criterionId,
      status: data.status,
      notes: data.notes ?? null,
      testedBy: data.testedBy ?? null,
      testedAt,
      orgId,
    };
  }
}
