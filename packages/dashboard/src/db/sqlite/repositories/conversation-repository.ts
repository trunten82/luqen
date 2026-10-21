import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { redactArgumentsJson } from '../../agent-audit-redaction.js';
import {
  activeBranchUpTo,
  activeMessageRow,
  insertMessageRow,
  lastActiveRow,
  replaceLatestQuestion,
  supersedeLatestAnswer,
  supersedeRows,
  type MessageRow,
} from './conversation-branch.js';
import type {
  AppendMessageInput,
  Conversation,
  ConversationRepository,
  ConversationSearchHit,
  CreateConversationInput,
  ImageInput,
  ListConversationsOptions,
  Message,
  MessageRole,
  MessageStatus,
  PendingMessageRef,
  ReplaceQuestionInput,
  ReplaceQuestionResult,
  RetryAnswerInput,
  RetryAnswerResult,
  SearchConversationsOptions,
} from '../../interfaces/conversation-repository.js';

// ---------------------------------------------------------------------------
// Private row types — match SQL columns verbatim (snake_case).
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string;
  user_id: string;
  org_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  is_deleted?: number;
  deleted_at?: string | null;
}

/**
 * Phase 83 multimodal — validate + normalise a persisted `images` JSON blob
 * back into `ImageInput[]`. Defensive: a malformed blob (hand-edited DB, schema
 * drift) degrades to `null` rather than throwing inside a read path.
 */
function parseImages(raw: string | null | undefined): readonly ImageInput[] | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const out: ImageInput[] = [];
    for (const item of parsed) {
      if (
        item !== null &&
        typeof item === 'object' &&
        typeof (item as { mediaType?: unknown }).mediaType === 'string' &&
        typeof (item as { data?: unknown }).data === 'string'
      ) {
        out.push({
          mediaType: (item as ImageInput).mediaType,
          data: (item as ImageInput).data,
        });
      }
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SqliteConversationRepository
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_LIMIT = 200;

/**
 * Extract a 60–120 char window around the first case-insensitive match
 * of `needle` in `haystack`. Used by searchForUser when matchField = 'content'.
 * Pure function (no mutation) per CLAUDE.md coding-style rules.
 */
function extractSnippet(haystack: string, needle: string): string {
  if (haystack.length === 0 || needle.length === 0) return haystack;
  const idx = haystack.toLowerCase().indexOf(needle);
  if (idx === -1) return haystack.slice(0, 120);
  const start = Math.max(0, idx - 60);
  const end = Math.min(haystack.length, idx + needle.length + 60);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < haystack.length ? '...' : '';
  return `${prefix}${haystack.slice(start, end)}${suffix}`;
}

export class SqliteConversationRepository implements ConversationRepository {
  constructor(private readonly db: Database.Database) {}

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO agent_conversations
           (id, user_id, org_id, title, created_at, updated_at, last_message_at)
         VALUES
           (@id, @userId, @orgId, @title, @createdAt, @updatedAt, NULL)`,
      )
      .run({
        id,
        userId: input.userId,
        orgId: input.orgId,
        title: input.title ?? null,
        createdAt: now,
        updatedAt: now,
      });

    const row = this.db
      .prepare('SELECT * FROM agent_conversations WHERE id = ?')
      .get(id) as ConversationRow;
    return this.rowToConversation(row);
  }

  async getConversation(id: string, orgId: string): Promise<Conversation | null> {
    const row = this.db
      .prepare('SELECT * FROM agent_conversations WHERE id = ? AND org_id = ?')
      .get(id, orgId) as ConversationRow | undefined;
    return row !== undefined ? this.rowToConversation(row) : null;
  }

  async listForUser(
    userId: string,
    orgId: string,
    options?: ListConversationsOptions,
  ): Promise<Conversation[]> {
    const limit = Math.min(options?.limit ?? DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT);
    const offset = options?.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM agent_conversations
         WHERE user_id = @userId AND org_id = @orgId AND is_deleted = 0
         ORDER BY COALESCE(last_message_at, created_at) DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all({ userId, orgId, limit, offset }) as ConversationRow[];

    return rows.map((r) => this.rowToConversation(r));
  }

  async appendMessage(input: AppendMessageInput): Promise<Message> {
    // One insert for every writer (src/db/sqlite/repositories/conversation-branch.ts): a row that
    // follows another is written only while that row is on the active branch of a conversation that is
    // not deleted, in the same transaction.
    const id = this.db.transaction(() => insertMessageRow(this.db, input))();
    const created = this.db
      .prepare('SELECT * FROM agent_messages WHERE id = ?')
      .get(id) as MessageRow;
    return this.rowToMessage(created);
  }

  async updateMessageStatus(
    messageId: string,
    status: MessageStatus,
    toolResultJson?: string,
  ): Promise<void> {
    const read = this.db.prepare('SELECT status, tool_call_json FROM agent_messages WHERE id = ?');
    // A superseded row keeps its status: a write that arrives after its answer was replaced moves nothing.
    const write = this.db.prepare(
      `UPDATE agent_messages
       SET status = @status,
           tool_result_json = COALESCE(@toolResultJson, tool_result_json),
           tool_call_json = COALESCE(@resolvedCallJson, tool_call_json)
       WHERE id = @messageId
         AND status != 'superseded'`,
    );
    this.db.transaction(() => {
      const row = read.get(messageId) as { status: string; tool_call_json: string | null } | undefined;
      // HARD-21: the write that moves a paused action out of pending_confirmation stores its
      // arguments redacted, in the same UPDATE as the status change.
      const resolvesPending = row !== undefined && row.status === 'pending_confirmation'
        && status !== 'pending_confirmation' && row.tool_call_json !== null;
      write.run({
        messageId,
        status,
        toolResultJson: toolResultJson ?? null,
        resolvedCallJson: resolvesPending ? redactArgumentsJson(row.tool_call_json as string) : null,
      });
    })();
  }

  async claimPendingMessage(messageId: string, status: 'sent' | 'denied'): Promise<boolean> {
    return this.db.transaction(() => this.claimPendingRow(messageId, status))();
  }

  /**
   * The one conditional write out of pending_confirmation: the row's status changes and its stored
   * call is redacted in the same UPDATE, and only when the row is still paused. True when this write
   * moved the row. Runs inside the caller's transaction.
   */
  private claimPendingRow(messageId: string, status: 'sent' | 'denied'): boolean {
    const row = this.db
      .prepare("SELECT tool_call_json FROM agent_messages WHERE id = ? AND status = 'pending_confirmation'")
      .get(messageId) as { tool_call_json: string | null } | undefined;
    if (row === undefined) return false;
    const result = this.db
      .prepare(
        `UPDATE agent_messages
         SET status = @status,
             tool_call_json = COALESCE(@resolvedCallJson, tool_call_json)
         WHERE id = @messageId AND status = 'pending_confirmation'`,
      )
      .run({
        messageId,
        status,
        resolvedCallJson: row.tool_call_json === null ? null : redactArgumentsJson(row.tool_call_json),
      });
    return result.changes === 1;
  }

  async listPendingMessagesBefore(createdBefore: string): Promise<readonly PendingMessageRef[]> {
    const rows = this.db
      .prepare(
        `SELECT m.id AS id, m.conversation_id AS conversation_id, c.org_id AS org_id, c.user_id AS user_id,
                m.tool_call_json AS tool_call_json, m.created_at AS created_at
           FROM agent_messages m
           INNER JOIN agent_conversations c ON c.id = m.conversation_id
          WHERE m.status = 'pending_confirmation' AND m.created_at < @createdBefore
          ORDER BY m.created_at ASC, m.rowid ASC`,
      )
      .all({ createdBefore }) as Array<{
        id: string; conversation_id: string; org_id: string; user_id: string; tool_call_json: string | null; created_at: string;
      }>;
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      orgId: r.org_id,
      userId: r.user_id,
      toolCallJson: r.tool_call_json,
      createdAt: r.created_at,
    }));
  }

  async reopenPendingMessage(messageId: string, toolCallJson: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE agent_messages
         SET status = 'pending_confirmation',
             tool_call_json = @toolCallJson
         WHERE id = @messageId AND status = 'sent'`,
      )
      .run({ messageId, toolCallJson });
  }

  async getWindow(conversationId: string): Promise<Message[]> {
    // Phase 37 Plan 01: default reads exclude superseded rows so retried /
    // edited turns disappear from the visible thread while staying in DB.
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_messages
         WHERE conversation_id = ? AND in_window = 1
           AND status != 'superseded'
         ORDER BY created_at ASC`,
      )
      .all(conversationId) as MessageRow[];
    return rows.map((r) => this.rowToMessage(r));
  }

  async getFullHistory(
    conversationId: string,
    options?: ListConversationsOptions,
  ): Promise<Message[]> {
    const limit = Math.min(options?.limit ?? DEFAULT_PAGE_LIMIT, DEFAULT_PAGE_LIMIT);
    const offset = options?.offset ?? 0;

    // Phase 37 Plan 01: default reads exclude superseded rows. Audit
    // callers should use getMessagesIncludingSuperseded.
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_messages
         WHERE conversation_id = @conversationId
           AND status != 'superseded'
         ORDER BY created_at ASC
         LIMIT @limit OFFSET @offset`,
      )
      .all({ conversationId, limit, offset }) as MessageRow[];
    return rows.map((r) => this.rowToMessage(r));
  }

  async markOutOfWindowBefore(
    conversationId: string,
    beforeCreatedAt: string,
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE agent_messages
         SET in_window = 0
         WHERE conversation_id = @conversationId
           AND created_at < @boundary
           AND status NOT IN ('pending_confirmation', 'streaming')`,
      )
      .run({ conversationId, boundary: beforeCreatedAt });
  }

  // ── Phase 35 Plan 01 — search + rename + soft-delete ────────────────

  async searchForUser(
    userId: string,
    orgId: string,
    options: SearchConversationsOptions,
  ): Promise<ConversationSearchHit[]> {
    // Input validation (CLAUDE.md boundary check): empty/whitespace query => []
    const rawQuery = options.query ?? '';
    const trimmed = rawQuery.trim();
    if (trimmed.length === 0) return [];

    const limit = Math.min(options.limit ?? 20, 50);
    const offset = Math.max(options.offset ?? 0, 0);

    // T-35-01 mitigation: escape LIKE metacharacters before binding, then
    // declare the escape char in the SQL via ESCAPE '\\'. The `%escaped%`
    // substring is bound via prepared statement parameter (@q), never
    // string-concatenated into SQL.
    const escaped = trimmed.replace(/[\\%_]/g, (c) => '\\' + c);
    const q = `%${escaped}%`;

    // T-35-02 mitigation: WHERE clause always carries user_id + org_id +
    // is_deleted = 0. Cross-org / soft-deleted rows never reach the JS layer.
    const rows = this.db
      .prepare(
        `SELECT c.* FROM agent_conversations c
         WHERE c.user_id = @userId AND c.org_id = @orgId AND c.is_deleted = 0
           AND (
             LOWER(COALESCE(c.title, '')) LIKE LOWER(@q) ESCAPE '\\'
             OR EXISTS (
               SELECT 1 FROM agent_messages m
               WHERE m.conversation_id = c.id
                 AND LOWER(COALESCE(m.content, '')) LIKE LOWER(@q) ESCAPE '\\'
             )
           )
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all({ userId, orgId, q, limit, offset }) as ConversationRow[];

    const findContentMatch = this.db.prepare(
      `SELECT content FROM agent_messages
       WHERE conversation_id = @conversationId
         AND LOWER(COALESCE(content, '')) LIKE LOWER(@q) ESCAPE '\\'
       ORDER BY created_at ASC
       LIMIT 1`,
    );

    const needle = trimmed.toLowerCase();

    return rows.map((r) => {
      const conversation = this.rowToConversation(r);

      // Prefer title match if present.
      const title = r.title ?? '';
      if (title.length > 0 && title.toLowerCase().includes(needle)) {
        return {
          conversation,
          snippet: title,
          matchField: 'title' as const,
        };
      }

      // Fallback: content match — pull first matching message, extract a
      // bounded window (±60 chars) around the match.
      const msg = findContentMatch.get({
        conversationId: r.id,
        q,
      }) as { content: string | null } | undefined;

      const content = msg?.content ?? '';
      return {
        conversation,
        snippet: extractSnippet(content, needle),
        matchField: 'content' as const,
      };
    });
  }

  async renameConversation(
    id: string,
    orgId: string,
    title: string,
    userId: string,
  ): Promise<Conversation | null> {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE agent_conversations
         SET title = @title, updated_at = @now
         WHERE id = @id AND org_id = @orgId AND user_id = @userId AND is_deleted = 0`,
      )
      .run({ id, orgId, userId, title, now });

    if (result.changes === 0) return null;
    return this.getConversation(id, orgId);
  }

  async softDeleteConversation(id: string, orgId: string, userId: string): Promise<boolean> {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const result = this.db
        .prepare(
          `UPDATE agent_conversations
           SET is_deleted = 1, deleted_at = @now, updated_at = @now
           WHERE id = @id AND org_id = @orgId AND user_id = @userId AND is_deleted = 0`,
        )
        .run({ id, orgId, userId, now });
      if (result.changes === 0) return false;
      // The conversation is gone: its paused actions are declined, through the same claim that a
      // decline takes, so their stored arguments are redacted.
      const paused = this.db
        .prepare("SELECT id FROM agent_messages WHERE conversation_id = ? AND status = 'pending_confirmation'")
        .all(id) as Array<{ id: string }>;
      for (const { id: messageId } of paused) this.claimPendingRow(messageId, 'denied');
      return true;
    })();
  }

  // ── Phase 37 Plan 01 — stopped / superseded operations ──────────────

  async markMessageStopped(
    messageId: string,
    conversationId: string,
    orgId: string,
    finalContent: string,
  ): Promise<boolean> {
    // Org-guarded via JOIN-style EXISTS subquery on agent_conversations.org_id. A superseded row keeps
    // its status and content.
    const result = this.db
      .prepare(
        `UPDATE agent_messages
         SET status = 'stopped',
             content = @finalContent
         WHERE id = @messageId
           AND conversation_id = @conversationId
           AND status != 'superseded'
           AND EXISTS (
             SELECT 1 FROM agent_conversations c
             WHERE c.id = agent_messages.conversation_id
               AND c.org_id = @orgId
           )`,
      )
      .run({ messageId, conversationId, orgId, finalContent });
    return result.changes > 0;
  }

  async markMessagesSuperseded(
    messageIds: readonly string[],
    conversationId: string,
    orgId: string,
  ): Promise<number> {
    if (messageIds.length === 0) return 0;
    // One supersede for every writer (conversation-branch.ts); a paused row superseded here is stored redacted.
    return this.db.transaction(() => supersedeRows(this.db, messageIds, conversationId, orgId))();
  }

  // ── The conversation's newest active rows, and the edit and retry transactions ──

  async getActiveMessage(conversationId: string, messageId: string): Promise<Message | null> {
    const row = activeMessageRow(this.db, conversationId, messageId);
    return row !== undefined ? this.rowToMessage(row) : null;
  }

  async getLastActiveMessage(conversationId: string, role?: MessageRole): Promise<Message | null> {
    const row = lastActiveRow(this.db, conversationId, role);
    return row !== undefined ? this.rowToMessage(row) : null;
  }

  async getActiveBranchUpTo(
    conversationId: string,
    anchorMessageId: string,
    limit = DEFAULT_PAGE_LIMIT,
  ): Promise<{ readonly anchor: Message; readonly messages: readonly Message[] } | null> {
    const branch = activeBranchUpTo(this.db, conversationId, anchorMessageId, limit);
    if (branch === null) return null;
    return { anchor: this.rowToMessage(branch.anchor), messages: branch.rows.map((r) => this.rowToMessage(r)) };
  }

  async replaceLatestQuestion(input: ReplaceQuestionInput): Promise<ReplaceQuestionResult> {
    const result = replaceLatestQuestion(this.db, input);
    if (!result.ok) return result;
    return {
      ok: true,
      newMessage: this.rowToMessage(result.newRow),
      supersededMessageIds: result.supersededMessageIds,
      firstAssistantId: result.firstAssistantId,
    };
  }

  async supersedeLatestAnswer(input: RetryAnswerInput): Promise<RetryAnswerResult> {
    return supersedeLatestAnswer(this.db, input);
  }

  async getMessagesIncludingSuperseded(
    conversationId: string,
    orgId: string,
  ): Promise<Message[]> {
    // Org-guarded via JOIN. Foreign-org callers see [].
    const rows = this.db
      .prepare(
        `SELECT m.* FROM agent_messages m
         JOIN agent_conversations c ON c.id = m.conversation_id
         WHERE m.conversation_id = @conversationId
           AND c.org_id = @orgId
         ORDER BY m.created_at ASC`,
      )
      .all({ conversationId, orgId }) as MessageRow[];
    return rows.map((r) => this.rowToMessage(r));
  }

  // ── Private mappers ─────────────────────────────────────────────────

  private rowToConversation(row: ConversationRow): Conversation {
    return {
      id: row.id,
      userId: row.user_id,
      orgId: row.org_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at,
      isDeleted: row.is_deleted === 1,
      deletedAt: row.deleted_at ?? null,
    };
  }

  private rowToMessage(row: MessageRow): Message {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      toolCallJson: row.tool_call_json,
      toolResultJson: row.tool_result_json,
      status: row.status,
      createdAt: row.created_at,
      inWindow: row.in_window === 1,
      supersededAt: row.superseded_at ?? null,
      images: parseImages(row.images),
    };
  }
}
