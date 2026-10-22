// ---------------------------------------------------------------------------
// Issue dismissals ("Mark as false positive") — Phase 87 (FP-01..03)
//
// Types live here rather than in db/types.ts, which is over its size cap.
// ---------------------------------------------------------------------------

export type IssueDismissalStatus = 'active' | 'revoked';

/**
 * The marking API key as it was when the finding was marked (HARD-08): its label and its creation
 * time. Never the api_keys row id or the secret. Stored only for a key of the scan's own org.
 */
export interface DismissalKeySnapshot {
  readonly label: string;
  readonly keyCreatedAt: string;
}

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
  /** HARD-08: the marking key's label and creation time; null when none was stored. */
  readonly createdByKeySnapshot?: DismissalKeySnapshot | null;
}

export type IssueDismissalAction = 'mark' | 'revoke';

/**
 * The audit actions the dismissal store writes (one audit row inside mark, one inside revoke), and
 * the resource type of those rows. The Audit Log Action filter lists exactly these values, and a
 * test fails when a dismissal action literal appears in src outside this constant, so a new action
 * cannot be written without being declared here (Phase 95, AUD-02).
 */
export const ISSUE_DISMISSAL_AUDIT_ACTIONS = {
  mark: 'issue_dismissal.mark',
  revoke: 'issue_dismissal.revoke',
} as const;

export type IssueDismissalAuditAction =
  (typeof ISSUE_DISMISSAL_AUDIT_ACTIONS)[keyof typeof ISSUE_DISMISSAL_AUDIT_ACTIONS];

export const ISSUE_DISMISSAL_AUDIT_RESOURCE_TYPE = 'issue_dismissal';

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
  /** HARD-08: set only for an API key of the scan's own org; anything else stores none. */
  readonly actorKeySnapshot?: DismissalKeySnapshot | null;
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
