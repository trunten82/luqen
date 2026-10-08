// ---------------------------------------------------------------------------
// Issue dismissals ("Mark as false positive") — Phase 87 (FP-01..03)
//
// Types live here rather than in db/types.ts, which is over its size cap.
// ---------------------------------------------------------------------------

export type IssueDismissalStatus = 'active' | 'revoked';

export interface IssueDismissal {
  readonly id: string;
  readonly orgId: string;
  /** Raw site URL as entered by the user (display / audit). */
  readonly siteUrl: string;
  /** Normalised site key used for matching (D-02). */
  readonly siteKey: string;
  readonly code: string;
  readonly selector: string;
  readonly reason: string;
  readonly status: IssueDismissalStatus;
  readonly createdBy: string;
  readonly createdById: string | null;
  readonly createdAt: string;
  readonly revokedBy: string | null;
  readonly revokedById: string | null;
  readonly revokedAt: string | null;
  readonly revokeComment: string | null;
}

export type IssueDismissalAction = 'mark' | 'revoke';

export interface IssueDismissalEvent {
  readonly id: string;
  readonly dismissalId: string;
  readonly orgId: string;
  readonly action: IssueDismissalAction;
  readonly actor: string;
  readonly actorId: string | null;
  readonly at: string;
  /** The reason (mark) or the optional comment (revoke). */
  readonly text: string | null;
}

export interface MarkIssueDismissalInput {
  readonly orgId: string;
  readonly siteUrl: string;
  readonly siteKey: string;
  readonly code: string;
  readonly selector: string;
  readonly reason: string;
  readonly actor: string;
  readonly actorId?: string;
  readonly ipAddress?: string;
}

export type MarkIssueDismissalResult =
  | { readonly kind: 'created'; readonly dismissal: IssueDismissal }
  | { readonly kind: 'conflict'; readonly existing: IssueDismissal };

export interface RevokeIssueDismissalInput {
  readonly id: string;
  readonly orgId: string;
  readonly actor: string;
  readonly actorId?: string;
  readonly comment: string | null;
  readonly ipAddress?: string;
}

export type RevokeIssueDismissalResult =
  | { readonly kind: 'revoked'; readonly dismissal: IssueDismissal }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'already-revoked'; readonly dismissal: IssueDismissal };

/**
 * Persistence for issue dismissals and their append-only history.
 *
 * There is deliberately no delete method for dismissals and no update or
 * delete method for events: the history is append-only by construction (D-03).
 */
export interface IssueDismissalRepository {
  /** Mark an issue; state, history event and audit row commit atomically. */
  mark(input: MarkIssueDismissalInput): Promise<MarkIssueDismissalResult>;
  /** Revoke an active dismissal of the given org; the row is kept. */
  revoke(input: RevokeIssueDismissalInput): Promise<RevokeIssueDismissalResult>;
  getById(id: string): Promise<IssueDismissal | null>;
  /** Active dismissals for one org + site key, created_at ASC. */
  listActiveForSite(orgId: string, siteKey: string): Promise<readonly IssueDismissal[]>;
  /** Active and revoked dismissals for one org + site key, created_at DESC. */
  listForSite(orgId: string, siteKey: string): Promise<readonly IssueDismissal[]>;
  /** History of one dismissal, oldest first. */
  listEvents(dismissalId: string): Promise<readonly IssueDismissalEvent[]>;
}
