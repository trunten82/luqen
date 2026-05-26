/**
 * Phase 62.1 — Multi-team RBAC overlay.
 *
 * A team's home org lives on `teams.org_id`. `TeamOrgLinkRepository` manages
 * the additional org-scope grants: invites issued by the team's home-org
 * admin and accepted by the target org's admin, plus the resulting active
 * links that `resolveEffectiveRoles()` uses to MAX-aggregate roles across
 * orgs.
 */

export type TeamOrgLinkInviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface TeamOrgLink {
  readonly teamId: string;
  readonly orgId: string;
  readonly linkedAt: string;
  readonly linkedBy: string | null;
}

export interface TeamOrgLinkInvite {
  readonly id: string;
  readonly teamId: string;
  readonly targetOrgId: string;
  readonly invitedBy: string;
  readonly status: TeamOrgLinkInviteStatus;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
}

export interface TeamOrgLinkRepository {
  /** Active links for a single team. */
  listLinksForTeam(teamId: string): Promise<readonly TeamOrgLink[]>;
  /** Active links pointing at a single org (= "which teams reach into this org?"). */
  listLinksForOrg(orgId: string): Promise<readonly TeamOrgLink[]>;
  /** Best-effort lookup; returns null when no active link exists. */
  getLink(teamId: string, orgId: string): Promise<TeamOrgLink | null>;
  /** Idempotent. Used by inviteAccept(). Direct callers must be on the team's home-org admin. */
  link(teamId: string, orgId: string, linkedBy: string): Promise<TeamOrgLink>;
  /** Revoke an active link. Returns true if a row was removed. */
  unlink(teamId: string, orgId: string): Promise<boolean>;

  /** Issue a new pending invite. Fails (returns null) if one already exists for the same (team, target) in pending state. */
  inviteCreate(teamId: string, targetOrgId: string, invitedBy: string): Promise<TeamOrgLinkInvite | null>;
  /** Invites issued by a team's home org (pending + historical). */
  inviteListByTeam(teamId: string): Promise<readonly TeamOrgLinkInvite[]>;
  /** Invites awaiting decision in a specific org. */
  inviteListPendingForOrg(targetOrgId: string): Promise<readonly TeamOrgLinkInvite[]>;
  inviteGet(inviteId: string): Promise<TeamOrgLinkInvite | null>;
  /** Idempotent: re-accepting an already-accepted invite is a no-op. Returns the active link on success. */
  inviteAccept(inviteId: string, decidedBy: string): Promise<TeamOrgLink | null>;
  inviteDecline(inviteId: string, decidedBy: string): Promise<TeamOrgLinkInvite | null>;
  inviteRevoke(inviteId: string, decidedBy: string): Promise<TeamOrgLinkInvite | null>;
}
