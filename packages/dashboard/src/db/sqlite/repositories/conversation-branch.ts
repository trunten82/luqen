/**
 * conversation-branch.ts — the one row insert, the one supersede, the reads of a conversation's newest
 * active rows and the edit and retry transactions, over the better-sqlite3 database. Each function
 * takes the database first; SqliteConversationRepository delegates to them.
 *
 * The active branch of a conversation is its rows whose status is not `superseded`, ordered by
 * created_at and then rowid (rows written in the same millisecond keep their insert order). "Latest"
 * always means the newest active row of that order, however long the conversation is.
 */
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { redactArgumentsJson } from '../../agent-audit-redaction.js';
import { WithdrawnAnswerError } from '../../interfaces/conversation-repository.js';
import type {
  AppendMessageInput,
  MessageRole,
  MessageStatus,
  ReplaceQuestionInput,
  RetryAnswerInput,
  RetryAnswerResult,
} from '../../interfaces/conversation-repository.js';

/** An agent_messages row, columns verbatim (snake_case). */
export interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string | null;
  tool_call_json: string | null;
  tool_result_json: string | null;
  status: MessageStatus;
  created_at: string;
  in_window: number;
  superseded_at?: string | null;
  images?: string | null;
}

/** The outcome of {@link replaceLatestQuestion}, with the stored question as a row. */
export type ReplaceQuestionRowResult =
  | {
      readonly ok: true;
      readonly newRow: MessageRow;
      readonly supersededMessageIds: readonly string[];
      readonly firstAssistantId: string | null;
    }
  | { readonly ok: false; readonly reason: 'conversation_not_found' | 'not_most_recent_user' };

/**
 * Inserts one message row and bumps its conversation's timestamps; a user row also maintains the rolling
 * window. Runs inside the caller's transaction. With `followsMessageId` the row is written only while the
 * followed row is on the active branch of a conversation that is not deleted; otherwise nothing is
 * written and WithdrawnAnswerError is thrown. Returns the new row's id.
 */
export function insertMessageRow(db: Database.Database, input: AppendMessageInput): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const status: MessageStatus = input.status ?? 'sent';

  // A row of an answer is written after the row it follows, and only while that row is on the active
  // branch (not superseded) of a conversation that is not deleted; otherwise nothing is written.
  if (input.followsMessageId !== undefined) {
    const followed = db.prepare(`
      SELECT 1 FROM agent_messages m
      JOIN agent_conversations c ON c.id = m.conversation_id
      WHERE m.id = @followsMessageId
        AND m.conversation_id = @conversationId
        AND m.status != 'superseded'
        AND c.is_deleted = 0
    `).get({ followsMessageId: input.followsMessageId, conversationId: input.conversationId });
    if (followed === undefined) throw new WithdrawnAnswerError();
  }

  const imagesJson =
    input.images !== undefined && input.images.length > 0
      ? JSON.stringify(input.images)
      : null;

  db.prepare(`
    INSERT INTO agent_messages
      (id, conversation_id, role, content, tool_call_json, tool_result_json, status, created_at, in_window, images)
    VALUES
      (@id, @conversationId, @role, @content, @toolCallJson, @toolResultJson, @status, @createdAt, 1, @images)
  `).run({
    id,
    conversationId: input.conversationId,
    role: input.role,
    content: input.content ?? null,
    // HARD-21: secret-named tool arguments are stored as [redacted], for every writer; a paused
    // action keeps its arguments as given until the write that resolves it.
    toolCallJson: input.toolCallJson === undefined
      ? null
      : status === 'pending_confirmation' ? input.toolCallJson : redactArgumentsJson(input.toolCallJson),
    toolResultJson: input.toolResultJson ?? null,
    status,
    createdAt: now,
    images: imagesJson,
  });
  db.prepare(`
    UPDATE agent_conversations
    SET updated_at = @now, last_message_at = @now
    WHERE id = @conversationId
  `).run({ now, conversationId: input.conversationId });

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
  // its created_at = now >= the boundary (strict-less comparison),
  // so it is never flipped by this UPDATE.
  if (input.role === 'user') {
    const boundaryRow = db.prepare(`
      SELECT created_at FROM agent_messages
      WHERE conversation_id = @conversationId AND role = 'user'
      ORDER BY created_at DESC
      LIMIT 1 OFFSET 19
    `).get({ conversationId: input.conversationId }) as { created_at: string } | undefined;
    if (boundaryRow !== undefined) {
      db.prepare(`
        UPDATE agent_messages
        SET in_window = 0
        WHERE conversation_id = @conversationId
          AND created_at < @boundary
          AND status NOT IN ('pending_confirmation', 'streaming')
      `).run({ conversationId: input.conversationId, boundary: boundaryRow.created_at });
    }
  }
  return id;
}

/**
 * Supersedes the given rows of a conversation in `orgId` (rows already superseded, of another
 * conversation or of another organization are not touched). A paused action superseded here leaves
 * pending_confirmation, so its stored arguments are redacted in the same transaction, as every other
 * write out of pending_confirmation does. Runs inside the caller's transaction; returns the rows changed.
 */
export function supersedeRows(
  db: Database.Database,
  messageIds: readonly string[],
  conversationId: string,
  orgId: string,
): number {
  if (messageIds.length === 0) return 0;
  const now = new Date().toISOString();
  // Build IN-list of placeholders. better-sqlite3 binds positional args.
  const placeholders = messageIds.map(() => '?').join(',');
  const target = `id IN (${placeholders})
      AND conversation_id = ?
      AND status != 'superseded'
      AND EXISTS (
        SELECT 1 FROM agent_conversations c
        WHERE c.id = agent_messages.conversation_id
          AND c.org_id = ?
      )`;
  const targetParams: unknown[] = [...messageIds, conversationId, orgId];
  const paused = db.prepare(
    `SELECT id, tool_call_json FROM agent_messages
     WHERE ${target} AND status = 'pending_confirmation' AND tool_call_json IS NOT NULL`,
  ).all(...targetParams) as Array<{ id: string; tool_call_json: string }>;
  const result = db.prepare(
    `UPDATE agent_messages
     SET status = 'superseded',
         superseded_at = ?
     WHERE ${target}`,
  ).run(now, ...targetParams);
  const storeRedactedCall = db.prepare('UPDATE agent_messages SET tool_call_json = ? WHERE id = ?');
  for (const row of paused) storeRedactedCall.run(redactArgumentsJson(row.tool_call_json), row.id);
  return result.changes;
}

/** The row `messageId` when it is an active row of the conversation. */
export function activeMessageRow(db: Database.Database, conversationId: string, messageId: string): MessageRow | undefined {
  return db.prepare(
    `SELECT * FROM agent_messages WHERE id = ? AND conversation_id = ? AND status != 'superseded'`,
  ).get(messageId, conversationId) as MessageRow | undefined;
}

/** The conversation's newest active row, of `role` when given. */
export function lastActiveRow(db: Database.Database, conversationId: string, role?: MessageRole): MessageRow | undefined {
  return (role === undefined
    ? db.prepare(
        `SELECT * FROM agent_messages WHERE conversation_id = ? AND status != 'superseded'
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      ).get(conversationId)
    : db.prepare(
        `SELECT * FROM agent_messages WHERE conversation_id = ? AND status != 'superseded' AND role = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      ).get(conversationId, role)) as MessageRow | undefined;
}

/**
 * The anchor (an active row of the conversation) and the `limit` newest active rows created at or before
 * it, oldest first; rows written in the anchor's millisecond are included. Null when the anchor is not an
 * active row of the conversation.
 */
export function activeBranchUpTo(
  db: Database.Database,
  conversationId: string,
  anchorMessageId: string,
  limit: number,
): { readonly anchor: MessageRow; readonly rows: readonly MessageRow[] } | null {
  const anchor = activeMessageRow(db, conversationId, anchorMessageId);
  if (anchor === undefined) return null;
  const newestFirst = db.prepare(
    `SELECT * FROM agent_messages
     WHERE conversation_id = ? AND status != 'superseded' AND created_at <= ?
     ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  ).all(conversationId, anchor.created_at, limit) as MessageRow[];
  return { anchor, rows: [...newestFirst].reverse() };
}

/** The steps of {@link replaceLatestQuestion}, run inside its transaction. */
function replaceInTransaction(db: Database.Database, input: ReplaceQuestionInput): ReplaceQuestionRowResult {
  const conversation = db.prepare('SELECT id FROM agent_conversations WHERE id = ? AND org_id = ? AND is_deleted = 0')
    .get(input.conversationId, input.orgId);
  if (conversation === undefined) return { ok: false, reason: 'conversation_not_found' };
  const latest = lastActiveRow(db, input.conversationId, 'user');
  if (latest === undefined || latest.id !== input.messageId) return { ok: false, reason: 'not_most_recent_user' };
  // The question and its whole answer: every active row from the question on, in branch order.
  const withdrawn = db.prepare(
    `SELECT id, role FROM agent_messages
     WHERE conversation_id = @conversationId AND status != 'superseded'
       AND (created_at > @createdAt
            OR (created_at = @createdAt AND rowid >= (SELECT rowid FROM agent_messages WHERE id = @messageId)))
     ORDER BY created_at, rowid`,
  ).all({ conversationId: input.conversationId, createdAt: latest.created_at, messageId: input.messageId }) as Array<{ id: string; role: string }>;
  const supersededMessageIds = withdrawn.map((r) => r.id);
  supersedeRows(db, supersededMessageIds, input.conversationId, input.orgId);
  const newId = insertMessageRow(db, { conversationId: input.conversationId, role: 'user', content: input.content, status: 'sent' });
  const newRow = db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(newId) as MessageRow;
  const firstAssistant = withdrawn.find((r) => r.role === 'assistant');
  return { ok: true, newRow, supersededMessageIds, firstAssistantId: firstAssistant?.id ?? null };
}

/**
 * Replaces the conversation's latest question in one transaction: the conversation is in `orgId`, the
 * newest active user row is `messageId`, the question and every active row after it are superseded and
 * the new question is stored. A refusal writes nothing; an insert that fails rolls the supersede back.
 */
export function replaceLatestQuestion(db: Database.Database, input: ReplaceQuestionInput): ReplaceQuestionRowResult {
  return db.transaction(() => replaceInTransaction(db, input))();
}

/**
 * Supersedes the conversation's latest answer in one transaction, only when the conversation is in
 * `orgId` and not deleted and `messageId` is an active row of the conversation, is its newest assistant row and is its newest row of any role (a reply that a tool
 * result or an action awaiting confirmation follows is not retried). A refusal writes nothing.
 */
export function supersedeLatestAnswer(db: Database.Database, input: RetryAnswerInput): RetryAnswerResult {
  return db.transaction((): RetryAnswerResult => {
    // The conversation is checked first, here and not only by the route: a deleted conversation is
    // refused with nothing written, whatever deleted it between the route's check and this transaction.
    const conversation = db.prepare('SELECT id FROM agent_conversations WHERE id = ? AND org_id = ? AND is_deleted = 0')
      .get(input.conversationId, input.orgId);
    if (conversation === undefined) return { ok: false, reason: 'conversation_not_found' };
    if (activeMessageRow(db, input.conversationId, input.messageId) === undefined) {
      return { ok: false, reason: 'message_not_found' };
    }
    const lastAssistant = lastActiveRow(db, input.conversationId, 'assistant');
    if (lastAssistant === undefined || lastAssistant.id !== input.messageId) {
      return { ok: false, reason: 'not_most_recent_assistant' };
    }
    const lastRow = lastActiveRow(db, input.conversationId);
    if (lastRow === undefined || lastRow.id !== input.messageId) return { ok: false, reason: 'not_last_message' };
    if (supersedeRows(db, [input.messageId], input.conversationId, input.orgId) === 0) {
      return { ok: false, reason: 'message_not_found' };
    }
    return { ok: true };
  })();
}
