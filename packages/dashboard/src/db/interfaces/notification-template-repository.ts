import type {
  NotificationTemplate,
  NotificationChannel,
  NotificationEventType,
  NotificationTemplateScope,
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateHistoryEntry,
} from '../types.js';

export interface ListTemplateFilter {
  readonly eventType?: NotificationEventType;
  readonly channel?: NotificationChannel;
  readonly scope?: NotificationTemplateScope;
  readonly orgId?: string | null;
}

export interface NotificationTemplateRepository {
  list(filter?: ListTemplateFilter): Promise<NotificationTemplate[]>;
  getById(id: string): Promise<NotificationTemplate | null>;
  /**
   * Resolve a template for an incoming event. Org-scoped row wins; falls back
   * to system. Returns null when neither exists (caller emits 'no-template').
   */
  resolve(
    eventType: NotificationEventType,
    channel: NotificationChannel,
    orgId: string,
  ): Promise<NotificationTemplate | null>;
  create(data: CreateTemplateInput): Promise<NotificationTemplate>;
  update(
    id: string,
    data: UpdateTemplateInput,
    updatedBy: string,
  ): Promise<NotificationTemplate>;
  /** Org-scoped templates only — system templates are protected. */
  delete(id: string): Promise<void>;
  listHistory(templateId: string): Promise<TemplateHistoryEntry[]>;
}
