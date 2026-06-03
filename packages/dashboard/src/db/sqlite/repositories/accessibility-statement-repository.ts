import type Database from 'better-sqlite3';
import type {
  AccessibilityStatementRepository,
  AccessibilityStatementRecord,
  AccessibilityStatementInput,
  AccessibilityStatementWithOrg,
} from '../../interfaces/accessibility-statement-repository.js';

interface StatementRow {
  org_id: string;
  enabled: number;
  entity_name: string | null;
  site_url: string | null;
  wcag_version: string;
  wcag_level: string;
  contact_email: string | null;
  contact_url: string | null;
  commitment: string | null;
  acr_url: string | null;
  updated_at: string;
  updated_by: string | null;
}

function rowToRecord(row: StatementRow): AccessibilityStatementRecord {
  return {
    orgId: row.org_id,
    enabled: row.enabled === 1,
    wcagVersion: row.wcag_version,
    wcagLevel: row.wcag_level,
    updatedAt: row.updated_at,
    ...(row.entity_name !== null ? { entityName: row.entity_name } : {}),
    ...(row.site_url !== null ? { siteUrl: row.site_url } : {}),
    ...(row.contact_email !== null ? { contactEmail: row.contact_email } : {}),
    ...(row.contact_url !== null ? { contactUrl: row.contact_url } : {}),
    ...(row.commitment !== null ? { commitment: row.commitment } : {}),
    ...(row.acr_url !== null ? { acrUrl: row.acr_url } : {}),
    ...(row.updated_by !== null ? { updatedBy: row.updated_by } : {}),
  };
}

export class SqliteAccessibilityStatementRepository
  implements AccessibilityStatementRepository
{
  constructor(private readonly db: Database.Database) {}

  async get(orgId: string): Promise<AccessibilityStatementRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM accessibility_statements WHERE org_id = ?')
      .get(orgId) as StatementRow | undefined;
    return row === undefined ? null : rowToRecord(row);
  }

  async getEnabledByOrgSlug(
    slug: string,
  ): Promise<AccessibilityStatementWithOrg | null> {
    const row = this.db
      .prepare(
        `SELECT s.*, o.name AS org_name, o.slug AS org_slug
         FROM accessibility_statements s
         JOIN organizations o ON o.id = s.org_id
         WHERE o.slug = ? AND s.enabled = 1`,
      )
      .get(slug) as (StatementRow & { org_name: string; org_slug: string }) | undefined;
    if (row === undefined) return null;
    return {
      record: rowToRecord(row),
      orgId: row.org_id,
      orgName: row.org_name,
      orgSlug: row.org_slug,
    };
  }

  async upsert(
    orgId: string,
    data: AccessibilityStatementInput,
    updatedBy?: string,
  ): Promise<AccessibilityStatementRecord> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO accessibility_statements (
           org_id, enabled, entity_name, site_url, wcag_version, wcag_level,
           contact_email, contact_url, commitment, acr_url, updated_at, updated_by
         ) VALUES (
           @orgId, @enabled, @entityName, @siteUrl, @wcagVersion, @wcagLevel,
           @contactEmail, @contactUrl, @commitment, @acrUrl, @updatedAt, @updatedBy
         )
         ON CONFLICT(org_id) DO UPDATE SET
           enabled = @enabled,
           entity_name = @entityName,
           site_url = @siteUrl,
           wcag_version = @wcagVersion,
           wcag_level = @wcagLevel,
           contact_email = @contactEmail,
           contact_url = @contactUrl,
           commitment = @commitment,
           acr_url = @acrUrl,
           updated_at = @updatedAt,
           updated_by = @updatedBy`,
      )
      .run({
        orgId,
        enabled: data.enabled ? 1 : 0,
        entityName: data.entityName ?? null,
        siteUrl: data.siteUrl ?? null,
        wcagVersion: data.wcagVersion,
        wcagLevel: data.wcagLevel,
        contactEmail: data.contactEmail ?? null,
        contactUrl: data.contactUrl ?? null,
        commitment: data.commitment ?? null,
        acrUrl: data.acrUrl ?? null,
        updatedAt: now,
        updatedBy: updatedBy ?? null,
      });

    const saved = await this.get(orgId);
    if (saved === null) {
      throw new Error(`Failed to retrieve accessibility statement after upsert: ${orgId}`);
    }
    return saved;
  }
}
