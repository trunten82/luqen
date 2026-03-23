import type { Collection, Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface DashboardUser {
  readonly id: string;
  readonly username: string;
  readonly role: 'admin' | 'developer' | 'editor' | 'user' | 'viewer' | 'executive';
  readonly active: boolean;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// MongoDB document type
// ---------------------------------------------------------------------------

interface UserDoc {
  _id: string;
  username: string;
  passwordHash: string;
  role: string;
  active: boolean;
  createdAt: string;
}

const BCRYPT_ROUNDS = 10;

function docToUser(doc: UserDoc): DashboardUser {
  return {
    id: doc._id,
    username: doc.username,
    role: doc.role as DashboardUser['role'],
    active: doc.active,
    createdAt: doc.createdAt,
  };
}

// ---------------------------------------------------------------------------
// MongoUserRepository
// ---------------------------------------------------------------------------

export class MongoUserRepository {
  private readonly collection: Collection<UserDoc>;

  constructor(db: Db) {
    this.collection = db.collection<UserDoc>('dashboard_users');
  }

  async createUser(username: string, password: string, role: string): Promise<DashboardUser> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const doc: UserDoc = {
      _id: id,
      username,
      passwordHash,
      role,
      active: true,
      createdAt,
    };

    await this.collection.insertOne(doc);

    const created = await this.getUserById(id);
    if (created === null) {
      throw new Error(`Failed to retrieve user after creation: ${id}`);
    }
    return created;
  }

  async getUserByUsername(username: string): Promise<DashboardUser | null> {
    const doc = await this.collection.findOne({ username });
    return doc !== null ? docToUser(doc) : null;
  }

  async getUserById(id: string): Promise<DashboardUser | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc !== null ? docToUser(doc) : null;
  }

  async verifyPassword(username: string, password: string): Promise<boolean> {
    const doc = await this.collection.findOne({ username });
    if (doc === null || !doc.active) {
      return false;
    }
    return bcrypt.compare(password, doc.passwordHash);
  }

  async listUsers(): Promise<DashboardUser[]> {
    const docs = await this.collection
      .find({})
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map(docToUser);
  }

  async updateUserRole(id: string, role: string): Promise<void> {
    await this.collection.updateOne({ _id: id }, { $set: { role } });
  }

  async deactivateUser(id: string): Promise<void> {
    await this.collection.updateOne({ _id: id }, { $set: { active: false } });
  }

  async activateUser(id: string): Promise<void> {
    await this.collection.updateOne({ _id: id }, { $set: { active: true } });
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.collection.updateOne({ _id: id }, { $set: { passwordHash } });
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  async countUsers(): Promise<number> {
    return this.collection.countDocuments();
  }
}
