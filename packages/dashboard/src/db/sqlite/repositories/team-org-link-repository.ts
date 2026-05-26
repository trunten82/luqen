import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  TeamOrgLink,
  TeamOrgLinkInvite,
  TeamOrgLinkInviteStatus,
  TeamOrgLinkRepository,
} from '../../interfaces/team-org-link-repository.js';

interface LinkRow {
  team_id: string;
  org_id: string;
  linked_at: string;
  linked_by: string | null;
}

interface InviteRow {
  id: string;
  team_id: string;
  target_org_id: string;
  invited_by: string;
  status: TeamOrgLinkInviteStatus;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

function linkRowToRecord(row: LinkRow): TeamOrgLink {
  return {
    teamId: row.team_id,
    orgId: row.org_id,
    linkedAt: row.linked_at,
    linkedBy: row.linked_by,
  };
}

function inviteRowToRecord(row: InviteRow): TeamOrgLinkInvite {
  return {
    id: row.id,
    teamId: row.team_id,
    targetOrgId: row.target_org_id,
    invitedBy: row.invited_by,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
  };
}

export class SqliteTeamOrgLinkRepository implements TeamOrgLinkRepository {
  constructor(private readonly db: Database.Database) {}

  async listLinksForTeam(teamId: string): Promise<readonly TeamOrgLink[]> {
    const rows = this.db
      .prepare('SELECT * FROM team_org_links WHERE team_id = ? ORDER BY linked_at DESC')
      .all(teamId) as LinkRow[];
    return rows.map(linkRowToRecord);
  }

  async listLinksForOrg(orgId: string): Promise<readonly TeamOrgLink[]> {
    const rows = this.db
      .prepare('SELECT * FROM team_org_links WHERE org_id = ? ORDER BY linked_at DESC')
      .all(orgId) as LinkRow[];
    return rows.map(linkRowToRecord);
  }

  async getLink(teamId: string, orgId: string): Promise<TeamOrgLink | null> {
    const row = this.db
      .prepare('SELECT * FROM team_org_links WHERE team_id = ? AND org_id = ?')
      .get(teamId, orgId) as LinkRow | undefined;
    return row ? linkRowToRecord(row) : null;
  }

  async link(teamId: string, orgId: string, linkedBy: string): Promise<TeamOrgLink> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO team_org_links (team_id, org_id, linked_at, linked_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (team_id, org_id) DO NOTHING`,
      )
      .run(teamId, orgId, now, linkedBy);
    const row = this.db
      .prepare('SELECT * FROM team_org_links WHERE team_id = ? AND org_id = ?')
      .get(teamId, orgId) as LinkRow;
    return linkRowToRecord(row);
  }

  async unlink(teamId: string, orgId: string): Promise<boolean> {
    const result = this.db
      .prepare('DELETE FROM team_org_links WHERE team_id = ? AND org_id = ?')
      .run(teamId, orgId);
    return result.changes > 0;
  }

  async inviteCreate(
    teamId: string,
    targetOrgId: string,
    invitedBy: string,
  ): Promise<TeamOrgLinkInvite | null> {
    const id = `tinv_${randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO team_org_link_invites
             (id, team_id, target_org_id, invited_by, status, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?)`,
        )
        .run(id, teamId, targetOrgId, invitedBy, now);
    } catch (err) {
      // Unique partial index on (team_id, target_org_id) WHERE status='pending'
      // rejects a second pending invite. Surface as null; caller can read the
      // existing one via inviteListByTeam.
      if (err instanceof Error && /UNIQUE/i.test(err.message)) return null;
      throw err;
    }
    return inviteRowToRecord({
      id,
      team_id: teamId,
      target_org_id: targetOrgId,
      invited_by: invitedBy,
      status: 'pending',
      created_at: now,
      decided_at: null,
      decided_by: null,
    });
  }

  async inviteListByTeam(teamId: string): Promise<readonly TeamOrgLinkInvite[]> {
    const rows = this.db
      .prepare('SELECT * FROM team_org_link_invites WHERE team_id = ? ORDER BY created_at DESC')
      .all(teamId) as InviteRow[];
    return rows.map(inviteRowToRecord);
  }

  async inviteListPendingForOrg(targetOrgId: string): Promise<readonly TeamOrgLinkInvite[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM team_org_link_invites
         WHERE target_org_id = ? AND status = 'pending'
         ORDER BY created_at DESC`,
      )
      .all(targetOrgId) as InviteRow[];
    return rows.map(inviteRowToRecord);
  }

  async inviteGet(inviteId: string): Promise<TeamOrgLinkInvite | null> {
    const row = this.db
      .prepare('SELECT * FROM team_org_link_invites WHERE id = ?')
      .get(inviteId) as InviteRow | undefined;
    return row ? inviteRowToRecord(row) : null;
  }

  async inviteAccept(inviteId: string, decidedBy: string): Promise<TeamOrgLink | null> {
    const invite = (await this.inviteGet(inviteId)) ?? null;
    if (invite === null) return null;
    if (invite.status === 'accepted') return this.getLink(invite.teamId, invite.targetOrgId);
    if (invite.status !== 'pending') return null;
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE team_org_link_invites
             SET status='accepted', decided_at=?, decided_by=?
           WHERE id=? AND status='pending'`,
        )
        .run(now, decidedBy, inviteId);
      this.db
        .prepare(
          `INSERT INTO team_org_links (team_id, org_id, linked_at, linked_by)
             VALUES (?, ?, ?, ?)
           ON CONFLICT (team_id, org_id) DO NOTHING`,
        )
        .run(invite.teamId, invite.targetOrgId, now, decidedBy);
    });
    tx();
    return this.getLink(invite.teamId, invite.targetOrgId);
  }

  async inviteDecline(inviteId: string, decidedBy: string): Promise<TeamOrgLinkInvite | null> {
    return this.inviteSetStatus(inviteId, 'declined', decidedBy);
  }

  async inviteRevoke(inviteId: string, decidedBy: string): Promise<TeamOrgLinkInvite | null> {
    return this.inviteSetStatus(inviteId, 'revoked', decidedBy);
  }

  private async inviteSetStatus(
    inviteId: string,
    status: 'declined' | 'revoked',
    decidedBy: string,
  ): Promise<TeamOrgLinkInvite | null> {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE team_org_link_invites
           SET status=?, decided_at=?, decided_by=?
         WHERE id=? AND status='pending'`,
      )
      .run(status, now, decidedBy, inviteId);
    if (result.changes === 0) return null;
    return this.inviteGet(inviteId);
  }
}
