import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  CreditRepository,
  OrgPlan,
  OrgPlanTier,
  CreditLedgerEntry,
  CreditCheck,
  CreditConsumeResult,
} from '../../interfaces/credit-repository.js';

interface PlanRow {
  org_id: string;
  plan: string;
  ai_credits_allocated: number | null;
  ai_credits_used: number;
  updated_at: string;
  updated_by: string | null;
}

interface LedgerRow {
  id: string;
  org_id: string;
  delta: number;
  reason: string;
  balance_after: number | null;
  actor: string | null;
  created_at: string;
}

const VALID_TIERS: ReadonlySet<string> = new Set(['free', 'pro', 'agency']);

function rowToPlan(row: PlanRow): OrgPlan {
  const allocated = row.ai_credits_allocated;
  const unlimited = allocated === null;
  return {
    orgId: row.org_id,
    plan: (VALID_TIERS.has(row.plan) ? row.plan : 'free') as OrgPlanTier,
    allocated,
    used: row.ai_credits_used,
    balance: unlimited ? null : Math.max(0, allocated - row.ai_credits_used),
    unlimited,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function ledgerRowTo(row: LedgerRow): CreditLedgerEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    delta: row.delta,
    reason: row.reason,
    balanceAfter: row.balance_after,
    actor: row.actor,
    createdAt: row.created_at,
  };
}

const DEFAULT_LEDGER_LIMIT = 200;

export class SqliteCreditRepository implements CreditRepository {
  constructor(private readonly db: Database.Database) {}

  private readRow(orgId: string): PlanRow | undefined {
    return this.db
      .prepare('SELECT * FROM org_plans WHERE org_id = ?')
      .get(orgId) as PlanRow | undefined;
  }

  /** Lazily materialise a default (free, unlimited) plan row. */
  private ensureRow(orgId: string): PlanRow {
    const existing = this.readRow(orgId);
    if (existing !== undefined) return existing;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO org_plans (org_id, plan, ai_credits_allocated, ai_credits_used, updated_at, updated_by)
         VALUES (?, 'free', NULL, 0, ?, NULL)
         ON CONFLICT(org_id) DO NOTHING`,
      )
      .run(orgId, now);
    return this.readRow(orgId) as PlanRow;
  }

  private appendLedger(
    orgId: string,
    delta: number,
    reason: string,
    balanceAfter: number | null,
    actor: string | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO credit_ledger (id, org_id, delta, reason, balance_after, actor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(`cl_${randomUUID().replace(/-/g, '')}`, orgId, delta, reason, balanceAfter, actor, new Date().toISOString());
  }

  async getPlan(orgId: string): Promise<OrgPlan> {
    const row = this.readRow(orgId);
    if (row === undefined) {
      // Virtual default — don't write on read.
      return {
        orgId,
        plan: 'free',
        allocated: null,
        used: 0,
        balance: null,
        unlimited: true,
        updatedAt: '',
        updatedBy: null,
      };
    }
    return rowToPlan(row);
  }

  async setPlan(orgId: string, plan: OrgPlanTier, actor: string | null): Promise<OrgPlan> {
    this.ensureRow(orgId);
    this.db
      .prepare('UPDATE org_plans SET plan = ?, updated_at = ?, updated_by = ? WHERE org_id = ?')
      .run(plan, new Date().toISOString(), actor, orgId);
    return rowToPlan(this.readRow(orgId) as PlanRow);
  }

  async setAllocation(orgId: string, allocated: number | null, actor: string | null): Promise<OrgPlan> {
    const before = rowToPlan(this.ensureRow(orgId));
    const normalized = allocated === null ? null : Math.max(0, Math.floor(allocated));
    this.db
      .prepare('UPDATE org_plans SET ai_credits_allocated = ?, updated_at = ?, updated_by = ? WHERE org_id = ?')
      .run(normalized, new Date().toISOString(), actor, orgId);
    const after = rowToPlan(this.readRow(orgId) as PlanRow);
    const delta = (normalized ?? 0) - (before.allocated ?? 0);
    this.appendLedger(orgId, delta, 'admin.set', after.balance, actor);
    return after;
  }

  async topUp(orgId: string, amount: number, actor: string | null): Promise<OrgPlan> {
    const row = this.ensureRow(orgId);
    if (row.ai_credits_allocated === null) {
      // Unlimited stays unlimited — top-up is a no-op but still audited.
      this.appendLedger(orgId, 0, 'admin.topup', null, actor);
      return rowToPlan(row);
    }
    const inc = Math.max(0, Math.floor(amount));
    this.db
      .prepare('UPDATE org_plans SET ai_credits_allocated = ai_credits_allocated + ?, updated_at = ?, updated_by = ? WHERE org_id = ?')
      .run(inc, new Date().toISOString(), actor, orgId);
    const after = rowToPlan(this.readRow(orgId) as PlanRow);
    this.appendLedger(orgId, inc, 'admin.topup', after.balance, actor);
    return after;
  }

  async check(orgId: string): Promise<CreditCheck> {
    const plan = await this.getPlan(orgId);
    if (plan.unlimited) return { allowed: true, unlimited: true, balance: null };
    return { allowed: (plan.balance ?? 0) > 0, unlimited: false, balance: plan.balance };
  }

  async consume(orgId: string, amount: number, reason: string, actor: string | null): Promise<CreditConsumeResult> {
    const amt = Math.max(1, Math.floor(amount));
    // Single transaction: re-read inside to keep the check+decrement atomic.
    const txn = this.db.transaction((): CreditConsumeResult => {
      const row = this.readRow(orgId);
      // No row yet → unlimited default; nothing to decrement.
      if (row === undefined || row.ai_credits_allocated === null) {
        return { allowed: true, unlimited: true, balanceAfter: null };
      }
      const balance = Math.max(0, row.ai_credits_allocated - row.ai_credits_used);
      if (balance < amt) {
        return { allowed: false, unlimited: false, balanceAfter: balance };
      }
      this.db
        .prepare('UPDATE org_plans SET ai_credits_used = ai_credits_used + ?, updated_at = ? WHERE org_id = ?')
        .run(amt, new Date().toISOString(), orgId);
      const after = balance - amt;
      this.appendLedger(orgId, -amt, reason, after, actor);
      return { allowed: true, unlimited: false, balanceAfter: after };
    });
    return txn();
  }

  async getLedger(orgId: string, limit = DEFAULT_LEDGER_LIMIT): Promise<readonly CreditLedgerEntry[]> {
    const capped = Math.min(Math.max(1, limit), 1000);
    const rows = this.db
      .prepare(`SELECT * FROM credit_ledger WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${capped}`)
      .all(orgId) as LedgerRow[];
    return rows.map(ledgerRowTo);
  }
}
