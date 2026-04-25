/**
 * ShareLinkRepository — Phase 37 Plan 01 (AUX-05).
 *
 * Persistence primitive for org-scoped read-only conversation permalinks.
 * Tokens are unguessable base64url strings produced from
 * crypto.randomBytes(16) (≥128 bits of entropy, T-37-03 mitigation).
 *
 * Trust boundary note (T-37-02 disposition):
 *   getShareLink intentionally does NOT enforce an org check — the repo
 *   simply hides revoked rows. The route handler (Plan 04) is responsible
 *   for verifying the requesting session belongs to the conversation's
 *   org_id before rendering the snapshot.
 */

export interface ShareLink {
  /** 22-char base64url token, ≥128 bits of entropy. */
  readonly id: string;
  readonly conversationId: string;
  readonly orgId: string;
  readonly anchorMessageId: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface CreateShareLinkInput {
  readonly conversationId: string;
  readonly orgId: string;
  readonly anchorMessageId: string | null;
  readonly createdByUserId: string;
}

export interface ShareLinkRepository {
  /**
   * Creates a new share link with a freshly-generated unguessable id and
   * returns the persisted row.
   */
  createShareLink(input: CreateShareLinkInput): Promise<ShareLink>;

  /**
   * Returns the link by id. Returns null if missing OR if revoked_at is
   * non-null. NOT org-guarded — caller (route handler) must check.
   */
  getShareLink(id: string): Promise<ShareLink | null>;

  /**
   * Org-scoped list of non-revoked links for a conversation.
   */
  listForConversation(
    conversationId: string,
    orgId: string,
  ): Promise<ShareLink[]>;

  /**
   * Sets revoked_at = now() iff the link exists, currently has
   * revoked_at = NULL, and belongs to `orgId`. Returns true on update,
   * false on miss / wrong org / already revoked.
   */
  revokeShareLink(id: string, orgId: string): Promise<boolean>;
}
