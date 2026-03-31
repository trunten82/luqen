import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { genSaltSync, hashSync } from 'bcrypt';
import type { Database as DB } from 'better-sqlite3';
import type {
  BrandGuideline,
  BrandColor,
  BrandFont,
  BrandSelector,
  IBrandingStore,
} from '../types.js';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface GuidelineRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  version: number;
  active: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ColorRow {
  id: string;
  guideline_id: string;
  name: string;
  hex_value: string;
  usage: string | null;
  context: string | null;
}

interface FontRow {
  id: string;
  guideline_id: string;
  family: string;
  weights: string | null;
  usage: string | null;
  context: string | null;
}

interface SelectorRow {
  id: string;
  guideline_id: string;
  pattern: string;
  description: string | null;
}

interface SiteAssignmentRow {
  guideline_id: string;
  site_url: string;
  org_id: string;
  created_at: string;
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

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toColor(row: ColorRow): BrandColor {
  return {
    id: row.id,
    name: row.name,
    hexValue: row.hex_value,
    ...(row.usage != null ? { usage: row.usage as BrandColor['usage'] } : {}),
    ...(row.context != null ? { context: row.context } : {}),
  };
}

function toFont(row: FontRow): BrandFont {
  return {
    id: row.id,
    family: row.family,
    ...(row.weights != null ? { weights: JSON.parse(row.weights) as string[] } : {}),
    ...(row.usage != null ? { usage: row.usage as BrandFont['usage'] } : {}),
    ...(row.context != null ? { context: row.context } : {}),
  };
}

function toSelector(row: SelectorRow): BrandSelector {
  return {
    id: row.id,
    pattern: row.pattern,
    ...(row.description != null ? { description: row.description } : {}),
  };
}

export interface OAuthClient {
  readonly id: string;
  readonly name: string;
  readonly secretHash: string;
  readonly scopes: readonly string[];
  readonly grantTypes: readonly string[];
  readonly orgId: string;
  readonly createdAt: string;
}

interface CreateClientInput {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly grantTypes: readonly string[];
  readonly orgId?: string;
}

function toOAuthClient(row: OAuthClientRow): OAuthClient {
  return {
    id: row.id,
    name: row.name,
    secretHash: row.secret_hash,
    scopes: JSON.parse(row.scopes) as string[],
    grantTypes: JSON.parse(row.grant_types) as string[],
    orgId: row.org_id,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// SqliteAdapter
// ---------------------------------------------------------------------------

export class SqliteAdapter implements IBrandingStore {
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
    const ddl = [
      `CREATE TABLE IF NOT EXISTS branding_guidelines (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_branding_guidelines_org ON branding_guidelines(org_id)`,

      `CREATE TABLE IF NOT EXISTS branding_colors (
        id TEXT PRIMARY KEY,
        guideline_id TEXT NOT NULL REFERENCES branding_guidelines(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        hex_value TEXT NOT NULL,
        usage TEXT,
        context TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_branding_colors_guideline ON branding_colors(guideline_id)`,

      `CREATE TABLE IF NOT EXISTS branding_fonts (
        id TEXT PRIMARY KEY,
        guideline_id TEXT NOT NULL REFERENCES branding_guidelines(id) ON DELETE CASCADE,
        family TEXT NOT NULL,
        weights TEXT,
        usage TEXT,
        context TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_branding_fonts_guideline ON branding_fonts(guideline_id)`,

      `CREATE TABLE IF NOT EXISTS branding_selectors (
        id TEXT PRIMARY KEY,
        guideline_id TEXT NOT NULL REFERENCES branding_guidelines(id) ON DELETE CASCADE,
        pattern TEXT NOT NULL,
        description TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_branding_selectors_guideline ON branding_selectors(guideline_id)`,

      `CREATE TABLE IF NOT EXISTS site_branding (
        guideline_id TEXT NOT NULL REFERENCES branding_guidelines(id) ON DELETE CASCADE,
        site_url TEXT NOT NULL,
        org_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (site_url, org_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_site_branding_guideline ON site_branding(guideline_id)`,

      `CREATE TABLE IF NOT EXISTS oauth_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '[]',
        grant_types TEXT NOT NULL DEFAULT '[]',
        org_id TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_oauth_clients_org ON oauth_clients(org_id)`,
    ];

    for (const statement of ddl) {
      this.db.prepare(statement).run();
    }
  }

  // ---------------------------------------------------------------------------
  // Guidelines CRUD
  // ---------------------------------------------------------------------------

  addGuideline(guideline: BrandGuideline): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO branding_guidelines (id, org_id, name, description, version, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      guideline.id,
      guideline.orgId,
      guideline.name,
      guideline.description ?? null,
      guideline.version,
      guideline.active ? 1 : 0,
      guideline.createdBy ?? null,
      guideline.createdAt ?? now,
      guideline.updatedAt ?? now,
    );

    for (const color of guideline.colors) {
      this.insertColor(guideline.id, color);
    }
    for (const font of guideline.fonts) {
      this.insertFont(guideline.id, font);
    }
    for (const selector of guideline.selectors) {
      this.insertSelector(guideline.id, selector);
    }
  }

  createGuideline(data: {
    name: string;
    orgId: string;
    description?: string;
    createdBy?: string;
  }): BrandGuideline {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO branding_guidelines (id, org_id, name, description, version, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)
    `).run(id, data.orgId, data.name, data.description ?? null, data.createdBy ?? null, now, now);
    return this.getGuideline(id)!;
  }

  updateGuideline(id: string, updates: Partial<Omit<BrandGuideline, 'id' | 'orgId'>>): void {
    const now = new Date().toISOString();
    const fields: string[] = [];
    const params: unknown[] = [];

    if (updates.name != null) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description ?? null); }
    if (updates.active != null) { fields.push('active = ?'); params.push(updates.active ? 1 : 0); }
    fields.push('version = version + 1');
    fields.push('updated_at = ?');
    params.push(now);
    params.push(id);

    if (fields.length > 2) {
      this.db.prepare(`UPDATE branding_guidelines SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    }
  }

  removeGuideline(id: string): void {
    this.db.prepare('DELETE FROM branding_guidelines WHERE id = ?').run(id);
  }

  getGuideline(id: string): BrandGuideline | null {
    const row = this.db.prepare('SELECT * FROM branding_guidelines WHERE id = ?').get(id) as GuidelineRow | undefined;
    if (row == null) return null;
    return this.hydrateGuideline(row);
  }

  listGuidelines(orgId: string): readonly BrandGuideline[] {
    const rows = this.db.prepare(
      "SELECT * FROM branding_guidelines WHERE org_id = ? OR org_id = 'system' ORDER BY created_at DESC",
    ).all(orgId) as GuidelineRow[];
    return rows.map(r => this.hydrateGuideline(r));
  }

  // ---------------------------------------------------------------------------
  // Colors CRUD
  // ---------------------------------------------------------------------------

  addColor(guidelineId: string, color: Omit<BrandColor, 'id'>): BrandColor {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO branding_colors (id, guideline_id, name, hex_value, usage, context)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, guidelineId, color.name, color.hexValue, color.usage ?? null, color.context ?? null);
    this.touchGuideline(guidelineId);
    return { id, ...color };
  }

  removeColor(colorId: string): void {
    const row = this.db.prepare('SELECT guideline_id FROM branding_colors WHERE id = ?').get(colorId) as { guideline_id: string } | undefined;
    this.db.prepare('DELETE FROM branding_colors WHERE id = ?').run(colorId);
    if (row != null) this.touchGuideline(row.guideline_id);
  }

  // ---------------------------------------------------------------------------
  // Fonts CRUD
  // ---------------------------------------------------------------------------

  addFont(guidelineId: string, font: Omit<BrandFont, 'id'>): BrandFont {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO branding_fonts (id, guideline_id, family, weights, usage, context)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, guidelineId, font.family, font.weights ? JSON.stringify(font.weights) : null, font.usage ?? null, font.context ?? null);
    this.touchGuideline(guidelineId);
    return { id, ...font };
  }

  removeFont(fontId: string): void {
    const row = this.db.prepare('SELECT guideline_id FROM branding_fonts WHERE id = ?').get(fontId) as { guideline_id: string } | undefined;
    this.db.prepare('DELETE FROM branding_fonts WHERE id = ?').run(fontId);
    if (row != null) this.touchGuideline(row.guideline_id);
  }

  // ---------------------------------------------------------------------------
  // Selectors CRUD
  // ---------------------------------------------------------------------------

  addSelector(guidelineId: string, selector: Omit<BrandSelector, 'id'>): BrandSelector {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO branding_selectors (id, guideline_id, pattern, description)
      VALUES (?, ?, ?, ?)
    `).run(id, guidelineId, selector.pattern, selector.description ?? null);
    this.touchGuideline(guidelineId);
    return { id, ...selector };
  }

  removeSelector(selectorId: string): void {
    const row = this.db.prepare('SELECT guideline_id FROM branding_selectors WHERE id = ?').get(selectorId) as { guideline_id: string } | undefined;
    this.db.prepare('DELETE FROM branding_selectors WHERE id = ?').run(selectorId);
    if (row != null) this.touchGuideline(row.guideline_id);
  }

  // ---------------------------------------------------------------------------
  // Site assignments
  // ---------------------------------------------------------------------------

  assignToSite(guidelineId: string, siteUrl: string, orgId: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO site_branding (guideline_id, site_url, org_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(guidelineId, siteUrl, orgId, new Date().toISOString());
  }

  unassignFromSite(siteUrl: string, orgId: string): void {
    this.db.prepare('DELETE FROM site_branding WHERE site_url = ? AND org_id = ?').run(siteUrl, orgId);
  }

  getGuidelineForSite(siteUrl: string, orgId: string): BrandGuideline | null {
    const row = this.db.prepare(
      'SELECT guideline_id FROM site_branding WHERE site_url = ? AND org_id = ?',
    ).get(siteUrl, orgId) as { guideline_id: string } | undefined;
    if (row == null) return null;
    return this.getGuideline(row.guideline_id);
  }

  getSiteAssignments(guidelineId: string): readonly string[] {
    const rows = this.db.prepare(
      'SELECT site_url FROM site_branding WHERE guideline_id = ?',
    ).all(guidelineId) as Array<{ site_url: string }>;
    return rows.map(r => r.site_url);
  }

  // ---------------------------------------------------------------------------
  // OAuth clients
  // ---------------------------------------------------------------------------

  async createClient(data: CreateClientInput): Promise<OAuthClient & { secret: string }> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const secret = randomUUID();
    const salt = genSaltSync(10);
    const secretHash = hashSync(secret, salt);

    this.db.prepare(`
      INSERT INTO oauth_clients (id, name, secret_hash, scopes, grant_types, org_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.name,
      secretHash,
      JSON.stringify(data.scopes),
      JSON.stringify(data.grantTypes),
      data.orgId ?? 'system',
      now,
    );
    const row = this.db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(id) as OAuthClientRow;
    return { ...toOAuthClient(row), secret };
  }

  async getClientById(clientId: string): Promise<OAuthClient | null> {
    const row = this.db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(clientId) as OAuthClientRow | undefined;
    return row != null ? toOAuthClient(row) : null;
  }

  async listClients(orgId?: string): Promise<OAuthClient[]> {
    if (orgId != null && orgId !== 'system') {
      const rows = this.db.prepare("SELECT * FROM oauth_clients WHERE org_id IN ('system', ?)").all(orgId) as OAuthClientRow[];
      return rows.map(toOAuthClient);
    }
    const rows = this.db.prepare('SELECT * FROM oauth_clients').all() as OAuthClientRow[];
    return rows.map(toOAuthClient);
  }

  async deleteClient(id: string): Promise<void> {
    this.db.prepare('DELETE FROM oauth_clients WHERE id = ?').run(id);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private insertColor(guidelineId: string, color: BrandColor): void {
    this.db.prepare(`
      INSERT INTO branding_colors (id, guideline_id, name, hex_value, usage, context)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(color.id, guidelineId, color.name, color.hexValue, color.usage ?? null, color.context ?? null);
  }

  private insertFont(guidelineId: string, font: BrandFont): void {
    this.db.prepare(`
      INSERT INTO branding_fonts (id, guideline_id, family, weights, usage, context)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(font.id, guidelineId, font.family, font.weights ? JSON.stringify(font.weights) : null, font.usage ?? null, font.context ?? null);
  }

  private insertSelector(guidelineId: string, selector: BrandSelector): void {
    this.db.prepare(`
      INSERT INTO branding_selectors (id, guideline_id, pattern, description)
      VALUES (?, ?, ?, ?)
    `).run(selector.id, guidelineId, selector.pattern, selector.description ?? null);
  }

  private hydrateGuideline(row: GuidelineRow): BrandGuideline {
    const colors = (this.db.prepare('SELECT * FROM branding_colors WHERE guideline_id = ?').all(row.id) as ColorRow[]).map(toColor);
    const fonts = (this.db.prepare('SELECT * FROM branding_fonts WHERE guideline_id = ?').all(row.id) as FontRow[]).map(toFont);
    const selectors = (this.db.prepare('SELECT * FROM branding_selectors WHERE guideline_id = ?').all(row.id) as SelectorRow[]).map(toSelector);

    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      ...(row.description != null ? { description: row.description } : {}),
      version: row.version,
      active: row.active === 1,
      colors,
      fonts,
      selectors,
      ...(row.created_by != null ? { createdBy: row.created_by } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private touchGuideline(guidelineId: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE branding_guidelines SET version = version + 1, updated_at = ? WHERE id = ?').run(now, guidelineId);
  }
}
