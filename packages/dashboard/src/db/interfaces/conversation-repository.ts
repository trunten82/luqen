/**
 * ConversationRepository — Phase 31 (APER-01).
 *
 * Persists agent chat threads and messages with a rolling-window policy
 * enforced at write-time inside `appendMessage`.
 *
 * Rolling-window policy (from 31-CONTEXT.md):
 *   A "turn" starts at each `role='user'` message. The window is the last
 *   20 turns. When a 21st user message is appended, messages older than
 *   the window boundary flip to `in_window = 0`, EXCEPT messages whose
 *   status is `'pending_confirmation'` or `'streaming'` — those stay
 *   in-window so the UX (destructive-tool approval, live token stream)
 *   remains readable after restart.
 *
 * Security (T-31-01 / T-31-02): cross-org reads are blocked by
 * `getConversation(id, orgId)` returning null for mismatched org and
 * `listForUser(userId, orgId, …)` filtering on both user_id AND org_id.
 * T-31-03 (who may flip another user's `pending_confirmation`) is a
 * Phase 32 service-layer concern — this DB layer does not gate
 * `updateMessageStatus` by userId.
 */

export type MessageRole = 'user' | 'assistant' | 'tool';

export type MessageStatus =
  | 'sent'
  | 'pending_confirmation'
  | 'approved'
  | 'denied'
  | 'failed'
  | 'streaming';

export interface Conversation {
  readonly id: string;
  readonly userId: string;
  readonly orgId: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastMessageAt: string | null;
  readonly isDeleted: boolean;
  readonly deletedAt: string | null;
}

/**
 * Phase 35 Plan 01 (AHIST-02): search conversations by title + message content.
 * Always scoped to `user_id = current_user AND org_id = current_org AND is_deleted = 0`.
 * The `query` is bound via prepared statement; `%`, `_`, `\` are escaped before binding.
 */
export interface SearchConversationsOptions {
  readonly query: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ConversationSearchHit {
  readonly conversation: Conversation;
  readonly snippet: string;
  readonly matchField: 'title' | 'content';
}

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content: string | null;
  readonly toolCallJson: string | null;
  readonly toolResultJson: string | null;
  readonly status: MessageStatus;
  readonly createdAt: string;
  readonly inWindow: boolean;
}

export interface CreateConversationInput {
  readonly userId: string;
  readonly orgId: string;
  readonly title?: string;
}

export interface AppendMessageInput {
  readonly conversationId: string;
  readonly role: MessageRole;
  readonly content?: string;
  readonly toolCallJson?: string;
  readonly toolResultJson?: string;
  /** Defaults to 'sent'. */
  readonly status?: MessageStatus;
}

export interface ListConversationsOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export interface ConversationRepository {
  createConversation(input: CreateConversationInput): Promise<Conversation>;

  /**
   * Org-scoped lookup. Returns null if the conversation exists but
   * belongs to a different org (mitigates T-31-01).
   */
  getConversation(id: string, orgId: string): Promise<Conversation | null>;

  /**
   * Lists a user's conversations within a single org, ordered by
   * `last_message_at DESC` (nulls last via `COALESCE(last_message_at, created_at)`).
   */
  listForUser(
    userId: string,
    orgId: string,
    options?: ListConversationsOptions,
  ): Promise<Conversation[]>;

  /**
   * Appends a message and bumps the parent conversation's `updated_at` +
   * `last_message_at` in a single transaction. When `role === 'user'`,
   * also maintains the rolling-window flag on older messages.
   */
  appendMessage(input: AppendMessageInput): Promise<Message>;

  /**
   * Transitions a message's status. The optional `toolResultJson` is
   * persisted via `COALESCE(?, tool_result_json)` so callers may update
   * status without touching an existing result payload.
   *
   * NOTE: no userId / orgId guard — Phase 32's AgentService is
   * responsible for verifying the caller owns the message (T-31-03).
   */
  updateMessageStatus(
    messageId: string,
    status: MessageStatus,
    toolResultJson?: string,
  ): Promise<void>;

  /** Rolling-window read: `in_window = 1` only, ordered `created_at ASC`. */
  getWindow(conversationId: string): Promise<Message[]>;

  /** Full history including `in_window = 0` rows. Paginated (default 200). */
  getFullHistory(
    conversationId: string,
    options?: ListConversationsOptions,
  ): Promise<Message[]>;

  /**
   * Phase 33-03: flip every message row older than `beforeCreatedAt` to
   * `in_window = 0` EXCEPT rows whose status is 'pending_confirmation' or
   * 'streaming' (those are pinned in-window by the same rule enforced in
   * appendMessage's rolling-window maintenance).
   */
  markOutOfWindowBefore(
    conversationId: string,
    beforeCreatedAt: string,
  ): Promise<void>;

  /**
   * Phase 35 Plan 01 (AHIST-02): Search user's non-deleted conversations by
   * title or message content. Case-insensitive. Always applies
   * `user_id = @userId AND org_id = @orgId AND is_deleted = 0`.
   */
  searchForUser(
    userId: string,
    orgId: string,
    options: SearchConversationsOptions,
  ): Promise<ConversationSearchHit[]>;

  /**
   * Phase 35 Plan 01 (AHIST-03): Update conversation title. Org-guarded:
   * mismatched orgId returns null and does not write. Soft-deleted
   * conversations cannot be renamed.
   */
  renameConversation(
    id: string,
    orgId: string,
    title: string,
  ): Promise<Conversation | null>;

  /**
   * Phase 35 Plan 01 (AHIST-04): Soft-delete a conversation. Sets
   * is_deleted=1, deleted_at=now(). Returns true on success, false if
   * already deleted, not found, or wrong org.
   */
  softDeleteConversation(id: string, orgId: string): Promise<boolean>;
}
