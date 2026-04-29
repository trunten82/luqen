import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  NotificationTemplateRepository,
  ListTemplateFilter,
} from '../../interfaces/notification-template-repository.js';
import type {
  NotificationTemplate,
  NotificationChannel,
  NotificationEventType,
  NotificationTemplateScope,
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateHistoryEntry,
} from '../../types.js';

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface TemplateRow {
  readonly id: string;
  readonly event_type: string;
  readonly channel: string;
  readonly scope: string;
  readonly org_id: string | null;
  readonly subject_template: string;
  readonly body_template: string;
  readonly voice: string | null;
  readonly signature: string | null;
  readonly llm_enabled: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly updated_by: string | null;
}

interface HistoryRow {
  readonly template_id: string;
  readonly version: number;
  readonly subject_template: string;
  readonly body_template: string;
  readonly voice: string | null;
  readonly signature: string | null;
  readonly llm_enabled: number;
  readonly saved_at: string;
  readonly saved_by: string | null;
}

function rowToTemplate(row: TemplateRow): NotificationTemplate {
  return {
    id: row.id,
    eventType: row.event_type as NotificationEventType,
    channel: row.channel as NotificationChannel,
    scope: row.scope as NotificationTemplateScope,
    orgId: row.org_id,
    subjectTemplate: row.subject_template,
    bodyTemplate: row.body_template,
    voice: row.voice,
    signature: row.signature,
    llmEnabled: row.llm_enabled === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function rowToHistory(row: HistoryRow): TemplateHistoryEntry {
  return {
    templateId: row.template_id,
    version: row.version,
    subjectTemplate: row.subject_template,
    bodyTemplate: row.body_template,
    voice: row.voice,
    signature: row.signature,
    llmEnabled: row.llm_enabled === 1,
    savedAt: row.saved_at,
    savedBy: row.saved_by,
  };
}

// ---------------------------------------------------------------------------
// SqliteNotificationTemplateRepository
// ---------------------------------------------------------------------------

export class SqliteNotificationTemplateRepository
  implements NotificationTemplateRepository
{
  constructor(private readonly db: Database.Database) {}

  async list(filter?: ListTemplateFilter): Promise<NotificationTemplate[]> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter?.eventType !== undefined) {
      conditions.push('event_type = @eventType');
      params.eventType = filter.eventType;
    }
    if (filter?.channel !== undefined) {
      conditions.push('channel = @channel');
      params.channel = filter.channel;
    }
    if (filter?.scope !== undefined) {
      conditions.push('scope = @scope');
      params.scope = filter.scope;
    }
    if (filter?.orgId !== undefined) {
      if (filter.orgId === null) {
        conditions.push('org_id IS NULL');
      } else {
        conditions.push('org_id = @orgId');
        params.orgId = filter.orgId;
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM notification_templates ${where} ORDER BY scope, event_type, channel`,
      )
      .all(params) as TemplateRow[];
    return rows.map(rowToTemplate);
  }

  async getById(id: string): Promise<NotificationTemplate | null> {
    const row = this.db
      .prepare('SELECT * FROM notification_templates WHERE id = @id')
      .get({ id }) as TemplateRow | undefined;
    return row ? rowToTemplate(row) : null;
  }

  async resolve(
    eventType: NotificationEventType,
    channel: NotificationChannel,
    orgId: string,
  ): Promise<NotificationTemplate | null> {
    // Org row wins
    const orgRow = this.db
      .prepare(
        `SELECT * FROM notification_templates
         WHERE event_type = @eventType AND channel = @channel
           AND scope = 'org' AND org_id = @orgId`,
      )
      .get({ eventType, channel, orgId }) as TemplateRow | undefined;
    if (orgRow) return rowToTemplate(orgRow);

    const sysRow = this.db
      .prepare(
        `SELECT * FROM notification_templates
         WHERE event_type = @eventType AND channel = @channel
           AND scope = 'system' AND org_id IS NULL`,
      )
      .get({ eventType, channel }) as TemplateRow | undefined;
    return sysRow ? rowToTemplate(sysRow) : null;
  }

  async create(data: CreateTemplateInput): Promise<NotificationTemplate> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const orgId =
      data.scope === 'org' ? (data.orgId ?? null) : null;
    if (data.scope === 'org' && (orgId === null || orgId === '')) {
      throw new Error('org-scoped templates require orgId');
    }

    this.db
      .prepare(
        `INSERT INTO notification_templates (
           id, event_type, channel, scope, org_id,
           subject_template, body_template, voice, signature, llm_enabled,
           version, created_at, updated_at, updated_by
         ) VALUES (
           @id, @eventType, @channel, @scope, @orgId,
           @subjectTemplate, @bodyTemplate, @voice, @signature, @llmEnabled,
           1, @createdAt, @updatedAt, @updatedBy
         )`,
      )
      .run({
        id,
        eventType: data.eventType,
        channel: data.channel,
        scope: data.scope,
        orgId,
        subjectTemplate: data.subjectTemplate,
        bodyTemplate: data.bodyTemplate,
        voice: data.voice ?? null,
        signature: data.signature ?? null,
        llmEnabled: data.llmEnabled ? 1 : 0,
        createdAt: now,
        updatedAt: now,
        updatedBy: data.updatedBy ?? null,
      });

    const row = this.db
      .prepare('SELECT * FROM notification_templates WHERE id = @id')
      .get({ id }) as TemplateRow;
    return rowToTemplate(row);
  }

  async update(
    id: string,
    data: UpdateTemplateInput,
    updatedBy: string,
  ): Promise<NotificationTemplate> {
    const existing = await this.getById(id);
    if (existing === null) {
      throw new Error(`notification template ${id} not found`);
    }

    const newVersion = existing.version + 1;
    const now = new Date().toISOString();

    const merged: NotificationTemplate = {
      ...existing,
      subjectTemplate: data.subjectTemplate ?? existing.subjectTemplate,
      bodyTemplate: data.bodyTemplate ?? existing.bodyTemplate,
      voice: data.voice !== undefined ? data.voice : existing.voice,
      signature:
        data.signature !== undefined ? data.signature : existing.signature,
      llmEnabled:
        data.llmEnabled !== undefined ? data.llmEnabled : existing.llmEnabled,
      version: newVersion,
      updatedAt: now,
      updatedBy,
    };

    const txn = this.db.transaction(() => {
      // Snapshot the prior version into history
      this.db
        .prepare(
          `INSERT INTO notification_template_history (
             template_id, version, subject_template, body_template,
             voice, signature, llm_enabled, saved_at, saved_by
           ) VALUES (
             @templateId, @version, @subjectTemplate, @bodyTemplate,
             @voice, @signature, @llmEnabled, @savedAt, @savedBy
           )`,
        )
        .run({
          templateId: existing.id,
          version: existing.version,
          subjectTemplate: existing.subjectTemplate,
          bodyTemplate: existing.bodyTemplate,
          voice: existing.voice,
          signature: existing.signature,
          llmEnabled: existing.llmEnabled ? 1 : 0,
          savedAt: existing.updatedAt,
          savedBy: existing.updatedBy,
        });

      this.db
        .prepare(
          `UPDATE notification_templates SET
             subject_template = @subjectTemplate,
             body_template = @bodyTemplate,
             voice = @voice,
             signature = @signature,
             llm_enabled = @llmEnabled,
             version = @version,
             updated_at = @updatedAt,
             updated_by = @updatedBy
           WHERE id = @id`,
        )
        .run({
          id,
          subjectTemplate: merged.subjectTemplate,
          bodyTemplate: merged.bodyTemplate,
          voice: merged.voice,
          signature: merged.signature,
          llmEnabled: merged.llmEnabled ? 1 : 0,
          version: merged.version,
          updatedAt: merged.updatedAt,
          updatedBy: merged.updatedBy,
        });
    });
    txn();

    return merged;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (existing === null) return;
    if (existing.scope === 'system') {
      throw new Error('system templates cannot be deleted');
    }

    const txn = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM notification_template_history WHERE template_id = @id')
        .run({ id });
      this.db
        .prepare('DELETE FROM notification_templates WHERE id = @id')
        .run({ id });
    });
    txn();
  }

  async listHistory(templateId: string): Promise<TemplateHistoryEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM notification_template_history
         WHERE template_id = @templateId
         ORDER BY version ASC`,
      )
      .all({ templateId }) as HistoryRow[];
    return rows.map(rowToHistory);
  }
}
