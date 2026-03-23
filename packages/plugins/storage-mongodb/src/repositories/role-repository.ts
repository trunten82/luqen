import type { Collection, Db } from 'mongodb';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface Role {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isSystem: boolean;
  readonly orgId: string;
  readonly createdAt: string;
  readonly permissions: readonly string[];
}

// ---------------------------------------------------------------------------
// MongoDB document type — permissions embedded as sub-array
// ---------------------------------------------------------------------------

interface RoleDoc {
  _id: string;
  name: string;
  description: string;
  isSystem: boolean;
  orgId: string;
  createdAt: string;
  permissions: string[];
}

function docToRecord(doc: RoleDoc): Role {
  return {
    id: doc._id,
    name: doc.name,
    description: doc.description,
    isSystem: doc.isSystem,
    orgId: doc.orgId,
    createdAt: doc.createdAt,
    permissions: doc.permissions,
  };
}

// ---------------------------------------------------------------------------
// MongoRoleRepository
// ---------------------------------------------------------------------------

export class MongoRoleRepository {
  private readonly collection: Collection<RoleDoc>;
  private readonly usersCollection: Collection<{ _id: string; role: string }>;

  constructor(db: Db) {
    this.collection = db.collection<RoleDoc>('roles');
    this.usersCollection = db.collection('dashboard_users');
  }

  async listRoles(orgId?: string): Promise<Role[]> {
    const query = orgId !== undefined
      ? { $or: [{ orgId }, { orgId: 'system' }] }
      : {};
    const docs = await this.collection
      .find(query)
      .sort({ isSystem: -1, name: 1 })
      .toArray();
    return docs.map(docToRecord);
  }

  async getRole(id: string): Promise<Role | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc !== null ? docToRecord(doc) : null;
  }

  async getRoleByName(name: string): Promise<Role | null> {
    const doc = await this.collection.findOne({ name });
    return doc !== null ? docToRecord(doc) : null;
  }

  async getRolePermissions(roleId: string): Promise<string[]> {
    const doc = await this.collection.findOne({ _id: roleId });
    if (doc === null) return [];
    return [...doc.permissions].sort();
  }

  async createRole(data: {
    readonly name: string;
    readonly description: string;
    readonly permissions: readonly string[];
    readonly orgId: string;
  }): Promise<Role> {
    const id = `role-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const doc: RoleDoc = {
      _id: id,
      name: data.name,
      description: data.description,
      isSystem: false,
      orgId: data.orgId,
      createdAt: now,
      permissions: [...data.permissions],
    };

    await this.collection.insertOne(doc);

    const created = await this.getRole(id);
    if (created === null) {
      throw new Error(`Failed to retrieve role after creation: ${id}`);
    }
    return created;
  }

  async updateRole(id: string, data: {
    readonly name?: string;
    readonly description?: string;
    readonly permissions?: readonly string[];
  }): Promise<void> {
    const role = await this.getRole(id);
    if (role === null) {
      throw new Error(`Role not found: ${id}`);
    }

    const setFields: Record<string, unknown> = {};

    if (data.description !== undefined) {
      setFields['description'] = data.description;
    }
    if (data.name !== undefined && !role.isSystem) {
      setFields['name'] = data.name;
    }
    if (data.permissions !== undefined) {
      setFields['permissions'] = [...data.permissions];
    }

    if (Object.keys(setFields).length > 0) {
      await this.collection.updateOne({ _id: id }, { $set: setFields });
    }
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.getRole(id);
    if (role === null) {
      throw new Error(`Role not found: ${id}`);
    }
    if (role.isSystem) {
      throw new Error('Cannot delete system roles');
    }
    await this.collection.deleteOne({ _id: id, isSystem: false });
  }

  async getUserPermissions(userId: string): Promise<Set<string>> {
    const userDoc = await this.usersCollection.findOne({ _id: userId });

    if (userDoc === null) {
      const fallbackRole = await this.getRoleByName('user');
      return new Set(fallbackRole?.permissions ?? []);
    }

    const role = await this.getRoleByName(userDoc.role);
    if (role === null) {
      const fallbackRole = await this.getRoleByName('user');
      return new Set(fallbackRole?.permissions ?? []);
    }

    if (role.name === 'admin') {
      // Return all permissions — we load them dynamically since
      // the permissions module is in the dashboard package.
      // For admin, return the role permissions which should contain all.
      return new Set(role.permissions);
    }

    return new Set(role.permissions);
  }
}
