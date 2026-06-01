import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type {
  Provider, CreateProviderInput, UpdateProviderInput,
  Model, CreateModelInput,
  CapabilityAssignment, AssignCapabilityInput, CapabilityName,
  OAuthClient, User, PromptOverride,
  LlmUsageRecord, RecordUsageInput, UsageFilter,
  UsageGroupDimension, UsageSummaryRow,
  ProviderType,
  CreditBalance, CreditLedgerEntry,
} from '../types.js';
import type { DbAdapter } from './adapter.js';
import { defaultFreeCredits } from './adapter.js';
import { computeCost } from '../providers/pricing.js';

// ---- Row types ----

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key: string | null;
  status: string;
  timeout: number;
  created_at: string;
  updated_at: string;
}

interface PromptOverrideRow {
  capability: string;
  org_id: string;
  template: string;
  created_at: string;
  updated_at: string;
}

interface ModelRow {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  status: string;
  capabilities: string;
  created_at: string;
}

interface CapabilityAssignmentRow {
  capability: string;
  model_id: string;
  priority: number;
  org_id: string;
}

interface OAuthClientRow {
  id: string;
  name: string;
  secret_hash: string;
  scopes: string;
  grant_types: string;
  org_id: string;
  created_at: string;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  active: number;
  created_at: string;
}

interface UsageRow {
  id: string;
  occurred_at: string;
  org_id: string | null;
  capability: string;
  provider_id: string;
  provider_type: string;
  model_id: string;
  model_name: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  status: string;
  error_class: string | null;
  agent_conv_id: string | null;
  agent_msg_id: string | null;
  input_cost_usd: number | null;
  output_cost_usd: number | null;
  total_cost_usd: number | null;
}

function toUsage(row: UsageRow): LlmUsageRecord {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    orgId: row.org_id,
    capability: row.capability as CapabilityName,
    providerId: row.provider_id,
    providerType: row.provider_type as ProviderType,
    modelId: row.model_id,
    modelName: row.model_name,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    latencyMs: row.latency_ms,
    status: row.status as LlmUsageRecord['status'],
    errorClass: row.error_class,
    agentConvId: row.agent_conv_id,
    agentMsgId: row.agent_msg_id,
    inputCostUsd: row.input_cost_usd,
    outputCostUsd: row.output_cost_usd,
    totalCostUsd: row.total_cost_usd,
  };
}

// ---- Row converters ----

function toProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Provider['type'],
    baseUrl: row.base_url,
    ...(row.api_key !== null ? { apiKey: row.api_key } : {}),
    status: row.status as Provider['status'],
    timeout: row.timeout,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPromptOverride(row: PromptOverrideRow): PromptOverride {
  return {
    capability: row.capability as PromptOverride['capability'],
    orgId: row.org_id,
    template: row.template,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toModel(row: ModelRow): Model {
  return {
    id: row.id,
    providerId: row.provider_id,
    modelId: row.model_id,
    displayName: row.display_name,
    status: row.status as Model['status'],
    capabilities: JSON.parse(row.capabilities) as readonly CapabilityName[],
    createdAt: row.created_at,
  };
}

function toCapabilityAssignment(row: CapabilityAssignmentRow): CapabilityAssignment {
  return {
    capability: row.capability as CapabilityName,
    modelId: row.model_id,
    priority: row.priority,
    orgId: row.org_id,
  };
}

function toClient(row: OAuthClientRow): OAuthClient {
  return {
    id: row.id,
    name: row.name,
    secretHash: row.secret_hash,
    scopes: JSON.parse(row.scopes) as readonly string[],
    grantTypes: JSON.parse(row.grant_types) as readonly string[],
    orgId: row.org_id,
    createdAt: row.created_at,
  };
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    capabilities TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS capability_assignments (
    capability TEXT NOT NULL,
    model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 0,
    org_id TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (capability, model_id, org_id)
  );

  CREATE TABLE IF NOT EXISTS oauth_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '[]',
    grant_types TEXT NOT NULL DEFAULT '[]',
    org_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  -- Phase 72-01 — per-inference usage telemetry. One row per provider
  -- call attempt (success OR error). model_name is denormalised so
  -- history survives an admin rename of the Model row.
  CREATE TABLE IF NOT EXISTS llm_usage (
    id                TEXT PRIMARY KEY,
    occurred_at       TEXT NOT NULL,
    org_id            TEXT,
    capability        TEXT NOT NULL,
    provider_id       TEXT NOT NULL,
    provider_type     TEXT NOT NULL,
    model_id          TEXT NOT NULL,
    model_name        TEXT NOT NULL,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens      INTEGER NOT NULL DEFAULT 0,
    latency_ms        INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL,
    error_class       TEXT,
    agent_conv_id     TEXT,
    agent_msg_id      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_llm_usage_org_time
    ON llm_usage(org_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_llm_usage_capability_time
    ON llm_usage(capability, occurred_at DESC);
`;

/**
 * Phase 74 — cost columns. ALTER is idempotent via try/catch in
 * `initialize()` so deploys onto a DB that already has them are
 * no-ops. Costs are USD floats computed at write time using the
 * pricing registry; NULL means "unknown model, no published price".
 */
const COST_COLUMNS_SQL: readonly string[] = [
  `ALTER TABLE llm_usage ADD COLUMN input_cost_usd REAL`,
  `ALTER TABLE llm_usage ADD COLUMN output_cost_usd REAL`,
  `ALTER TABLE llm_usage ADD COLUMN total_cost_usd REAL`,
];

// ---- SqliteAdapter ----

export class SqliteAdapter implements DbAdapter {
  private db: BetterSqlite3Database | null = null;

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
    try { this.db.exec('ALTER TABLE providers ADD COLUMN timeout INTEGER NOT NULL DEFAULT 120'); } catch { /* column already exists */ }
    for (const stmt of COST_COLUMNS_SQL) {
      try { this.db.exec(stmt); } catch { /* column already exists */ }
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS prompt_overrides (
      capability TEXT NOT NULL,
      org_id TEXT NOT NULL DEFAULT 'system',
      template TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (capability, org_id)
    );`);

    // Phase 80 — AI-fix credit metering. `org_credits` holds the current
    // position (allocated grant + consumed); `credit_ledger` is the
    // append-only audit of every grant, top-up and consumption.
    this.db.exec(`CREATE TABLE IF NOT EXISTS org_credits (
      org_id     TEXT PRIMARY KEY,
      allocated  INTEGER NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    );`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS credit_ledger (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      delta         INTEGER NOT NULL,
      reason        TEXT NOT NULL,
      balance_after INTEGER NOT NULL,
      occurred_at   TEXT NOT NULL
    );`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_credit_ledger_org_time
      ON credit_ledger(org_id, occurred_at DESC);`);
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private get conn(): BetterSqlite3Database {
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  // ---- Providers ----

  async listProviders(): Promise<readonly Provider[]> {
    const rows = this.conn.prepare('SELECT * FROM providers ORDER BY created_at ASC').all() as ProviderRow[];
    return rows.map(toProvider);
  }

  async getProvider(id: string): Promise<Provider | undefined> {
    const row = this.conn.prepare('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow | undefined;
    return row ? toProvider(row) : undefined;
  }

  async createProvider(data: CreateProviderInput): Promise<Provider> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const timeout = data.timeout ?? 120;
    this.conn.prepare(
      'INSERT INTO providers (id, name, type, base_url, api_key, status, timeout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.name, data.type, data.baseUrl, data.apiKey ?? null, 'active', timeout, now, now);
    const row = this.conn.prepare('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow;
    return toProvider(row);
  }

  async updateProvider(id: string, data: UpdateProviderInput): Promise<Provider | undefined> {
    const existing = this.conn.prepare('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow | undefined;
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const name = data.name ?? existing.name;
    const baseUrl = data.baseUrl ?? existing.base_url;
    const apiKey = data.apiKey !== undefined ? data.apiKey : existing.api_key;
    const status = data.status ?? existing.status;
    const timeout = data.timeout ?? existing.timeout;

    this.conn.prepare(
      'UPDATE providers SET name = ?, base_url = ?, api_key = ?, status = ?, timeout = ?, updated_at = ? WHERE id = ?'
    ).run(name, baseUrl, apiKey ?? null, status, timeout, now, id);

    const row = this.conn.prepare('SELECT * FROM providers WHERE id = ?').get(id) as ProviderRow;
    return toProvider(row);
  }

  async deleteProvider(id: string): Promise<boolean> {
    const result = this.conn.prepare('DELETE FROM providers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ---- Models ----

  async listModels(providerId?: string): Promise<readonly Model[]> {
    let rows: ModelRow[];
    if (providerId !== undefined) {
      rows = this.conn.prepare('SELECT * FROM models WHERE provider_id = ? ORDER BY created_at ASC').all(providerId) as ModelRow[];
    } else {
      rows = this.conn.prepare('SELECT * FROM models ORDER BY created_at ASC').all() as ModelRow[];
    }
    return rows.map(toModel);
  }

  async getModel(id: string): Promise<Model | undefined> {
    const row = this.conn.prepare('SELECT * FROM models WHERE id = ?').get(id) as ModelRow | undefined;
    return row ? toModel(row) : undefined;
  }

  async createModel(data: CreateModelInput): Promise<Model> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const capabilities = JSON.stringify(data.capabilities ?? []);
    this.conn.prepare(
      'INSERT INTO models (id, provider_id, model_id, display_name, status, capabilities, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.providerId, data.modelId, data.displayName, 'active', capabilities, now);
    const row = this.conn.prepare('SELECT * FROM models WHERE id = ?').get(id) as ModelRow;
    return toModel(row);
  }

  async deleteModel(id: string): Promise<boolean> {
    const result = this.conn.prepare('DELETE FROM models WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ---- Capability assignments ----

  async listCapabilityAssignments(orgId?: string): Promise<readonly CapabilityAssignment[]> {
    let rows: CapabilityAssignmentRow[];
    if (orgId !== undefined) {
      rows = this.conn.prepare('SELECT * FROM capability_assignments WHERE org_id = ? ORDER BY priority ASC').all(orgId) as CapabilityAssignmentRow[];
    } else {
      rows = this.conn.prepare('SELECT * FROM capability_assignments ORDER BY priority ASC').all() as CapabilityAssignmentRow[];
    }
    return rows.map(toCapabilityAssignment);
  }

  async assignCapability(data: AssignCapabilityInput): Promise<CapabilityAssignment> {
    const orgId = data.orgId ?? '';
    const priority = data.priority ?? 0;
    this.conn.prepare(
      'INSERT OR REPLACE INTO capability_assignments (capability, model_id, priority, org_id) VALUES (?, ?, ?, ?)'
    ).run(data.capability, data.modelId, priority, orgId);
    const row = this.conn.prepare(
      'SELECT * FROM capability_assignments WHERE capability = ? AND model_id = ? AND org_id = ?'
    ).get(data.capability, data.modelId, orgId) as CapabilityAssignmentRow;
    return toCapabilityAssignment(row);
  }

  async unassignCapability(capability: CapabilityName, modelId: string, orgId?: string): Promise<boolean> {
    const resolvedOrgId = orgId ?? '';
    const result = this.conn.prepare(
      'DELETE FROM capability_assignments WHERE capability = ? AND model_id = ? AND org_id = ?'
    ).run(capability, modelId, resolvedOrgId);
    return result.changes > 0;
  }

  async getModelForCapability(capability: CapabilityName, orgId?: string): Promise<Model | undefined> {
    // Prefer org-scoped assignment over system (empty org_id), ordered by priority ASC
    let row: ModelRow | undefined;

    if (orgId !== undefined && orgId !== '') {
      // Try org-scoped first
      row = this.conn.prepare(`
        SELECT m.* FROM models m
        INNER JOIN capability_assignments ca ON ca.model_id = m.id
        WHERE ca.capability = ? AND ca.org_id = ?
        ORDER BY ca.priority ASC
        LIMIT 1
      `).get(capability, orgId) as ModelRow | undefined;
    }

    if (!row) {
      // Fall back to system-level (org_id = '')
      row = this.conn.prepare(`
        SELECT m.* FROM models m
        INNER JOIN capability_assignments ca ON ca.model_id = m.id
        WHERE ca.capability = ? AND ca.org_id = ''
        ORDER BY ca.priority ASC
        LIMIT 1
      `).get(capability) as ModelRow | undefined;
    }

    return row ? toModel(row) : undefined;
  }

  // ---- Prompt overrides ----

  async getPromptOverride(capability: CapabilityName, orgId?: string): Promise<PromptOverride | undefined> {
    const resolvedOrgId = orgId ?? 'system';
    const row = this.conn.prepare(
      'SELECT * FROM prompt_overrides WHERE capability = ? AND org_id = ?'
    ).get(capability, resolvedOrgId) as PromptOverrideRow | undefined;
    return row ? toPromptOverride(row) : undefined;
  }

  async setPromptOverride(capability: CapabilityName, template: string, orgId?: string): Promise<PromptOverride> {
    const resolvedOrgId = orgId ?? 'system';
    const now = new Date().toISOString();
    this.conn.prepare(
      'INSERT INTO prompt_overrides (capability, org_id, template, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(capability, org_id) DO UPDATE SET template = excluded.template, updated_at = excluded.updated_at'
    ).run(capability, resolvedOrgId, template, now, now);
    const row = this.conn.prepare(
      'SELECT * FROM prompt_overrides WHERE capability = ? AND org_id = ?'
    ).get(capability, resolvedOrgId) as PromptOverrideRow;
    return toPromptOverride(row);
  }

  async deletePromptOverride(capability: CapabilityName, orgId?: string): Promise<boolean> {
    const resolvedOrgId = orgId ?? 'system';
    const result = this.conn.prepare(
      'DELETE FROM prompt_overrides WHERE capability = ? AND org_id = ?'
    ).run(capability, resolvedOrgId);
    return result.changes > 0;
  }

  async listPromptOverrides(): Promise<readonly PromptOverride[]> {
    const rows = this.conn.prepare(
      'SELECT * FROM prompt_overrides ORDER BY capability ASC, org_id ASC'
    ).all() as PromptOverrideRow[];
    return rows.map(toPromptOverride);
  }

  // ---- getMaxCapabilityPriority ----

  async getMaxCapabilityPriority(capability: CapabilityName, orgId?: string): Promise<number> {
    const resolvedOrgId = orgId ?? 'system';
    const row = this.conn.prepare(
      'SELECT MAX(priority) as max_pri FROM capability_assignments WHERE capability = ? AND org_id = ?'
    ).get(capability, resolvedOrgId) as { max_pri: number | null } | undefined;
    return row?.max_pri ?? -1;
  }

  // ---- getModelsForCapability ----

  async getModelsForCapability(capability: CapabilityName, orgId?: string): Promise<readonly Model[]> {
    // Returns all models ordered by priority ASC, org-scoped first then system fallback
    if (orgId !== undefined && orgId !== '') {
      const rows = this.conn.prepare(`
        SELECT m.*, ca.org_id AS _scope, ca.priority AS _priority FROM models m
        INNER JOIN capability_assignments ca ON ca.model_id = m.id
        WHERE ca.capability = ? AND (ca.org_id = ? OR ca.org_id = '')
        ORDER BY (ca.org_id = ?) DESC, ca.priority ASC
      `).all(capability, orgId, orgId) as ModelRow[];
      return rows.map(toModel);
    }
    const rows = this.conn.prepare(`
      SELECT m.* FROM models m
      INNER JOIN capability_assignments ca ON ca.model_id = m.id
      WHERE ca.capability = ? AND ca.org_id = ''
      ORDER BY ca.priority ASC
    `).all(capability) as ModelRow[];
    return rows.map(toModel);
  }

  // ---- OAuth clients ----

  async getClientById(id: string): Promise<OAuthClient | undefined> {
    const row = this.conn.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(id) as OAuthClientRow | undefined;
    return row ? toClient(row) : undefined;
  }

  async createClient(data: { name: string; secretHash: string; scopes: readonly string[]; grantTypes: readonly string[]; orgId: string }): Promise<OAuthClient> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.conn.prepare(
      'INSERT INTO oauth_clients (id, name, secret_hash, scopes, grant_types, org_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.name, data.secretHash, JSON.stringify(data.scopes), JSON.stringify(data.grantTypes), data.orgId, now);
    const row = this.conn.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(id) as OAuthClientRow;
    return toClient(row);
  }

  async listClients(): Promise<readonly OAuthClient[]> {
    const rows = this.conn.prepare('SELECT * FROM oauth_clients ORDER BY created_at ASC').all() as OAuthClientRow[];
    return rows.map(toClient);
  }

  async deleteClient(id: string): Promise<boolean> {
    const result = this.conn.prepare('DELETE FROM oauth_clients WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ---- Users ----

  async getUserByUsername(username: string): Promise<User | undefined> {
    const row = this.conn.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    return row ? toUser(row) : undefined;
  }

  async createUser(data: { username: string; passwordHash: string; role: string }): Promise<User> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.conn.prepare(
      'INSERT INTO users (id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, data.username, data.passwordHash, data.role, 1, now);
    const row = this.conn.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    return toUser(row);
  }

  // ---- Usage telemetry (Phase 72-01) ----

  async recordUsage(input: RecordUsageInput): Promise<LlmUsageRecord> {
    const id = randomUUID();
    const occurredAt = new Date().toISOString();
    const totalTokens = input.promptTokens + input.completionTokens;
    const cost = computeCost(
      input.providerType,
      input.modelId,
      input.promptTokens,
      input.completionTokens,
    );
    this.conn.prepare(
      `INSERT INTO llm_usage (
        id, occurred_at, org_id, capability,
        provider_id, provider_type, model_id, model_name,
        prompt_tokens, completion_tokens, total_tokens, latency_ms,
        status, error_class, agent_conv_id, agent_msg_id,
        input_cost_usd, output_cost_usd, total_cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      occurredAt,
      input.orgId ?? null,
      input.capability,
      input.providerId,
      input.providerType,
      input.modelId,
      input.modelName,
      input.promptTokens,
      input.completionTokens,
      totalTokens,
      input.latencyMs,
      input.status,
      input.errorClass ?? null,
      input.agentConvId ?? null,
      input.agentMsgId ?? null,
      cost.input,
      cost.output,
      cost.total,
    );
    const row = this.conn.prepare('SELECT * FROM llm_usage WHERE id = ?').get(id) as UsageRow;
    return toUsage(row);
  }

  // ---- Credits (Phase 80) ----

  async getCreditBalance(orgId: string): Promise<CreditBalance> {
    const row = this.conn
      .prepare('SELECT allocated, used FROM org_credits WHERE org_id = ?')
      .get(orgId) as { allocated: number; used: number } | undefined;
    const allocated = row ? row.allocated : defaultFreeCredits();
    const used = row ? row.used : 0;
    return { orgId, allocated, used, balance: Math.max(0, allocated - used) };
  }

  private writeLedger(orgId: string, delta: number, reason: string, balanceAfter: number): void {
    this.conn
      .prepare(
        `INSERT INTO credit_ledger (id, org_id, delta, reason, balance_after, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), orgId, delta, reason, balanceAfter, new Date().toISOString());
  }

  async setCreditAllocation(orgId: string, allocated: number, updatedBy?: string): Promise<CreditBalance> {
    const safe = Math.max(0, Math.floor(allocated));
    const now = new Date().toISOString();
    this.conn
      .prepare(
        `INSERT INTO org_credits (org_id, allocated, used, updated_at, updated_by)
         VALUES (?, ?, 0, ?, ?)
         ON CONFLICT(org_id) DO UPDATE SET allocated = excluded.allocated, used = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(orgId, safe, now, updatedBy ?? null);
    this.writeLedger(orgId, safe, 'allocation', safe);
    return this.getCreditBalance(orgId);
  }

  async addCredits(orgId: string, delta: number, updatedBy?: string, reason = 'topup'): Promise<CreditBalance> {
    const current = await this.getCreditBalance(orgId);
    const allocated = Math.max(0, current.allocated + Math.floor(delta));
    const now = new Date().toISOString();
    this.conn
      .prepare(
        `INSERT INTO org_credits (org_id, allocated, used, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(org_id) DO UPDATE SET allocated = excluded.allocated, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .run(orgId, allocated, current.used, now, updatedBy ?? null);
    const after = Math.max(0, allocated - current.used);
    this.writeLedger(orgId, Math.floor(delta), reason, after);
    return this.getCreditBalance(orgId);
  }

  async consumeCredit(orgId: string, amount: number, reason: string): Promise<{ ok: boolean; balance: CreditBalance }> {
    const amt = Math.max(0, Math.floor(amount));
    const current = await this.getCreditBalance(orgId);
    if (current.balance < amt) {
      return { ok: false, balance: { ...current, balance: Math.max(0, current.balance) } };
    }
    const now = new Date().toISOString();
    const newUsed = current.used + amt;
    this.conn
      .prepare(
        `INSERT INTO org_credits (org_id, allocated, used, updated_at, updated_by)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(org_id) DO UPDATE SET allocated = excluded.allocated, used = excluded.used, updated_at = excluded.updated_at`,
      )
      .run(orgId, current.allocated, newUsed, now);
    const balanceAfter = Math.max(0, current.allocated - newUsed);
    this.writeLedger(orgId, -amt, reason, balanceAfter);
    return { ok: true, balance: await this.getCreditBalance(orgId) };
  }

  async listCreditLedger(orgId: string, limit = 50): Promise<readonly CreditLedgerEntry[]> {
    const rows = this.conn
      .prepare(
        `SELECT id, org_id, delta, reason, balance_after, occurred_at
         FROM credit_ledger WHERE org_id = ? ORDER BY occurred_at DESC, rowid DESC LIMIT ?`,
      )
      .all(orgId, limit) as Array<{
        id: string; org_id: string; delta: number; reason: string; balance_after: number; occurred_at: string;
      }>;
    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      delta: r.delta,
      reason: r.reason,
      balanceAfter: r.balance_after,
      occurredAt: r.occurred_at,
    }));
  }

  async summarizeUsage(
    filter: UsageFilter,
    groupBy: UsageGroupDimension,
  ): Promise<readonly UsageSummaryRow[]> {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.orgId !== undefined) { clauses.push('org_id = ?'); params.push(filter.orgId); }
    if (filter.capability !== undefined) { clauses.push('capability = ?'); params.push(filter.capability); }
    if (filter.from !== undefined) { clauses.push('occurred_at >= ?'); params.push(filter.from); }
    if (filter.to !== undefined) { clauses.push('occurred_at <= ?'); params.push(filter.to); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    // Phase 77 — group-by SQL. `model` aggregates by model_name so
    // an admin rename of the model row doesn't fragment history;
    // `provider` aggregates by provider_type since multiple provider
    // rows of the same type share a price. `day` substring-trims the
    // ISO timestamp to YYYY-MM-DD.
    const groupExpr: Record<UsageGroupDimension, string> = {
      capability: 'capability',
      model: 'model_name',
      provider: 'provider_type',
      org: `COALESCE(org_id, '')`,
      day: `substr(occurred_at, 1, 10)`,
    };
    const groupCol = groupExpr[groupBy];
    const rows = this.conn.prepare(
      `SELECT
         ${groupCol}                                   AS key,
         COUNT(*)                                      AS call_count,
         SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
         SUM(CASE WHEN status = 'ok' THEN 0 ELSE 1 END) AS error_count,
         SUM(prompt_tokens)                            AS prompt_tokens,
         SUM(completion_tokens)                        AS completion_tokens,
         SUM(total_tokens)                             AS total_tokens,
         SUM(COALESCE(total_cost_usd, 0))              AS total_cost_usd,
         SUM(CASE WHEN total_cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_rows,
         AVG(latency_ms)                               AS avg_latency_ms
       FROM llm_usage
       ${where}
       GROUP BY key
       ORDER BY total_cost_usd DESC, call_count DESC`,
    ).all(...params) as Array<{
      key: string | null;
      call_count: number;
      ok_count: number;
      error_count: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      total_cost_usd: number;
      unpriced_rows: number;
      avg_latency_ms: number;
    }>;
    return rows.map((r) => ({
      key: r.key === null || r.key === '' ? 'system' : r.key,
      callCount: r.call_count,
      okCount: r.ok_count,
      errorCount: r.error_count,
      promptTokens: r.prompt_tokens ?? 0,
      completionTokens: r.completion_tokens ?? 0,
      totalTokens: r.total_tokens ?? 0,
      totalCostUsd: r.total_cost_usd ?? 0,
      unpricedRows: r.unpriced_rows ?? 0,
      avgLatencyMs: Math.round(r.avg_latency_ms ?? 0),
    }));
  }

  async purgeUsageBefore(olderThanIso: string): Promise<number> {
    const result = this.conn
      .prepare('DELETE FROM llm_usage WHERE occurred_at < ?')
      .run(olderThanIso);
    return result.changes;
  }

  async listUsage(filter: UsageFilter = {}): Promise<readonly LlmUsageRecord[]> {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filter.orgId !== undefined) { clauses.push('org_id = ?'); params.push(filter.orgId); }
    if (filter.capability !== undefined) { clauses.push('capability = ?'); params.push(filter.capability); }
    if (filter.from !== undefined) { clauses.push('occurred_at >= ?'); params.push(filter.from); }
    if (filter.to !== undefined) { clauses.push('occurred_at <= ?'); params.push(filter.to); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = filter.limit !== undefined && filter.limit > 0
      ? `LIMIT ${Math.min(filter.limit, 10_000)}`
      : 'LIMIT 1000';
    const rows = this.conn.prepare(
      `SELECT * FROM llm_usage ${where} ORDER BY occurred_at DESC ${limit}`,
    ).all(...params) as UsageRow[];
    return rows.map(toUsage);
  }
}
