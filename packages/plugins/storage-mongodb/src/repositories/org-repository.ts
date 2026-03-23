import type { Collection, Db } from 'mongodb';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: string;
}

interface OrgMember {
  readonly orgId: string;
  readonly userId: string;
  readonly role: string;
  readonly joinedAt: string;
}

// ---------------------------------------------------------------------------
// MongoDB document type — members embedded as sub-array
// ---------------------------------------------------------------------------

interface OrgMemberDoc {
  userId: string;
  role: string;
  joinedAt: string;
}

interface OrgDoc {
  _id: string;
  name: string;
  slug: string;
  createdAt: string;
  members: OrgMemberDoc[];
}

function docToOrg(doc: OrgDoc): Organization {
  return { id: doc._id, name: doc.name, slug: doc.slug, createdAt: doc.createdAt };
}

function memberDocToMember(orgId: string, m: OrgMemberDoc): OrgMember {
  return { orgId, userId: m.userId, role: m.role, joinedAt: m.joinedAt };
}

// ---------------------------------------------------------------------------
// MongoOrgRepository
// ---------------------------------------------------------------------------

export class MongoOrgRepository {
  private readonly collection: Collection<OrgDoc>;

  constructor(db: Db) {
    this.collection = db.collection<OrgDoc>('organizations');
  }

  async createOrg(data: { name: string; slug: string }): Promise<Organization> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const doc: OrgDoc = {
      _id: id,
      name: data.name,
      slug: data.slug,
      createdAt,
      members: [],
    };

    await this.collection.insertOne(doc);
    return { id, name: data.name, slug: data.slug, createdAt };
  }

  async getOrg(id: string): Promise<Organization | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc !== null ? docToOrg(doc) : null;
  }

  async getOrgBySlug(slug: string): Promise<Organization | null> {
    const doc = await this.collection.findOne({ slug });
    return doc !== null ? docToOrg(doc) : null;
  }

  async listOrgs(): Promise<Organization[]> {
    const docs = await this.collection.find({}).sort({ createdAt: 1 }).toArray();
    return docs.map(docToOrg);
  }

  async deleteOrg(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: id });
  }

  async addMember(orgId: string, userId: string, role: string): Promise<OrgMember> {
    const joinedAt = new Date().toISOString();
    const memberDoc: OrgMemberDoc = { userId, role, joinedAt };

    await this.collection.updateOne(
      { _id: orgId },
      { $push: { members: memberDoc } },
    );

    return { orgId, userId, role, joinedAt };
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    await this.collection.updateOne(
      { _id: orgId },
      { $pull: { members: { userId } } },
    );
  }

  async listMembers(orgId: string): Promise<OrgMember[]> {
    const doc = await this.collection.findOne({ _id: orgId });
    if (doc === null) return [];
    return doc.members.map((m) => memberDocToMember(orgId, m));
  }

  async getUserOrgs(userId: string): Promise<Organization[]> {
    const docs = await this.collection
      .find({ 'members.userId': userId })
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map(docToOrg);
  }
}
