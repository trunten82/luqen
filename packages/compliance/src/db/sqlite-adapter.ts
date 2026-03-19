import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { hashSync, genSaltSync } from 'bcrypt';
import type { Database as DB } from 'better-sqlite3';
import type { DbAdapter } from './adapter.js';
import type {
  Jurisdiction,
  Regulation,
  Requirement,
  RequirementWithRegulation,
  UpdateProposal,
  MonitoredSource,
  OAuthClient,
  User,
  Webhook,
  JurisdictionFilters,
  RegulationFilters,
  RequirementFilters,
  CreateJurisdictionInput,
  CreateRegulationInput,
  CreateRequirementInput,
  CreateUpdateProposalInput,
  CreateSourceInput,
  CreateClientInput,
  CreateUserInput,
  CreateWebhookInput,
} from '../types.js';

// Raw row types returned from SQLite (all fields are primitives)
interface JurisdictionRow {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  iso3166: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RegulationRow {
  id: string;
  jurisdictionId: string;
  name: string;
  shortName: string;
  reference: string;
  url: string;
  enforcementDate: string;
  status: string;
  scope: string;
  sectors: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface RequirementRow {
  id: string;
  regulationId: string;
  wcagVersion: string;
  wcagLevel: string;
  wcagCriterion: string;
  obligation: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RequirementWithRegulationRow extends RequirementRow {
  regulationName: string;
  regulationShortName: string;
  jurisdictionId: string;
  enforcementDate: string;
}

interface UpdateProposalRow {
  id: string;
  source: string;
  detectedAt: string;
  type: string;
  affectedRegulationId: string | null;
  affectedJurisdictionId: string | null;
  summary: string;
  proposedChanges: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface MonitoredSourceRow {
  id: string;
  name: string;
  url: string;
  type: string;
  schedule: string;
  lastCheckedAt: string | null;
  lastContentHash: string | null;
  createdAt: string;
}

interface OAuthClientRow {
  id: string;
  name: string;
  secretHash: string;
  scopes: string;
  grantTypes: string;
  redirectUris: string | null;
  createdAt: string;
}

interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  role: string;
  createdAt: string;
}

interface WebhookRow {
  id: string;
  url: string;
  secret: string;
  events: string;
  active: number;
  createdAt: string;
}

function toJurisdiction(row: JurisdictionRow): Jurisdiction {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Jurisdiction['type'],
    ...(row.parentId != null ? { parentId: row.parentId } : {}),
    ...(row.iso3166 != null ? { iso3166: row.iso3166 } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRegulation(row: RegulationRow): Regulation {
  return {
    id: row.id,
    jurisdictionId: row.jurisdictionId,
    name: row.name,
    shortName: row.shortName,
    reference: row.reference,
    url: row.url,
    enforcementDate: row.enforcementDate,
    status: row.status as Regulation['status'],
    scope: row.scope as Regulation['scope'],
    sectors: JSON.parse(row.sectors) as string[],
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRequirement(row: RequirementRow): Requirement {
  return {
    id: row.id,
    regulationId: row.regulationId,
    wcagVersion: row.wcagVersion as Requirement['wcagVersion'],
    wcagLevel: row.wcagLevel as Requirement['wcagLevel'],
    wcagCriterion: row.wcagCriterion,
    obligation: row.obligation as Requirement['obligation'],
    ...(row.notes != null ? { notes: row.notes } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRequirementWithRegulation(row: RequirementWithRegulationRow): RequirementWithRegulation {
  return {
    ...toRequirement(row),
    regulationName: row.regulationName,
    regulationShortName: row.regulationShortName,
    jurisdictionId: row.jurisdictionId,
    enforcementDate: row.enforcementDate,
  };
}

function toUpdateProposal(row: UpdateProposalRow): UpdateProposal {
  return {
    id: row.id,
    source: row.source,
    detectedAt: row.detectedAt,
    type: row.type as UpdateProposal['type'],
    ...(row.affectedRegulationId != null ? { affectedRegulationId: row.affectedRegulationId } : {}),
    ...(row.affectedJurisdictionId != null ? { affectedJurisdictionId: row.affectedJurisdictionId } : {}),
    summary: row.summary,
    proposedChanges: JSON.parse(row.proposedChanges) as UpdateProposal['proposedChanges'],
    status: row.status as UpdateProposal['status'],
    ...(row.reviewedBy != null ? { reviewedBy: row.reviewedBy } : {}),
    ...(row.reviewedAt != null ? { reviewedAt: row.reviewedAt } : {}),
    createdAt: row.createdAt,
  };
}

function toMonitoredSource(row: MonitoredSourceRow): MonitoredSource {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    type: row.type as MonitoredSource['type'],
    schedule: row.schedule as MonitoredSource['schedule'],
    ...(row.lastCheckedAt != null ? { lastCheckedAt: row.lastCheckedAt } : {}),
    ...(row.lastContentHash != null ? { lastContentHash: row.lastContentHash } : {}),
    createdAt: row.createdAt,
  };
}

function toOAuthClient(row: OAuthClientRow): OAuthClient {
  return {
    id: row.id,
    name: row.name,
    secretHash: row.secretHash,
    scopes: JSON.parse(row.scopes) as string[],
    grantTypes: JSON.parse(row.grantTypes) as OAuthClient['grantTypes'],
    ...(row.redirectUris != null ? { redirectUris: JSON.parse(row.redirectUris) as string[] } : {}),
    createdAt: row.createdAt,
  };
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    role: row.role as User['role'],
    createdAt: row.createdAt,
  };
}

function toWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    url: row.url,
    secret: row.secret,
    events: JSON.parse(row.events) as string[],
    active: row.active === 1,
    createdAt: row.createdAt,
  };
}

export class SqliteAdapter implements DbAdapter {
  private db!: DB;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.createTables();
  }

  async close(): Promise<void> {
    this.db.close();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jurisdictions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        parentId TEXT REFERENCES jurisdictions(id),
        iso3166 TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS regulations (
        id TEXT PRIMARY KEY,
        jurisdictionId TEXT NOT NULL REFERENCES jurisdictions(id),
        name TEXT NOT NULL,
        shortName TEXT NOT NULL,
        reference TEXT NOT NULL,
        url TEXT NOT NULL,
        enforcementDate TEXT NOT NULL,
        status TEXT NOT NULL,
        scope TEXT NOT NULL,
        sectors TEXT NOT NULL DEFAULT '[]',
        description TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS requirements (
        id TEXT PRIMARY KEY,
        regulationId TEXT NOT NULL REFERENCES regulations(id),
        wcagVersion TEXT NOT NULL,
        wcagLevel TEXT NOT NULL,
        wcagCriterion TEXT NOT NULL,
        obligation TEXT NOT NULL,
        notes TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS update_proposals (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        detectedAt TEXT NOT NULL,
        type TEXT NOT NULL,
        affectedRegulationId TEXT,
        affectedJurisdictionId TEXT,
        summary TEXT NOT NULL,
        proposedChanges TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewedBy TEXT,
        reviewedAt TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS monitored_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        type TEXT NOT NULL,
        schedule TEXT NOT NULL,
        lastCheckedAt TEXT,
        lastContentHash TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        secretHash TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]',
        grantTypes TEXT NOT NULL DEFAULT '[]',
        redirectUris TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL
      );
    `);
  }

  // --- Jurisdictions ---

  async listJurisdictions(filters?: JurisdictionFilters): Promise<Jurisdiction[]> {
    let sql = 'SELECT * FROM jurisdictions WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.type != null) {
      sql += ' AND type = ?';
      params.push(filters.type);
    }
    if (filters?.parentId != null) {
      sql += ' AND parentId = ?';
      params.push(filters.parentId);
    }

    const rows = this.db.prepare(sql).all(...params) as JurisdictionRow[];
    return rows.map(toJurisdiction);
  }

  async getJurisdiction(id: string): Promise<Jurisdiction | null> {
    const row = this.db.prepare('SELECT * FROM jurisdictions WHERE id = ?').get(id) as JurisdictionRow | undefined;
    return row != null ? toJurisdiction(row) : null;
  }

  async createJurisdiction(data: CreateJurisdictionInput): Promise<Jurisdiction> {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO jurisdictions (id, name, type, parentId, iso3166, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(data.id, data.name, data.type, data.parentId ?? null, data.iso3166 ?? null, now, now);
    const row = this.db.prepare('SELECT * FROM jurisdictions WHERE id = ?').get(data.id) as JurisdictionRow;
    return toJurisdiction(row);
  }

  async updateJurisdiction(id: string, data: Partial<CreateJurisdictionInput>): Promise<Jurisdiction> {
    const now = new Date().toISOString();
    const fields: string[] = [];
    const params: unknown[] = [];

    if (data.name != null) { fields.push('name = ?'); params.push(data.name); }
    if (data.type != null) { fields.push('type = ?'); params.push(data.type); }
    if ('parentId' in data) { fields.push('parentId = ?'); params.push(data.parentId ?? null); }
    if ('iso3166' in data) { fields.push('iso3166 = ?'); params.push(data.iso3166 ?? null); }
    fields.push('updatedAt = ?');
    params.push(now);
    params.push(id);

    this.db.prepare(`UPDATE jurisdictions SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const row = this.db.prepare('SELECT * FROM jurisdictions WHERE id = ?').get(id) as JurisdictionRow;
    return toJurisdiction(row);
  }

  async deleteJurisdiction(id: string): Promise<void> {
    this.db.prepare('DELETE FROM jurisdictions WHERE id = ?').run(id);
  }

  // --- Regulations ---

  async listRegulations(filters?: RegulationFilters): Promise<Regulation[]> {
    let sql = 'SELECT * FROM regulations WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.jurisdictionId != null) {
      sql += ' AND jurisdictionId = ?';
      params.push(filters.jurisdictionId);
    }
    if (filters?.status != null) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.scope != null) {
      sql += ' AND scope = ?';
      params.push(filters.scope);
    }

    const rows = this.db.prepare(sql).all(...params) as RegulationRow[];
    return rows.map(toRegulation);
  }

  async getRegulation(id: string): Promise<Regulation | null> {
    const row = this.db.prepare('SELECT * FROM regulations WHERE id = ?').get(id) as RegulationRow | undefined;
    return row != null ? toRegulation(row) : null;
  }

  async createRegulation(data: CreateRegulationInput): Promise<Regulation> {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO regulations (id, jurisdictionId, name, shortName, reference, url, enforcementDate, status, scope, sectors, description, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      data.jurisdictionId,
      data.name,
      data.shortName,
      data.reference,
      data.url,
      data.enforcementDate,
      data.status,
      data.scope,
      JSON.stringify(data.sectors),
      data.description,
      now,
      now,
    );
    const row = this.db.prepare('SELECT * FROM regulations WHERE id = ?').get(data.id) as RegulationRow;
    return toRegulation(row);
  }

  async updateRegulation(id: string, data: Partial<CreateRegulationInput>): Promise<Regulation> {
    const now = new Date().toISOString();
    const fields: string[] = [];
    const params: unknown[] = [];

    if (data.name != null) { fields.push('name = ?'); params.push(data.name); }
    if (data.jurisdictionId != null) { fields.push('jurisdictionId = ?'); params.push(data.jurisdictionId); }
    if (data.shortName != null) { fields.push('shortName = ?'); params.push(data.shortName); }
    if (data.reference != null) { fields.push('reference = ?'); params.push(data.reference); }
    if (data.url != null) { fields.push('url = ?'); params.push(data.url); }
    if (data.enforcementDate != null) { fields.push('enforcementDate = ?'); params.push(data.enforcementDate); }
    if (data.status != null) { fields.push('status = ?'); params.push(data.status); }
    if (data.scope != null) { fields.push('scope = ?'); params.push(data.scope); }
    if (data.sectors != null) { fields.push('sectors = ?'); params.push(JSON.stringify(data.sectors)); }
    if (data.description != null) { fields.push('description = ?'); params.push(data.description); }
    fields.push('updatedAt = ?');
    params.push(now);
    params.push(id);

    this.db.prepare(`UPDATE regulations SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const row = this.db.prepare('SELECT * FROM regulations WHERE id = ?').get(id) as RegulationRow;
    return toRegulation(row);
  }

  async deleteRegulation(id: string): Promise<void> {
    this.db.prepare('DELETE FROM regulations WHERE id = ?').run(id);
  }

  // --- Requirements ---

  async listRequirements(filters?: RequirementFilters): Promise<Requirement[]> {
    let sql = 'SELECT * FROM requirements WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.regulationId != null) {
      sql += ' AND regulationId = ?';
      params.push(filters.regulationId);
    }
    if (filters?.wcagCriterion != null) {
      sql += ' AND wcagCriterion = ?';
      params.push(filters.wcagCriterion);
    }
    if (filters?.obligation != null) {
      sql += ' AND obligation = ?';
      params.push(filters.obligation);
    }

    const rows = this.db.prepare(sql).all(...params) as RequirementRow[];
    return rows.map(toRequirement);
  }

  async getRequirement(id: string): Promise<Requirement | null> {
    const row = this.db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as RequirementRow | undefined;
    return row != null ? toRequirement(row) : null;
  }

  async createRequirement(data: CreateRequirementInput): Promise<Requirement> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO requirements (id, regulationId, wcagVersion, wcagLevel, wcagCriterion, obligation, notes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.regulationId, data.wcagVersion, data.wcagLevel, data.wcagCriterion, data.obligation, data.notes ?? null, now, now);
    const row = this.db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as RequirementRow;
    return toRequirement(row);
  }

  async updateRequirement(id: string, data: Partial<CreateRequirementInput>): Promise<Requirement> {
    const now = new Date().toISOString();
    const fields: string[] = [];
    const params: unknown[] = [];

    if (data.regulationId != null) { fields.push('regulationId = ?'); params.push(data.regulationId); }
    if (data.wcagVersion != null) { fields.push('wcagVersion = ?'); params.push(data.wcagVersion); }
    if (data.wcagLevel != null) { fields.push('wcagLevel = ?'); params.push(data.wcagLevel); }
    if (data.wcagCriterion != null) { fields.push('wcagCriterion = ?'); params.push(data.wcagCriterion); }
    if (data.obligation != null) { fields.push('obligation = ?'); params.push(data.obligation); }
    if ('notes' in data) { fields.push('notes = ?'); params.push(data.notes ?? null); }
    fields.push('updatedAt = ?');
    params.push(now);
    params.push(id);

    this.db.prepare(`UPDATE requirements SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const row = this.db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as RequirementRow;
    return toRequirement(row);
  }

  async deleteRequirement(id: string): Promise<void> {
    this.db.prepare('DELETE FROM requirements WHERE id = ?').run(id);
  }

  async bulkCreateRequirements(data: readonly CreateRequirementInput[]): Promise<Requirement[]> {
    const results: Requirement[] = [];
    const insertMany = this.db.transaction((items: readonly CreateRequirementInput[]) => {
      for (const item of items) {
        const id = randomUUID();
        const now = new Date().toISOString();
        this.db.prepare(`
          INSERT INTO requirements (id, regulationId, wcagVersion, wcagLevel, wcagCriterion, obligation, notes, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, item.regulationId, item.wcagVersion, item.wcagLevel, item.wcagCriterion, item.obligation, item.notes ?? null, now, now);
        const row = this.db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as RequirementRow;
        results.push(toRequirement(row));
      }
    });
    insertMany(data);
    return results;
  }

  async findRequirementsByCriteria(
    jurisdictionIds: readonly string[],
    wcagCriteria: readonly string[],
  ): Promise<RequirementWithRegulation[]> {
    if (jurisdictionIds.length === 0 || wcagCriteria.length === 0) {
      return [];
    }

    const jPlaceholders = jurisdictionIds.map(() => '?').join(', ');
    const cPlaceholders = wcagCriteria.map(() => '?').join(', ');

    // Match exact criteria OR wildcard '*'
    const sql = `
      SELECT
        req.id, req.regulationId, req.wcagVersion, req.wcagLevel,
        req.wcagCriterion, req.obligation, req.notes, req.createdAt, req.updatedAt,
        reg.name AS regulationName, reg.shortName AS regulationShortName,
        reg.jurisdictionId, reg.enforcementDate
      FROM requirements req
      JOIN regulations reg ON req.regulationId = reg.id
      WHERE reg.jurisdictionId IN (${jPlaceholders})
        AND (req.wcagCriterion IN (${cPlaceholders}) OR req.wcagCriterion = '*')
    `;

    const params: unknown[] = [...jurisdictionIds, ...wcagCriteria];
    const rows = this.db.prepare(sql).all(...params) as RequirementWithRegulationRow[];
    return rows.map(toRequirementWithRegulation);
  }

  // --- Update Proposals ---

  async listUpdateProposals(filters?: { status?: string }): Promise<UpdateProposal[]> {
    let sql = 'SELECT * FROM update_proposals WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.status != null) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    const rows = this.db.prepare(sql).all(...params) as UpdateProposalRow[];
    return rows.map(toUpdateProposal);
  }

  async getUpdateProposal(id: string): Promise<UpdateProposal | null> {
    const row = this.db.prepare('SELECT * FROM update_proposals WHERE id = ?').get(id) as UpdateProposalRow | undefined;
    return row != null ? toUpdateProposal(row) : null;
  }

  async createUpdateProposal(data: CreateUpdateProposalInput): Promise<UpdateProposal> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO update_proposals (id, source, detectedAt, type, affectedRegulationId, affectedJurisdictionId, summary, proposedChanges, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      id,
      data.source,
      now,
      data.type,
      data.affectedRegulationId ?? null,
      data.affectedJurisdictionId ?? null,
      data.summary,
      JSON.stringify(data.proposedChanges),
      now,
    );
    const row = this.db.prepare('SELECT * FROM update_proposals WHERE id = ?').get(id) as UpdateProposalRow;
    return toUpdateProposal(row);
  }

  async updateUpdateProposal(id: string, data: Partial<UpdateProposal>): Promise<UpdateProposal> {
    const fields: string[] = [];
    const params: unknown[] = [];

    if (data.status != null) { fields.push('status = ?'); params.push(data.status); }
    if (data.reviewedBy != null) { fields.push('reviewedBy = ?'); params.push(data.reviewedBy); }
    if (data.reviewedAt != null) { fields.push('reviewedAt = ?'); params.push(data.reviewedAt); }
    if (data.summary != null) { fields.push('summary = ?'); params.push(data.summary); }
    if (data.proposedChanges != null) { fields.push('proposedChanges = ?'); params.push(JSON.stringify(data.proposedChanges)); }
    params.push(id);

    this.db.prepare(`UPDATE update_proposals SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    const row = this.db.prepare('SELECT * FROM update_proposals WHERE id = ?').get(id) as UpdateProposalRow;
    return toUpdateProposal(row);
  }

  // --- Monitored Sources ---

  async listSources(): Promise<MonitoredSource[]> {
    const rows = this.db.prepare('SELECT * FROM monitored_sources').all() as MonitoredSourceRow[];
    return rows.map(toMonitoredSource);
  }

  async createSource(data: CreateSourceInput): Promise<MonitoredSource> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO monitored_sources (id, name, url, type, schedule, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.url, data.type, data.schedule, now);
    const row = this.db.prepare('SELECT * FROM monitored_sources WHERE id = ?').get(id) as MonitoredSourceRow;
    return toMonitoredSource(row);
  }

  async deleteSource(id: string): Promise<void> {
    this.db.prepare('DELETE FROM monitored_sources WHERE id = ?').run(id);
  }

  async updateSourceLastChecked(id: string, contentHash: string): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(
      'UPDATE monitored_sources SET lastCheckedAt = ?, lastContentHash = ? WHERE id = ?',
    ).run(now, contentHash, id);
  }

  // --- OAuth Clients ---

  async getClientById(clientId: string): Promise<OAuthClient | null> {
    const row = this.db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(clientId) as OAuthClientRow | undefined;
    return row != null ? toOAuthClient(row) : null;
  }

  async createClient(data: CreateClientInput): Promise<OAuthClient & { secret: string }> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const secret = randomUUID();
    const salt = genSaltSync(10);
    const secretHash = hashSync(secret, salt);

    this.db.prepare(`
      INSERT INTO oauth_clients (id, name, secretHash, scopes, grantTypes, redirectUris, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.name,
      secretHash,
      JSON.stringify(data.scopes),
      JSON.stringify(data.grantTypes),
      data.redirectUris != null ? JSON.stringify(data.redirectUris) : null,
      now,
    );
    const row = this.db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(id) as OAuthClientRow;
    return { ...toOAuthClient(row), secret };
  }

  async listClients(): Promise<OAuthClient[]> {
    const rows = this.db.prepare('SELECT * FROM oauth_clients').all() as OAuthClientRow[];
    return rows.map(toOAuthClient);
  }

  async deleteClient(id: string): Promise<void> {
    this.db.prepare('DELETE FROM oauth_clients WHERE id = ?').run(id);
  }

  // --- Users ---

  async getUserByUsername(username: string): Promise<User | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    return row != null ? toUser(row) : null;
  }

  async createUser(data: CreateUserInput): Promise<User> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const salt = genSaltSync(10);
    const passwordHash = hashSync(data.password, salt);

    this.db.prepare(`
      INSERT INTO users (id, username, passwordHash, role, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, data.username, passwordHash, data.role, now);
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    return toUser(row);
  }

  // --- Webhooks ---

  async listWebhooks(): Promise<Webhook[]> {
    const rows = this.db.prepare('SELECT * FROM webhooks').all() as WebhookRow[];
    return rows.map(toWebhook);
  }

  async createWebhook(data: CreateWebhookInput): Promise<Webhook> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO webhooks (id, url, secret, events, active, createdAt)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(id, data.url, data.secret, JSON.stringify(data.events), now);
    const row = this.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as WebhookRow;
    return toWebhook(row);
  }

  async deleteWebhook(id: string): Promise<void> {
    this.db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
  }
}
