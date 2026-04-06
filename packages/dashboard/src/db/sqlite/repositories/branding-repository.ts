import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BrandingRepository } from '../../interfaces/branding-repository.js';
import type {
  BrandingGuidelineRecord, BrandingColorRecord, BrandingFontRecord,
  BrandingSelectorRecord, CreateBrandingGuidelineInput, BrandingGuidelineUpdateData,
} from '../../types.js';

// ---------------------------------------------------------------------------
// Private row types and conversion
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
  site_count?: number;
  image_path: string | null;
  cloned_from_system_guideline_id: string | null;
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

function guidelineRowToRecord(row: GuidelineRow): BrandingGuidelineRecord {
  const base: BrandingGuidelineRecord = {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    version: row.version,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  return {
    ...base,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.created_by !== null ? { createdBy: row.created_by } : {}),
    ...(row.site_count !== undefined ? { siteCount: row.site_count } : {}),
    ...(row.image_path !== null ? { imagePath: row.image_path } : {}),
    clonedFromSystemGuidelineId: row.cloned_from_system_guideline_id ?? null,
  };
}

function colorRowToRecord(row: ColorRow): BrandingColorRecord {
  const base: BrandingColorRecord = {
    id: row.id,
    guidelineId: row.guideline_id,
    name: row.name,
    hexValue: row.hex_value,
  };

  return {
    ...base,
    ...(row.usage !== null ? { usage: row.usage } : {}),
    ...(row.context !== null ? { context: row.context } : {}),
  };
}

function fontRowToRecord(row: FontRow): BrandingFontRecord {
  let weights: readonly string[] | undefined;
  if (row.weights !== null) {
    try {
      weights = JSON.parse(row.weights) as string[];
    } catch {
      weights = undefined;
    }
  }

  const base: BrandingFontRecord = {
    id: row.id,
    guidelineId: row.guideline_id,
    family: row.family,
  };

  return {
    ...base,
    ...(weights !== undefined ? { weights } : {}),
    ...(row.usage !== null ? { usage: row.usage } : {}),
    ...(row.context !== null ? { context: row.context } : {}),
  };
}

function selectorRowToRecord(row: SelectorRow): BrandingSelectorRecord {
  const base: BrandingSelectorRecord = {
    id: row.id,
    guidelineId: row.guideline_id,
    pattern: row.pattern,
  };

  return {
    ...base,
    ...(row.description !== null ? { description: row.description } : {}),
  };
}

// ---------------------------------------------------------------------------
// SqliteBrandingRepository
// ---------------------------------------------------------------------------

export class SqliteBrandingRepository implements BrandingRepository {
  constructor(private readonly db: Database.Database) {}

  // -------------------------------------------------------------------------
  // Guidelines
  // -------------------------------------------------------------------------

  async createGuideline(data: CreateBrandingGuidelineInput): Promise<BrandingGuidelineRecord> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO branding_guidelines (id, org_id, name, description, created_by, created_at, updated_at)
      VALUES (@id, @orgId, @name, @description, @createdBy, @createdAt, @updatedAt)
    `);

    stmt.run({
      id: data.id,
      orgId: data.orgId,
      name: data.name,
      description: data.description ?? null,
      createdBy: data.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.getGuideline(data.id);
    if (created === null) {
      throw new Error(`Failed to retrieve branding guideline after creation: ${data.id}`);
    }
    return created;
  }

  async getGuideline(id: string): Promise<BrandingGuidelineRecord | null> {
    const row = this.db.prepare('SELECT * FROM branding_guidelines WHERE id = ?').get(id) as GuidelineRow | undefined;
    if (row === undefined) return null;

    const colors = await this.listColors(id);
    const fonts = await this.listFonts(id);
    const selectors = await this.listSelectors(id);

    return {
      ...guidelineRowToRecord(row),
      colors,
      fonts,
      selectors,
    };
  }

  async listGuidelines(orgId: string): Promise<readonly BrandingGuidelineRecord[]> {
    const rows = this.db.prepare(`
      SELECT g.*, (SELECT COUNT(*) FROM site_branding sb WHERE sb.guideline_id = g.id) AS site_count
      FROM branding_guidelines g
      WHERE g.org_id = @orgId
      ORDER BY g.name ASC
    `).all({ orgId }) as GuidelineRow[];

    return rows.map(guidelineRowToRecord);
  }

  async listAllGuidelines(): Promise<readonly BrandingGuidelineRecord[]> {
    const rows = this.db.prepare(`
      SELECT g.*, (SELECT COUNT(*) FROM site_branding sb WHERE sb.guideline_id = g.id) AS site_count
      FROM branding_guidelines g
      ORDER BY g.org_id ASC, g.name ASC
    `).all() as GuidelineRow[];

    return rows.map(guidelineRowToRecord);
  }

  // -------------------------------------------------------------------------
  // System brand guidelines (08-P01)
  // -------------------------------------------------------------------------

  async listSystemGuidelines(): Promise<readonly BrandingGuidelineRecord[]> {
    const rows = this.db.prepare(`
      SELECT g.*, (SELECT COUNT(*) FROM site_branding sb WHERE sb.guideline_id = g.id) AS site_count
      FROM branding_guidelines g
      WHERE g.org_id = 'system'
      ORDER BY g.name ASC
    `).all() as GuidelineRow[];

    return Promise.all(
      rows.map(async (row) => ({
        ...guidelineRowToRecord(row),
        colors: await this.listColors(row.id),
        fonts: await this.listFonts(row.id),
        selectors: await this.listSelectors(row.id),
      })),
    );
  }

  async cloneSystemGuideline(
    sourceId: string,
    targetOrgId: string,
    overrides?: { name?: string },
  ): Promise<BrandingGuidelineRecord> {
    const source = await this.getGuideline(sourceId);
    if (source === null) {
      throw new Error(`Source guideline ${sourceId} not found`);
    }
    if (source.orgId !== 'system') {
      throw new Error(
        `Cannot clone non-system guideline ${sourceId} (org_id=${source.orgId})`,
      );
    }

    const newId = randomUUID();
    const cloneName = overrides?.name ?? `${source.name} (cloned)`;
    const now = new Date().toISOString();

    const insertGuideline = this.db.prepare(`
      INSERT INTO branding_guidelines (
        id, org_id, name, description, created_by, created_at, updated_at,
        cloned_from_system_guideline_id, image_path
      ) VALUES (
        @id, @orgId, @name, @description, @createdBy, @createdAt, @updatedAt,
        @clonedFromSystemGuidelineId, @imagePath
      )
    `);

    const insertColor = this.db.prepare(`
      INSERT INTO branding_colors (id, guideline_id, name, hex_value, usage, context)
      VALUES (@id, @guidelineId, @name, @hexValue, @usage, @context)
    `);

    const insertFont = this.db.prepare(`
      INSERT INTO branding_fonts (id, guideline_id, family, weights, usage, context)
      VALUES (@id, @guidelineId, @family, @weights, @usage, @context)
    `);

    const insertSelector = this.db.prepare(`
      INSERT INTO branding_selectors (id, guideline_id, pattern, description)
      VALUES (@id, @guidelineId, @pattern, @description)
    `);

    // Snapshot the source children so the transaction body is synchronous
    // (better-sqlite3 transactions cannot span async boundaries).
    const sourceColors = source.colors ?? [];
    const sourceFonts = source.fonts ?? [];
    const sourceSelectors = source.selectors ?? [];

    const clonedColors: Array<{
      id: string;
      guidelineId: string;
      name: string;
      hexValue: string;
      usage?: string;
      context?: string;
    }> = [];
    const clonedFonts: Array<{
      id: string;
      guidelineId: string;
      family: string;
      weights?: readonly string[];
      usage?: string;
      context?: string;
    }> = [];
    const clonedSelectors: Array<{
      id: string;
      guidelineId: string;
      pattern: string;
      description?: string;
    }> = [];

    const runClone = this.db.transaction(() => {
      insertGuideline.run({
        id: newId,
        orgId: targetOrgId,
        name: cloneName,
        description: source.description ?? null,
        createdBy: source.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
        clonedFromSystemGuidelineId: sourceId,
        imagePath: source.imagePath ?? null,
      });

      for (const c of sourceColors) {
        const childId = randomUUID();
        insertColor.run({
          id: childId,
          guidelineId: newId,
          name: c.name,
          hexValue: c.hexValue,
          usage: c.usage ?? null,
          context: c.context ?? null,
        });
        clonedColors.push({
          id: childId,
          guidelineId: newId,
          name: c.name,
          hexValue: c.hexValue,
          ...(c.usage !== undefined ? { usage: c.usage } : {}),
          ...(c.context !== undefined ? { context: c.context } : {}),
        });
      }

      for (const f of sourceFonts) {
        const childId = randomUUID();
        insertFont.run({
          id: childId,
          guidelineId: newId,
          family: f.family,
          weights: f.weights !== undefined ? JSON.stringify(f.weights) : null,
          usage: f.usage ?? null,
          context: f.context ?? null,
        });
        clonedFonts.push({
          id: childId,
          guidelineId: newId,
          family: f.family,
          ...(f.weights !== undefined ? { weights: f.weights } : {}),
          ...(f.usage !== undefined ? { usage: f.usage } : {}),
          ...(f.context !== undefined ? { context: f.context } : {}),
        });
      }

      for (const s of sourceSelectors) {
        const childId = randomUUID();
        insertSelector.run({
          id: childId,
          guidelineId: newId,
          pattern: s.pattern,
          description: s.description ?? null,
        });
        clonedSelectors.push({
          id: childId,
          guidelineId: newId,
          pattern: s.pattern,
          ...(s.description !== undefined ? { description: s.description } : {}),
        });
      }
    });

    runClone();

    return {
      id: newId,
      orgId: targetOrgId,
      name: cloneName,
      version: 1,
      active: true,
      createdAt: now,
      updatedAt: now,
      ...(source.description !== undefined ? { description: source.description } : {}),
      ...(source.createdBy !== undefined ? { createdBy: source.createdBy } : {}),
      ...(source.imagePath !== undefined ? { imagePath: source.imagePath } : {}),
      clonedFromSystemGuidelineId: sourceId,
      colors: clonedColors,
      fonts: clonedFonts,
      selectors: clonedSelectors,
    };
  }

  async updateGuideline(id: string, data: BrandingGuidelineUpdateData): Promise<BrandingGuidelineRecord> {
    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      active: 'active',
      imagePath: 'image_path',
    };

    const setClauses: string[] = ['version = version + 1', "updated_at = @updatedAt"];
    const params: Record<string, unknown> = { id, updatedAt: new Date().toISOString() };

    for (const [key, value] of Object.entries(data)) {
      const col = fieldMap[key];
      if (col === undefined) continue;
      setClauses.push(`${col} = @${key}`);
      params[key] = key === 'active' ? (value ? 1 : 0) : value;
    }

    this.db.prepare(
      `UPDATE branding_guidelines SET ${setClauses.join(', ')} WHERE id = @id`,
    ).run(params);

    const updated = await this.getGuideline(id);
    if (updated === null) {
      throw new Error(`Branding guideline not found after update: ${id}`);
    }
    return updated;
  }

  async deleteGuideline(id: string): Promise<void> {
    this.db.prepare('DELETE FROM branding_guidelines WHERE id = ?').run(id);
  }

  // -------------------------------------------------------------------------
  // Colors
  // -------------------------------------------------------------------------

  async addColor(guidelineId: string, color: Omit<BrandingColorRecord, 'guidelineId'>): Promise<BrandingColorRecord> {
    this.db.prepare(`
      INSERT INTO branding_colors (id, guideline_id, name, hex_value, usage, context)
      VALUES (@id, @guidelineId, @name, @hexValue, @usage, @context)
    `).run({
      id: color.id,
      guidelineId,
      name: color.name,
      hexValue: color.hexValue,
      usage: color.usage ?? null,
      context: color.context ?? null,
    });

    return { ...color, guidelineId };
  }

  async updateColor(id: string, data: Partial<Omit<BrandingColorRecord, 'id' | 'guidelineId'>>): Promise<void> {
    const fieldMap: Record<string, string> = {
      name: 'name',
      hexValue: 'hex_value',
      usage: 'usage',
      context: 'context',
    };

    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      const col = fieldMap[key];
      if (col === undefined) continue;
      setClauses.push(`${col} = @${key}`);
      params[key] = value;
    }

    if (setClauses.length === 0) return;

    this.db.prepare(
      `UPDATE branding_colors SET ${setClauses.join(', ')} WHERE id = @id`,
    ).run(params);
  }

  async removeColor(id: string): Promise<void> {
    this.db.prepare('DELETE FROM branding_colors WHERE id = ?').run(id);
  }

  async listColors(guidelineId: string): Promise<readonly BrandingColorRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM branding_colors WHERE guideline_id = ? ORDER BY name ASC',
    ).all(guidelineId) as ColorRow[];
    return rows.map(colorRowToRecord);
  }

  // -------------------------------------------------------------------------
  // Fonts
  // -------------------------------------------------------------------------

  async addFont(guidelineId: string, font: Omit<BrandingFontRecord, 'guidelineId'>): Promise<BrandingFontRecord> {
    this.db.prepare(`
      INSERT INTO branding_fonts (id, guideline_id, family, weights, usage, context)
      VALUES (@id, @guidelineId, @family, @weights, @usage, @context)
    `).run({
      id: font.id,
      guidelineId,
      family: font.family,
      weights: font.weights !== undefined ? JSON.stringify(font.weights) : null,
      usage: font.usage ?? null,
      context: font.context ?? null,
    });

    return { ...font, guidelineId };
  }

  async updateFont(id: string, data: Partial<Omit<BrandingFontRecord, 'id' | 'guidelineId'>>): Promise<void> {
    const fieldMap: Record<string, string> = {
      family: 'family',
      weights: 'weights',
      usage: 'usage',
      context: 'context',
    };

    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      const col = fieldMap[key];
      if (col === undefined) continue;
      setClauses.push(`${col} = @${key}`);
      params[key] = key === 'weights' && Array.isArray(value) ? JSON.stringify(value) : value;
    }

    if (setClauses.length === 0) return;

    this.db.prepare(
      `UPDATE branding_fonts SET ${setClauses.join(', ')} WHERE id = @id`,
    ).run(params);
  }

  async removeFont(id: string): Promise<void> {
    this.db.prepare('DELETE FROM branding_fonts WHERE id = ?').run(id);
  }

  async listFonts(guidelineId: string): Promise<readonly BrandingFontRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM branding_fonts WHERE guideline_id = ? ORDER BY family ASC',
    ).all(guidelineId) as FontRow[];
    return rows.map(fontRowToRecord);
  }

  // -------------------------------------------------------------------------
  // Selectors
  // -------------------------------------------------------------------------

  async addSelector(guidelineId: string, selector: Omit<BrandingSelectorRecord, 'guidelineId'>): Promise<BrandingSelectorRecord> {
    this.db.prepare(`
      INSERT INTO branding_selectors (id, guideline_id, pattern, description)
      VALUES (@id, @guidelineId, @pattern, @description)
    `).run({
      id: selector.id,
      guidelineId,
      pattern: selector.pattern,
      description: selector.description ?? null,
    });

    return { ...selector, guidelineId };
  }

  async updateSelector(id: string, data: Partial<Omit<BrandingSelectorRecord, 'id' | 'guidelineId'>>): Promise<void> {
    const fieldMap: Record<string, string> = {
      pattern: 'pattern',
      description: 'description',
    };

    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(data)) {
      const col = fieldMap[key];
      if (col === undefined) continue;
      setClauses.push(`${col} = @${key}`);
      params[key] = value;
    }

    if (setClauses.length === 0) return;

    this.db.prepare(
      `UPDATE branding_selectors SET ${setClauses.join(', ')} WHERE id = @id`,
    ).run(params);
  }

  async removeSelector(id: string): Promise<void> {
    this.db.prepare('DELETE FROM branding_selectors WHERE id = ?').run(id);
  }

  async listSelectors(guidelineId: string): Promise<readonly BrandingSelectorRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM branding_selectors WHERE guideline_id = ? ORDER BY pattern ASC',
    ).all(guidelineId) as SelectorRow[];
    return rows.map(selectorRowToRecord);
  }

  // -------------------------------------------------------------------------
  // Site assignments
  // -------------------------------------------------------------------------

  async assignToSite(guidelineId: string, siteUrl: string, orgId: string): Promise<void> {
    const normalizedUrl = siteUrl.replace(/\/+$/, '');
    this.db.prepare(`
      INSERT OR REPLACE INTO site_branding (site_url, guideline_id, org_id)
      VALUES (@siteUrl, @guidelineId, @orgId)
    `).run({ siteUrl: normalizedUrl, guidelineId, orgId });
  }

  async unassignFromSite(siteUrl: string, orgId: string): Promise<void> {
    const normalizedUrl = siteUrl.replace(/\/+$/, '');
    this.db.prepare(
      'DELETE FROM site_branding WHERE site_url = @siteUrl AND org_id = @orgId',
    ).run({ siteUrl: normalizedUrl, orgId });
  }

  async getGuidelineForSite(siteUrl: string, orgId: string): Promise<BrandingGuidelineRecord | null> {
    const normalizedUrl = siteUrl.replace(/\/+$/, '');
    // Prefer org-specific assignment; fall back to system-level assignment
    const row = this.db.prepare(`
      SELECT g.* FROM branding_guidelines g
      JOIN site_branding sb ON sb.guideline_id = g.id
      WHERE sb.site_url = @siteUrl AND sb.org_id IN (@orgId, 'system')
      ORDER BY CASE sb.org_id WHEN @orgId THEN 0 ELSE 1 END
      LIMIT 1
    `).get({ siteUrl: normalizedUrl, orgId }) as GuidelineRow | undefined;

    if (row === undefined) return null;

    const colors = await this.listColors(row.id);
    const fonts = await this.listFonts(row.id);
    const selectors = await this.listSelectors(row.id);

    return {
      ...guidelineRowToRecord(row),
      colors,
      fonts,
      selectors,
    };
  }

  async getSiteAssignments(guidelineId: string): Promise<readonly string[]> {
    const rows = this.db.prepare(
      'SELECT site_url FROM site_branding WHERE guideline_id = ? ORDER BY site_url ASC',
    ).all(guidelineId) as Array<{ site_url: string }>;
    return rows.map((r) => r.site_url);
  }
}
