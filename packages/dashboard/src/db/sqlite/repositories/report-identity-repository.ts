import type Database from 'better-sqlite3';
import type {
  ReportIdentityRepository,
  ReportIdentityRecord,
  ReportIdentityInput,
} from '../../interfaces/report-identity-repository.js';

interface IdentityRow {
  org_id: string;
  entity_name: string | null;
  contact_email: string | null;
  postal_address: string | null;
  prepared_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

function rowToRecord(row: IdentityRow): ReportIdentityRecord {
  return {
    orgId: row.org_id,
    updatedAt: row.updated_at,
    ...(row.entity_name !== null ? { entityName: row.entity_name } : {}),
    ...(row.contact_email !== null ? { contactEmail: row.contact_email } : {}),
    ...(row.postal_address !== null ? { postalAddress: row.postal_address } : {}),
    ...(row.prepared_by !== null ? { preparedBy: row.prepared_by } : {}),
    ...(row.updated_by !== null ? { updatedBy: row.updated_by } : {}),
  };
}

export class SqliteReportIdentityRepository implements ReportIdentityRepository {
  constructor(private readonly db: Database.Database) {}

  async get(orgId: string): Promise<ReportIdentityRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM report_identities WHERE org_id = ?')
      .get(orgId) as IdentityRow | undefined;
    return row === undefined ? null : rowToRecord(row);
  }

  async upsert(
    orgId: string,
    data: ReportIdentityInput,
    updatedBy?: string,
  ): Promise<ReportIdentityRecord> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO report_identities (
           org_id, entity_name, contact_email, postal_address, prepared_by,
           updated_at, updated_by
         ) VALUES (
           @orgId, @entityName, @contactEmail, @postalAddress, @preparedBy,
           @updatedAt, @updatedBy
         )
         ON CONFLICT(org_id) DO UPDATE SET
           entity_name = @entityName,
           contact_email = @contactEmail,
           postal_address = @postalAddress,
           prepared_by = @preparedBy,
           updated_at = @updatedAt,
           updated_by = @updatedBy`,
      )
      .run({
        orgId,
        entityName: data.entityName ?? null,
        contactEmail: data.contactEmail ?? null,
        postalAddress: data.postalAddress ?? null,
        preparedBy: data.preparedBy ?? null,
        updatedAt: now,
        updatedBy: updatedBy ?? null,
      });

    const saved = await this.get(orgId);
    if (saved === null) {
      throw new Error(`Failed to retrieve report identity after upsert: ${orgId}`);
    }
    return saved;
  }
}
