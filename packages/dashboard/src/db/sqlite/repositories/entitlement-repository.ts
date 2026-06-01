import type Database from 'better-sqlite3';
import type {
  EntitlementRepository,
  EntitlementRecord,
  OrgPlan,
} from '../../interfaces/entitlement-repository.js';
import { ORG_PLANS } from '../../interfaces/entitlement-repository.js';

interface EntitlementRow {
  org_id: string;
  plan: string;
  updated_at: string;
  updated_by: string | null;
}

function normalizePlan(plan: string): OrgPlan {
  return (ORG_PLANS as readonly string[]).includes(plan) ? (plan as OrgPlan) : 'free';
}

function rowToRecord(row: EntitlementRow): EntitlementRecord {
  return {
    orgId: row.org_id,
    plan: normalizePlan(row.plan),
    updatedAt: row.updated_at,
    ...(row.updated_by !== null ? { updatedBy: row.updated_by } : {}),
  };
}

export class SqliteEntitlementRepository implements EntitlementRepository {
  constructor(private readonly db: Database.Database) {}

  async get(orgId: string): Promise<EntitlementRecord> {
    const row = this.db
      .prepare('SELECT * FROM org_entitlements WHERE org_id = ?')
      .get(orgId) as EntitlementRow | undefined;
    if (row === undefined) {
      return { orgId, plan: 'free', updatedAt: '1970-01-01T00:00:00.000Z' };
    }
    return rowToRecord(row);
  }

  async setPlan(orgId: string, plan: OrgPlan, updatedBy?: string): Promise<EntitlementRecord> {
    const now = new Date().toISOString();
    const safe = normalizePlan(plan);
    this.db
      .prepare(
        `INSERT INTO org_entitlements (org_id, plan, updated_at, updated_by)
         VALUES (@orgId, @plan, @updatedAt, @updatedBy)
         ON CONFLICT(org_id) DO UPDATE SET
           plan = @plan, updated_at = @updatedAt, updated_by = @updatedBy`,
      )
      .run({ orgId, plan: safe, updatedAt: now, updatedBy: updatedBy ?? null });
    return this.get(orgId);
  }
}
