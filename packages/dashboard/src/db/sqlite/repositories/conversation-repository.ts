import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  AppendMessageInput,
  Conversation,
  ConversationRepository,
  CreateConversationInput,
  ListConversationsOptions,
  Message,
  MessageRole,
  MessageStatus,
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
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string | null;
  tool_call_json: string | null;
  tool_result_json: string | null;
  status: MessageStatus;
  created_at: string;
  in_window: number;
}

// ---------------------------------------------------------------------------
// SqliteConversationRepository
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_LIMIT = 200;

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
         WHERE user_id = @userId AND org_id = @orgId
         ORDER BY COALESCE(last_message_at, created_at) DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all({ userId, orgId, limit, offset }) as ConversationRow[];

    return rows.map((r) => this.rowToConversation(r));
  }

  async appendMessage(input: AppendMessageInput): Promise<Message> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const status: MessageStatus = input.status ?? 'sent';

    const insertMsg = this.db.prepare(`
      INSERT INTO agent_messages
        (id, conversation_id, role, content, tool_call_json, tool_result_json, status, created_at, in_window)
      VALUES
        (@id, @conversationId, @role, @content, @toolCallJson, @toolResultJson, @status, @createdAt, 1)
    `);

    const updateConv = this.db.prepare(`
      UPDATE agent_conversations
      SET updated_at = @now, last_message_at = @now
      WHERE id = @conversationId
    `);

    // Rolling-window maintenance — only run when appending a user message.
    //
    // Policy (from 31-CONTEXT.md, locked):
    //   A "turn" starts at each role='user' row. The window is the most
    //   recent 20 turns. Boundary = created_at of the 20th-most-recent
    //   user message (OFFSET 19 on DESC order — zero-indexed). Every
    //   message with created_at STRICTLY EARLIER than the boundary
    //   flips to in_window = 0 — EXCEPT messages whose status is
    //   'pending_confirmation' or 'streaming' (those stay in_window = 1
    //   regardless of age, so the UX remains readable after restart).
    //
    // OFFSET 19 math:
    //   - With 20 user messages in history, OFFSET 19 = the oldest user
    //     message; nothing strictly older → no flips. Entire history
    //     stays in window. Correct for ≤ 20-turn histories.
    //   - With 21 user messages, OFFSET 19 = the 20th-most-recent; the
    //     oldest user message + its assistant/tool followers flip out.
    //   - With N > 20 user messages, the oldest N-20 turns flip out,
    //     leaving exactly 20 turns + outstanding pending/streaming rows
    //     inside the window.
    //
    // The new user row was inserted just above with in_window = 1, and
    // its created_at = @now >= the boundary (strict-less comparison),
    // so it is never flipped by this UPDATE.
    const findBoundary = this.db.prepare(`
      SELECT created_at FROM agent_messages
      WHERE conversation_id = @conversationId AND role = 'user'
      ORDER BY created_at DESC
      LIMIT 1 OFFSET 19
    `);

    const flipOlder = this.db.prepare(`
      UPDATE agent_messages
      SET in_window = 0
      WHERE conversation_id = @conversationId
        AND created_at < @boundary
        AND status NOT IN ('pending_confirmation', 'streaming')
    `);

    this.db.transaction(() => {
      insertMsg.run({
        id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content ?? null,
        toolCallJson: input.toolCallJson ?? null,
        toolResultJson: input.toolResultJson ?? null,
        status,
        createdAt: now,
      });
      updateConv.run({ now, conversationId: input.conversationId });

      if (input.role === 'user') {
        const boundaryRow = findBoundary.get({
          conversationId: input.conversationId,
        }) as { created_at: string } | undefined;

        if (boundaryRow !== undefined) {
          flipOlder.run({
            conversationId: input.conversationId,
            boundary: boundaryRow.created_at,
          });
        }
      }
    })();

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
    this.db
      .prepare(
        `UPDATE agent_messages
         SET status = @status,
             tool_result_json = COALESCE(@toolResultJson, tool_result_json)
         WHERE id = @messageId`,
      )
      .run({
        messageId,
        status,
        toolResultJson: toolResultJson ?? null,
      });
  }

  async getWindow(conversationId: string): Promise<Message[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_messages
         WHERE conversation_id = ? AND in_window = 1
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

    const rows = this.db
      .prepare(
        `SELECT * FROM agent_messages
         WHERE conversation_id = @conversationId
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
    };
  }
}
