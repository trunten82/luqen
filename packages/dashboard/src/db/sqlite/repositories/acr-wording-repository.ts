import type Database from 'better-sqlite3';
import type {
  AcrWordingRepository,
  AcrWordingRecord,
  AcrWordingInput,
} from '../../interfaces/acr-wording-repository.js';
import type { AcrWordingSource } from '../../../services/acr-wording.js';

interface WordingRow {
  org_id: string;
  string_key: string;
  locale: string;
  text: string;
  source: string;
  reviewed: number;
  translated_by: string | null;
  translated_at: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}

function rowToRecord(row: WordingRow): AcrWordingRecord {
  return {
    key: row.string_key,
    locale: row.locale,
    text: row.text,
    source: row.source as AcrWordingSource,
    reviewed: row.reviewed === 1,
    translatedBy: row.translated_by,
    translatedAt: row.translated_at,
    notes: row.notes,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export class SqliteAcrWordingRepository implements AcrWordingRepository {
  constructor(private readonly db: Database.Database) {}

  async listForOrg(orgId: string, locale?: string): Promise<AcrWordingRecord[]> {
    const rows = (
      locale
        ? this.db
            .prepare('SELECT * FROM acr_wording WHERE org_id = ? AND locale = ? ORDER BY string_key')
            .all(orgId, locale)
        : this.db
            .prepare('SELECT * FROM acr_wording WHERE org_id = ? ORDER BY locale, string_key')
            .all(orgId)
    ) as WordingRow[];
    return rows.map(rowToRecord);
  }

  async upsert(orgId: string, data: AcrWordingInput, updatedBy?: string): Promise<void> {
    this.writeOne(orgId, data, updatedBy ?? null, new Date().toISOString());
  }

  async bulkUpsert(
    orgId: string,
    rows: readonly AcrWordingInput[],
    updatedBy?: string,
  ): Promise<number> {
    const now = new Date().toISOString();
    const by = updatedBy ?? null;
    const tx = this.db.transaction((items: readonly AcrWordingInput[]) => {
      for (const item of items) this.writeOne(orgId, item, by, now);
      return items.length;
    });
    return tx(rows);
  }

  async remove(orgId: string, key: string, locale: string): Promise<void> {
    this.db
      .prepare('DELETE FROM acr_wording WHERE org_id = ? AND string_key = ? AND locale = ?')
      .run(orgId, key, locale);
  }

  private writeOne(
    orgId: string,
    data: AcrWordingInput,
    updatedBy: string | null,
    now: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO acr_wording (
           org_id, string_key, locale, text, source, reviewed,
           translated_by, translated_at, notes, updated_at, updated_by
         ) VALUES (
           @orgId, @key, @locale, @text, @source, @reviewed,
           @translatedBy, @translatedAt, @notes, @updatedAt, @updatedBy
         )
         ON CONFLICT(org_id, string_key, locale) DO UPDATE SET
           text = @text, source = @source, reviewed = @reviewed,
           translated_by = @translatedBy, translated_at = @translatedAt,
           notes = @notes, updated_at = @updatedAt, updated_by = @updatedBy`,
      )
      .run({
        orgId,
        key: data.key,
        locale: data.locale,
        text: data.text,
        source: data.source,
        reviewed: data.reviewed ? 1 : 0,
        translatedBy: data.translatedBy ?? null,
        translatedAt: data.translatedAt ?? null,
        notes: data.notes ?? null,
        updatedAt: now,
        updatedBy,
      });
  }
}
