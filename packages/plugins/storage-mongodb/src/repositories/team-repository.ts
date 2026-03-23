import type { Collection, Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface Team {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly orgId: string;
  readonly createdAt: string;
  readonly memberCount?: number;
  readonly members?: ReadonlyArray<TeamMember>;
}

interface TeamMember {
  readonly userId: string;
  readonly username: string;
  readonly role: string;
}

// ---------------------------------------------------------------------------
// MongoDB document type — members embedded as sub-array
// ---------------------------------------------------------------------------

interface TeamMemberDoc {
  userId: string;
  role: string;
}

interface TeamDoc {
  _id: string;
  name: string;
  description: string;
  orgId: string;
  createdAt: string;
  members: TeamMemberDoc[];
}

function docToRecord(doc: TeamDoc, resolvedMembers?: TeamMember[]): Team {
  const base: Team = {
    id: doc._id,
    name: doc.name,
    description: doc.description,
    orgId: doc.orgId,
    createdAt: doc.createdAt,
    memberCount: doc.members.length,
  };

  if (resolvedMembers !== undefined) {
    return { ...base, members: resolvedMembers };
  }
  return base;
}

// ---------------------------------------------------------------------------
// MongoTeamRepository
// ---------------------------------------------------------------------------

export class MongoTeamRepository {
  private readonly collection: Collection<TeamDoc>;
  private readonly usersCollection: Collection<{ _id: string; username: string }>;

  constructor(db: Db) {
    this.collection = db.collection<TeamDoc>('teams');
    this.usersCollection = db.collection('dashboard_users');
  }

  async listTeams(orgId?: string): Promise<Team[]> {
    const query = orgId !== undefined
      ? { $or: [{ orgId }, { orgId: 'system' }] }
      : {};
    const docs = await this.collection.find(query).sort({ name: 1 }).toArray();
    return docs.map((doc) => docToRecord(doc));
  }

  async getTeam(id: string): Promise<Team | null> {
    const doc = await this.collection.findOne({ _id: id });
    if (doc === null) return null;

    const members = await this.resolveMembers(doc.members);
    return docToRecord(doc, members);
  }

  async getTeamByName(name: string, orgId?: string): Promise<Team | null> {
    const query = orgId !== undefined ? { name, orgId } : { name };
    const doc = await this.collection.findOne(query);
    if (doc === null) return null;

    const members = await this.resolveMembers(doc.members);
    return docToRecord(doc, members);
  }

  async createTeam(data: {
    readonly name: string;
    readonly description: string;
    readonly orgId: string;
  }): Promise<Team> {
    const id = `team-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const doc: TeamDoc = {
      _id: id,
      name: data.name,
      description: data.description,
      orgId: data.orgId,
      createdAt: now,
      members: [],
    };

    await this.collection.insertOne(doc);

    const created = await this.getTeam(id);
    if (created === null) {
      throw new Error(`Failed to retrieve team after creation: ${id}`);
    }
    return created;
  }

  async updateTeam(id: string, data: {
    readonly name?: string;
    readonly description?: string;
  }): Promise<void> {
    const setFields: Record<string, unknown> = {};

    if (data.name !== undefined) setFields['name'] = data.name;
    if (data.description !== undefined) setFields['description'] = data.description;

    if (Object.keys(setFields).length === 0) return;

    await this.collection.updateOne({ _id: id }, { $set: setFields });
  }

  async deleteTeam(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: id });
  }

  async addTeamMember(teamId: string, userId: string, role = 'member'): Promise<void> {
    // Only add if not already a member
    const existing = await this.collection.findOne({
      _id: teamId,
      'members.userId': userId,
    });

    if (existing !== null) return;

    await this.collection.updateOne(
      { _id: teamId },
      { $push: { members: { userId, role } } },
    );
  }

  async removeTeamMember(teamId: string, userId: string): Promise<void> {
    await this.collection.updateOne(
      { _id: teamId },
      { $pull: { members: { userId } } },
    );
  }

  async listTeamMembers(teamId: string): Promise<TeamMember[]> {
    const doc = await this.collection.findOne({ _id: teamId });
    if (doc === null) return [];
    return this.resolveMembers(doc.members);
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async resolveMembers(memberDocs: TeamMemberDoc[]): Promise<TeamMember[]> {
    if (memberDocs.length === 0) return [];

    const userIds = memberDocs.map((m) => m.userId);
    const users = await this.usersCollection
      .find({ _id: { $in: userIds } })
      .toArray();

    const userMap = new Map(users.map((u) => [u._id, u.username]));

    return memberDocs
      .map((m) => ({
        userId: m.userId,
        username: userMap.get(m.userId) ?? m.userId,
        role: m.role,
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }
}
