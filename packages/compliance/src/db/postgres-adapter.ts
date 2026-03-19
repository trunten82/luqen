import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { hashSync, genSaltSync } from 'bcrypt';
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

// ---------------------------------------------------------------------------
// Row → domain type mappers
// ---------------------------------------------------------------------------

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
  sectors: string[];   // TEXT[] from pg driver
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
  proposedChanges: unknown; // JSONB
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
  scopes: string[];     // TEXT[]
  grantTypes: string[]; // TEXT[]
  redirectUris: string[] | null; // TEXT[]
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
  events: string[]; // TEXT[]
  active: boolean;
  createdAt: string;
}

// Lowercase column aliases returned by pg (column names in SQL are lowercased)
function rowToJurisdiction(row: Record<string, unknown>): Jurisdiction {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    type: row['type'] as Jurisdiction['type'],
    ...(row['parentid'] != null ? { parentId: row['parentid'] as string } : {}),
    ...(row['iso3166'] != null ? { iso3166: row['iso3166'] as string } : {}),
    createdAt: row['createdat'] as string,
    updatedAt: row['updatedat'] as string,
  };
}

function rowToRegulation(row: Record<string, unknown>): Regulation {
  return {
    id: row['id'] as string,
    jurisdictionId: row['jurisdictionid'] as string,
    name: row['name'] as string,
    shortName: row['shortname'] as string,
    reference: row['reference'] as string,
    url: row['url'] as string,
    enforcementDate: row['enforcementdate'] as string,
    status: row['status'] as Regulation['status'],
    scope: row['scope'] as Regulation['scope'],
    sectors: row['sectors'] as string[],
    description: row['description'] as string,
    createdAt: row['createdat'] as string,
    updatedAt: row['updatedat'] as string,
  };
}

function rowToRequirement(row: Record<string, unknown>): Requirement {
  return {
    id: row['id'] as string,
    regulationId: row['regulationid'] as string,
    wcagVersion: row['wcagversion'] as Requirement['wcagVersion'],
    wcagLevel: row['wcaglevel'] as Requirement['wcagLevel'],
    wcagCriterion: row['wcagcriterion'] as string,
    obligation: row['obligation'] as Requirement['obligation'],
    ...(row['notes'] != null ? { notes: row['notes'] as string } : {}),
    createdAt: row['createdat'] as string,
    updatedAt: row['updatedat'] as string,
  };
}

function rowToRequirementWithRegulation(row: Record<string, unknown>): RequirementWithRegulation {
  return {
    ...rowToRequirement(row),
    regulationName: row['regulationname'] as string,
    regulationShortName: row['regulationshortname'] as string,
    jurisdictionId: row['jurisdictionid'] as string,
    enforcementDate: row['enforcementdate'] as string,
  };
}

function rowToUpdateProposal(row: Record<string, unknown>): UpdateProposal {
  return {
    id: row['id'] as string,
    source: row['source'] as string,
    detectedAt: row['detectedat'] as string,
    type: row['type'] as UpdateProposal['type'],
    ...(row['affectedregulationid'] != null ? { affectedRegulationId: row['affectedregulationid'] as string } : {}),
    ...(row['affectedjurisdictionid'] != null ? { affectedJurisdictionId: row['affectedjurisdictionid'] as string } : {}),
    summary: row['summary'] as string,
    proposedChanges: row['proposedchanges'] as UpdateProposal['proposedChanges'],
    status: row['status'] as UpdateProposal['status'],
    ...(row['reviewedby'] != null ? { reviewedBy: row['reviewedby'] as string } : {}),
    ...(row['reviewedat'] != null ? { reviewedAt: row['reviewedat'] as string } : {}),
    createdAt: row['createdat'] as string,
  };
}

function rowToMonitoredSource(row: Record<string, unknown>): MonitoredSource {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    url: row['url'] as string,
    type: row['type'] as MonitoredSource['type'],
    schedule: row['schedule'] as MonitoredSource['schedule'],
    ...(row['lastcheckedat'] != null ? { lastCheckedAt: row['lastcheckedat'] as string } : {}),
    ...(row['lastcontenthash'] != null ? { lastContentHash: row['lastcontenthash'] as string } : {}),
    createdAt: row['createdat'] as string,
  };
}

function rowToOAuthClient(row: Record<string, unknown>): OAuthClient {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    secretHash: row['secrethash'] as string,
    scopes: row['scopes'] as string[],
    grantTypes: row['granttypes'] as OAuthClient['grantTypes'],
    ...(row['redirecturis'] != null ? { redirectUris: row['redirecturis'] as string[] } : {}),
    createdAt: row['createdat'] as string,
  };
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row['id'] as string,
    username: row['username'] as string,
    passwordHash: row['passwordhash'] as string,
    role: row['role'] as User['role'],
    createdAt: row['createdat'] as string,
  };
}

function rowToWebhook(row: Record<string, unknown>): Webhook {
  return {
    id: row['id'] as string,
    url: row['url'] as string,
    secret: row['secret'] as string,
    events: row['events'] as string[],
    active: row['active'] as boolean,
    createdAt: row['createdat'] as string,
  };
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class PostgresAdapter implements DbAdapter {
  private pool!: Pool;
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async initialize(): Promise<void> {
    this.pool = new Pool({ connectionString: this.connectionString });
    // Verify connectivity
    const client = await this.pool.connect();
    try {
      await this.createTables(client);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async createTables(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS jurisdictions (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL,
        parentId    TEXT,
        iso3166     TEXT,
        createdAt   TEXT NOT NULL,
        updatedAt   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS regulations (
        id               TEXT PRIMARY KEY,
        jurisdictionId   TEXT NOT NULL,
        name             TEXT NOT NULL,
        shortName        TEXT NOT NULL,
        reference        TEXT NOT NULL,
        url              TEXT NOT NULL,
        enforcementDate  TEXT NOT NULL,
        status           TEXT NOT NULL,
        scope            TEXT NOT NULL,
        sectors          TEXT[] NOT NULL DEFAULT '{}',
        description      TEXT NOT NULL,
        createdAt        TEXT NOT NULL,
        updatedAt        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS requirements (
        id              TEXT PRIMARY KEY,
        regulationId    TEXT NOT NULL,
        wcagVersion     TEXT NOT NULL,
        wcagLevel       TEXT NOT NULL,
        wcagCriterion   TEXT NOT NULL,
        obligation      TEXT NOT NULL,
        notes           TEXT,
        createdAt       TEXT NOT NULL,
        updatedAt       TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS update_proposals (
        id                       TEXT PRIMARY KEY,
        source                   TEXT NOT NULL,
        detectedAt               TEXT NOT NULL,
        type                     TEXT NOT NULL,
        affectedRegulationId     TEXT,
        affectedJurisdictionId   TEXT,
        summary                  TEXT NOT NULL,
        proposedChanges          JSONB NOT NULL,
        status                   TEXT NOT NULL DEFAULT 'pending',
        reviewedBy               TEXT,
        reviewedAt               TEXT,
        createdAt                TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS monitored_sources (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        url              TEXT NOT NULL,
        type             TEXT NOT NULL,
        schedule         TEXT NOT NULL,
        lastCheckedAt    TEXT,
        lastContentHash  TEXT,
        createdAt        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_clients (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        secretHash   TEXT NOT NULL,
        scopes       TEXT[] NOT NULL DEFAULT '{}',
        grantTypes   TEXT[] NOT NULL DEFAULT '{}',
        redirectUris TEXT[],
        createdAt    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id           TEXT PRIMARY KEY,
        username     TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        role         TEXT NOT NULL,
        createdAt    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhooks (
        id        TEXT PRIMARY KEY,
        url       TEXT NOT NULL,
        secret    TEXT NOT NULL,
        events    TEXT[] NOT NULL DEFAULT '{}',
        active    BOOLEAN NOT NULL DEFAULT TRUE,
        createdAt TEXT NOT NULL
      );
    `);
  }

  // -------------------------------------------------------------------------
  // Jurisdictions
  // -------------------------------------------------------------------------

  async listJurisdictions(filters?: JurisdictionFilters): Promise<Jurisdiction[]> {
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let idx = 1;

    if (filters?.type != null) {
      conditions.push(`type = $${idx++}`);
      params.push(filters.type);
    }
    if (filters?.parentId != null) {
      conditions.push(`parentId = $${idx++}`);
      params.push(filters.parentId);
    }

    const sql = `SELECT * FROM jurisdictions WHERE ${conditions.join(' AND ')}`;
    const result = await this.pool.query(sql, params);
    return result.rows.map(rowToJurisdiction);
  }

  async getJurisdiction(id: string): Promise<Jurisdiction | null> {
    const result = await this.pool.query('SELECT * FROM jurisdictions WHERE id = $1', [id]);
    return result.rows.length > 0 ? rowToJurisdiction(result.rows[0]) : null;
  }

  async createJurisdiction(data: CreateJurisdictionInput): Promise<Jurisdiction> {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO jurisdictions (id, name, type, parentId, iso3166, createdAt, updatedAt)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [data.id, data.name, data.type, data.parentId ?? null, data.iso3166 ?? null, now, now],
    );
    const result = await this.pool.query('SELECT * FROM jurisdictions WHERE id = $1', [data.id]);
    return rowToJurisdiction(result.rows[0]);
  }

  async updateJurisdiction(id: string, data: Partial<CreateJurisdictionInput>): Promise<Jurisdiction> {
    const now = new Date().toISOString();
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.name != null) { sets.push(`name = $${idx++}`); params.push(data.name); }
    if (data.type != null) { sets.push(`type = $${idx++}`); params.push(data.type); }
    if ('parentId' in data) { sets.push(`parentId = $${idx++}`); params.push(data.parentId ?? null); }
    if ('iso3166' in data) { sets.push(`iso3166 = $${idx++}`); params.push(data.iso3166 ?? null); }
    sets.push(`updatedAt = $${idx++}`);
    params.push(now);
    params.push(id);

    await this.pool.query(
      `UPDATE jurisdictions SET ${sets.join(', ')} WHERE id = $${idx}`,
      params,
    );
    const result = await this.pool.query('SELECT * FROM jurisdictions WHERE id = $1', [id]);
    return rowToJurisdiction(result.rows[0]);
  }

  async deleteJurisdiction(id: string): Promise<void> {
    await this.pool.query('DELETE FROM jurisdictions WHERE id = $1', [id]);
  }

  // -------------------------------------------------------------------------
  // Regulations
  // -------------------------------------------------------------------------

  async listRegulations(filters?: RegulationFilters): Promise<Regulation[]> {
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let idx = 1;

    if (filters?.jurisdictionId != null) {
      conditions.push(`jurisdictionId = $${idx++}`);
      params.push(filters.jurisdictionId);
    }
    if (filters?.status != null) {
      conditions.push(`status = $${idx++}`);
      params.push(filters.status);
    }
    if (filters?.scope != null) {
      conditions.push(`scope = $${idx++}`);
      params.push(filters.scope);
    }

    const sql = `SELECT * FROM regulations WHERE ${conditions.join(' AND ')}`;
    const result = await this.pool.query(sql, params);
    return result.rows.map(rowToRegulation);
  }

  async getRegulation(id: string): Promise<Regulation | null> {
    const result = await this.pool.query('SELECT * FROM regulations WHERE id = $1', [id]);
    return result.rows.length > 0 ? rowToRegulation(result.rows[0]) : null;
  }

  async createRegulation(data: CreateRegulationInput): Promise<Regulation> {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO regulations
         (id, jurisdictionId, name, shortName, reference, url, enforcementDate,
          status, scope, sectors, description, createdAt, updatedAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        data.id, data.jurisdictionId, data.name, data.shortName, data.reference,
        data.url, data.enforcementDate, data.status, data.scope,
        data.sectors, data.description, now, now,
      ],
    );
    const result = await this.pool.query('SELECT * FROM regulations WHERE id = $1', [data.id]);
    return rowToRegulation(result.rows[0]);
  }

  async updateRegulation(id: string, data: Partial<CreateRegulationInput>): Promise<Regulation> {
    const now = new Date().toISOString();
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.name != null) { sets.push(`name = $${idx++}`); params.push(data.name); }
    if (data.jurisdictionId != null) { sets.push(`jurisdictionId = $${idx++}`); params.push(data.jurisdictionId); }
    if (data.shortName != null) { sets.push(`shortName = $${idx++}`); params.push(data.shortName); }
    if (data.reference != null) { sets.push(`reference = $${idx++}`); params.push(data.reference); }
    if (data.url != null) { sets.push(`url = $${idx++}`); params.push(data.url); }
    if (data.enforcementDate != null) { sets.push(`enforcementDate = $${idx++}`); params.push(data.enforcementDate); }
    if (data.status != null) { sets.push(`status = $${idx++}`); params.push(data.status); }
    if (data.scope != null) { sets.push(`scope = $${idx++}`); params.push(data.scope); }
    if (data.sectors != null) { sets.push(`sectors = $${idx++}`); params.push(data.sectors); }
    if (data.description != null) { sets.push(`description = $${idx++}`); params.push(data.description); }
    sets.push(`updatedAt = $${idx++}`);
    params.push(now);
    params.push(id);

    await this.pool.query(
      `UPDATE regulations SET ${sets.join(', ')} WHERE id = $${idx}`,
      params,
    );
    const result = await this.pool.query('SELECT * FROM regulations WHERE id = $1', [id]);
    return rowToRegulation(result.rows[0]);
  }

  async deleteRegulation(id: string): Promise<void> {
    await this.pool.query('DELETE FROM regulations WHERE id = $1', [id]);
  }

  // -------------------------------------------------------------------------
  // Requirements
  // -------------------------------------------------------------------------

  async listRequirements(filters?: RequirementFilters): Promise<Requirement[]> {
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let idx = 1;

    if (filters?.regulationId != null) {
      conditions.push(`regulationId = $${idx++}`);
      params.push(filters.regulationId);
    }
    if (filters?.wcagCriterion != null) {
      conditions.push(`wcagCriterion = $${idx++}`);
      params.push(filters.wcagCriterion);
    }
    if (filters?.obligation != null) {
      conditions.push(`obligation = $${idx++}`);
      params.push(filters.obligation);
    }

    const sql = `SELECT * FROM requirements WHERE ${conditions.join(' AND ')}`;
    const result = await this.pool.query(sql, params);
    return result.rows.map(rowToRequirement);
  }

  async getRequirement(id: string): Promise<Requirement | null> {
    const result = await this.pool.query('SELECT * FROM requirements WHERE id = $1', [id]);
    return result.rows.length > 0 ? rowToRequirement(result.rows[0]) : null;
  }

  async createRequirement(data: CreateRequirementInput): Promise<Requirement> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO requirements
         (id, regulationId, wcagVersion, wcagLevel, wcagCriterion, obligation, notes, createdAt, updatedAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, data.regulationId, data.wcagVersion, data.wcagLevel, data.wcagCriterion,
       data.obligation, data.notes ?? null, now, now],
    );
    const result = await this.pool.query('SELECT * FROM requirements WHERE id = $1', [id]);
    return rowToRequirement(result.rows[0]);
  }

  async updateRequirement(id: string, data: Partial<CreateRequirementInput>): Promise<Requirement> {
    const now = new Date().toISOString();
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.regulationId != null) { sets.push(`regulationId = $${idx++}`); params.push(data.regulationId); }
    if (data.wcagVersion != null) { sets.push(`wcagVersion = $${idx++}`); params.push(data.wcagVersion); }
    if (data.wcagLevel != null) { sets.push(`wcagLevel = $${idx++}`); params.push(data.wcagLevel); }
    if (data.wcagCriterion != null) { sets.push(`wcagCriterion = $${idx++}`); params.push(data.wcagCriterion); }
    if (data.obligation != null) { sets.push(`obligation = $${idx++}`); params.push(data.obligation); }
    if ('notes' in data) { sets.push(`notes = $${idx++}`); params.push(data.notes ?? null); }
    sets.push(`updatedAt = $${idx++}`);
    params.push(now);
    params.push(id);

    await this.pool.query(
      `UPDATE requirements SET ${sets.join(', ')} WHERE id = $${idx}`,
      params,
    );
    const result = await this.pool.query('SELECT * FROM requirements WHERE id = $1', [id]);
    return rowToRequirement(result.rows[0]);
  }

  async deleteRequirement(id: string): Promise<void> {
    await this.pool.query('DELETE FROM requirements WHERE id = $1', [id]);
  }

  async bulkCreateRequirements(data: readonly CreateRequirementInput[]): Promise<Requirement[]> {
    if (data.length === 0) return [];
    const results: Requirement[] = [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of data) {
        const id = randomUUID();
        const now = new Date().toISOString();
        await client.query(
          `INSERT INTO requirements
             (id, regulationId, wcagVersion, wcagLevel, wcagCriterion, obligation, notes, createdAt, updatedAt)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, item.regulationId, item.wcagVersion, item.wcagLevel, item.wcagCriterion,
           item.obligation, item.notes ?? null, now, now],
        );
        const row = await client.query('SELECT * FROM requirements WHERE id = $1', [id]);
        results.push(rowToRequirement(row.rows[0]));
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return results;
  }

  async findRequirementsByCriteria(
    jurisdictionIds: readonly string[],
    wcagCriteria: readonly string[],
  ): Promise<RequirementWithRegulation[]> {
    if (jurisdictionIds.length === 0 || wcagCriteria.length === 0) return [];

    // Build parameterised IN lists
    const jParams = jurisdictionIds.map((_, i) => `$${i + 1}`).join(', ');
    const offset = jurisdictionIds.length;
    const cParams = wcagCriteria.map((_, i) => `$${offset + i + 1}`).join(', ');

    const sql = `
      SELECT
        req.id, req.regulationId, req.wcagVersion, req.wcagLevel,
        req.wcagCriterion, req.obligation, req.notes, req.createdAt, req.updatedAt,
        reg.name AS regulationName, reg.shortName AS regulationShortName,
        reg.jurisdictionId, reg.enforcementDate
      FROM requirements req
      JOIN regulations reg ON req.regulationId = reg.id
      WHERE reg.jurisdictionId IN (${jParams})
        AND (req.wcagCriterion IN (${cParams}) OR req.wcagCriterion = '*')
    `;

    const params: unknown[] = [...jurisdictionIds, ...wcagCriteria];
    const result = await this.pool.query(sql, params);
    return result.rows.map(rowToRequirementWithRegulation);
  }

  // -------------------------------------------------------------------------
  // Update proposals
  // -------------------------------------------------------------------------

  async listUpdateProposals(filters?: { status?: string }): Promise<UpdateProposal[]> {
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (filters?.status != null) {
      conditions.push(`status = $1`);
      params.push(filters.status);
    }
    const result = await this.pool.query(
      `SELECT * FROM update_proposals WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return result.rows.map(rowToUpdateProposal);
  }

  async getUpdateProposal(id: string): Promise<UpdateProposal | null> {
    const result = await this.pool.query('SELECT * FROM update_proposals WHERE id = $1', [id]);
    return result.rows.length > 0 ? rowToUpdateProposal(result.rows[0]) : null;
  }

  async createUpdateProposal(data: CreateUpdateProposalInput): Promise<UpdateProposal> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO update_proposals
         (id, source, detectedAt, type, affectedRegulationId, affectedJurisdictionId,
          summary, proposedChanges, status, createdAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)`,
      [
        id, data.source, now, data.type,
        data.affectedRegulationId ?? null,
        data.affectedJurisdictionId ?? null,
        data.summary,
        JSON.stringify(data.proposedChanges),
        now,
      ],
    );
    const result = await this.pool.query('SELECT * FROM update_proposals WHERE id = $1', [id]);
    return rowToUpdateProposal(result.rows[0]);
  }

  async updateUpdateProposal(id: string, data: Partial<UpdateProposal>): Promise<UpdateProposal> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.status != null) { sets.push(`status = $${idx++}`); params.push(data.status); }
    if (data.reviewedBy != null) { sets.push(`reviewedBy = $${idx++}`); params.push(data.reviewedBy); }
    if (data.reviewedAt != null) { sets.push(`reviewedAt = $${idx++}`); params.push(data.reviewedAt); }
    if (data.summary != null) { sets.push(`summary = $${idx++}`); params.push(data.summary); }
    if (data.proposedChanges != null) {
      sets.push(`proposedChanges = $${idx++}`);
      params.push(JSON.stringify(data.proposedChanges));
    }
    params.push(id);

    await this.pool.query(
      `UPDATE update_proposals SET ${sets.join(', ')} WHERE id = $${idx}`,
      params,
    );
    const result = await this.pool.query('SELECT * FROM update_proposals WHERE id = $1', [id]);
    return rowToUpdateProposal(result.rows[0]);
  }

  // -------------------------------------------------------------------------
  // Monitored sources
  // -------------------------------------------------------------------------

  async listSources(): Promise<MonitoredSource[]> {
    const result = await this.pool.query('SELECT * FROM monitored_sources');
    return result.rows.map(rowToMonitoredSource);
  }

  async createSource(data: CreateSourceInput): Promise<MonitoredSource> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO monitored_sources (id, name, url, type, schedule, createdAt)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, data.name, data.url, data.type, data.schedule, now],
    );
    const result = await this.pool.query('SELECT * FROM monitored_sources WHERE id = $1', [id]);
    return rowToMonitoredSource(result.rows[0]);
  }

  async deleteSource(id: string): Promise<void> {
    await this.pool.query('DELETE FROM monitored_sources WHERE id = $1', [id]);
  }

  async updateSourceLastChecked(id: string, contentHash: string): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      'UPDATE monitored_sources SET lastCheckedAt = $1, lastContentHash = $2 WHERE id = $3',
      [now, contentHash, id],
    );
  }

  // -------------------------------------------------------------------------
  // OAuth clients
  // -------------------------------------------------------------------------

  async getClientById(clientId: string): Promise<OAuthClient | null> {
    const result = await this.pool.query('SELECT * FROM oauth_clients WHERE id = $1', [clientId]);
    return result.rows.length > 0 ? rowToOAuthClient(result.rows[0]) : null;
  }

  async createClient(data: CreateClientInput): Promise<OAuthClient & { secret: string }> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const secret = randomUUID();
    const salt = genSaltSync(10);
    const secretHash = hashSync(secret, salt);

    await this.pool.query(
      `INSERT INTO oauth_clients (id, name, secretHash, scopes, grantTypes, redirectUris, createdAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, data.name, secretHash, data.scopes, data.grantTypes, data.redirectUris ?? null, now],
    );
    const result = await this.pool.query('SELECT * FROM oauth_clients WHERE id = $1', [id]);
    return { ...rowToOAuthClient(result.rows[0]), secret };
  }

  async listClients(): Promise<OAuthClient[]> {
    const result = await this.pool.query('SELECT * FROM oauth_clients');
    return result.rows.map(rowToOAuthClient);
  }

  async deleteClient(id: string): Promise<void> {
    await this.pool.query('DELETE FROM oauth_clients WHERE id = $1', [id]);
  }

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  async getUserByUsername(username: string): Promise<User | null> {
    const result = await this.pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
  }

  async createUser(data: CreateUserInput): Promise<User> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const salt = genSaltSync(10);
    const passwordHash = hashSync(data.password, salt);

    await this.pool.query(
      `INSERT INTO users (id, username, passwordHash, role, createdAt)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, data.username, passwordHash, data.role, now],
    );
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rowToUser(result.rows[0]);
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  async listWebhooks(): Promise<Webhook[]> {
    const result = await this.pool.query('SELECT * FROM webhooks');
    return result.rows.map(rowToWebhook);
  }

  async createWebhook(data: CreateWebhookInput): Promise<Webhook> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO webhooks (id, url, secret, events, active, createdAt)
       VALUES ($1,$2,$3,$4,TRUE,$5)`,
      [id, data.url, data.secret, data.events, now],
    );
    const result = await this.pool.query('SELECT * FROM webhooks WHERE id = $1', [id]);
    return rowToWebhook(result.rows[0]);
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.pool.query('DELETE FROM webhooks WHERE id = $1', [id]);
  }
}
