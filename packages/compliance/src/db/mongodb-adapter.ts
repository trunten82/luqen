import { MongoClient, type Db, type Collection, type Document } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { hashSync, genSaltSync } from 'bcrypt';
import type { DbAdapter } from './adapter.js';
import type {
  Jurisdiction,
  Regulation,
  Requirement,
  RequirementWithRegulation,
  UpdateProposal,
  MonitoredSource,
  OAuthClient,
  User,
  Webhook,
  JurisdictionFilters,
  RegulationFilters,
  RequirementFilters,
  CreateJurisdictionInput,
  CreateRegulationInput,
  CreateRequirementInput,
  CreateUpdateProposalInput,
  CreateSourceInput,
  CreateClientInput,
  CreateUserInput,
  CreateWebhookInput,
} from '../types.js';

// ---------------------------------------------------------------------------
// Document → domain type mappers
// ---------------------------------------------------------------------------

function docToJurisdiction(doc: Document): Jurisdiction {
  return {
    id: doc['id'] as string,
    name: doc['name'] as string,
    type: doc['type'] as Jurisdiction['type'],
    ...(doc['parentId'] != null ? { parentId: doc['parentId'] as string } : {}),
    ...(doc['iso3166'] != null ? { iso3166: doc['iso3166'] as string } : {}),
    createdAt: doc['createdAt'] as string,
    updatedAt: doc['updatedAt'] as string,
  };
}

function docToRegulation(doc: Document): Regulation {
  return {
    id: doc['id'] as string,
    jurisdictionId: doc['jurisdictionId'] as string,
    name: doc['name'] as string,
    shortName: doc['shortName'] as string,
    reference: doc['reference'] as string,
    url: doc['url'] as string,
    enforcementDate: doc['enforcementDate'] as string,
    status: doc['status'] as Regulation['status'],
    scope: doc['scope'] as Regulation['scope'],
    sectors: doc['sectors'] as string[],
    description: doc['description'] as string,
    createdAt: doc['createdAt'] as string,
    updatedAt: doc['updatedAt'] as string,
  };
}

function docToRequirement(doc: Document): Requirement {
  return {
    id: doc['id'] as string,
    regulationId: doc['regulationId'] as string,
    wcagVersion: doc['wcagVersion'] as Requirement['wcagVersion'],
    wcagLevel: doc['wcagLevel'] as Requirement['wcagLevel'],
    wcagCriterion: doc['wcagCriterion'] as string,
    obligation: doc['obligation'] as Requirement['obligation'],
    ...(doc['notes'] != null ? { notes: doc['notes'] as string } : {}),
    createdAt: doc['createdAt'] as string,
    updatedAt: doc['updatedAt'] as string,
  };
}

function docToRequirementWithRegulation(doc: Document): RequirementWithRegulation {
  return {
    ...docToRequirement(doc),
    regulationName: doc['regulationName'] as string,
    regulationShortName: doc['regulationShortName'] as string,
    jurisdictionId: doc['jurisdictionId'] as string,
    enforcementDate: doc['enforcementDate'] as string,
  };
}

function docToUpdateProposal(doc: Document): UpdateProposal {
  return {
    id: doc['id'] as string,
    source: doc['source'] as string,
    detectedAt: doc['detectedAt'] as string,
    type: doc['type'] as UpdateProposal['type'],
    ...(doc['affectedRegulationId'] != null ? { affectedRegulationId: doc['affectedRegulationId'] as string } : {}),
    ...(doc['affectedJurisdictionId'] != null ? { affectedJurisdictionId: doc['affectedJurisdictionId'] as string } : {}),
    summary: doc['summary'] as string,
    proposedChanges: doc['proposedChanges'] as UpdateProposal['proposedChanges'],
    status: doc['status'] as UpdateProposal['status'],
    ...(doc['reviewedBy'] != null ? { reviewedBy: doc['reviewedBy'] as string } : {}),
    ...(doc['reviewedAt'] != null ? { reviewedAt: doc['reviewedAt'] as string } : {}),
    createdAt: doc['createdAt'] as string,
  };
}

function docToMonitoredSource(doc: Document): MonitoredSource {
  return {
    id: doc['id'] as string,
    name: doc['name'] as string,
    url: doc['url'] as string,
    type: doc['type'] as MonitoredSource['type'],
    schedule: doc['schedule'] as MonitoredSource['schedule'],
    ...(doc['lastCheckedAt'] != null ? { lastCheckedAt: doc['lastCheckedAt'] as string } : {}),
    ...(doc['lastContentHash'] != null ? { lastContentHash: doc['lastContentHash'] as string } : {}),
    createdAt: doc['createdAt'] as string,
  };
}

function docToOAuthClient(doc: Document): OAuthClient {
  return {
    id: doc['id'] as string,
    name: doc['name'] as string,
    secretHash: doc['secretHash'] as string,
    scopes: doc['scopes'] as string[],
    grantTypes: doc['grantTypes'] as OAuthClient['grantTypes'],
    ...(doc['redirectUris'] != null ? { redirectUris: doc['redirectUris'] as string[] } : {}),
    createdAt: doc['createdAt'] as string,
  };
}

function docToUser(doc: Document): User {
  return {
    id: doc['id'] as string,
    username: doc['username'] as string,
    passwordHash: doc['passwordHash'] as string,
    role: doc['role'] as User['role'],
    createdAt: doc['createdAt'] as string,
  };
}

function docToWebhook(doc: Document): Webhook {
  return {
    id: doc['id'] as string,
    url: doc['url'] as string,
    secret: doc['secret'] as string,
    events: doc['events'] as string[],
    active: doc['active'] as boolean,
    createdAt: doc['createdAt'] as string,
  };
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class MongoDbAdapter implements DbAdapter {
  private client!: MongoClient;
  private db!: Db;
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  async initialize(): Promise<void> {
    this.client = new MongoClient(this.connectionString);
    await this.client.connect();
    // Extract DB name from connection string or fall back to a default
    const url = new URL(this.connectionString);
    const dbName = url.pathname.replace(/^\//, '') || 'pally-compliance';
    this.db = this.client.db(dbName);
    await this.createIndexes();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private col<T extends Document = Document>(name: string): Collection<T> {
    return this.db.collection<T>(name);
  }

  private async createIndexes(): Promise<void> {
    await this.col('jurisdictions').createIndex({ id: 1 }, { unique: true });
    await this.col('regulations').createIndex({ id: 1 }, { unique: true });
    await this.col('regulations').createIndex({ jurisdictionId: 1 });
    await this.col('requirements').createIndex({ id: 1 }, { unique: true });
    await this.col('requirements').createIndex({ regulationId: 1 });
    await this.col('requirements').createIndex({ wcagCriterion: 1 });
    await this.col('update_proposals').createIndex({ id: 1 }, { unique: true });
    await this.col('monitored_sources').createIndex({ id: 1 }, { unique: true });
    await this.col('oauth_clients').createIndex({ id: 1 }, { unique: true });
    await this.col('users').createIndex({ username: 1 }, { unique: true });
    await this.col('webhooks').createIndex({ id: 1 }, { unique: true });
  }

  // -------------------------------------------------------------------------
  // Jurisdictions
  // -------------------------------------------------------------------------

  async listJurisdictions(filters?: JurisdictionFilters): Promise<Jurisdiction[]> {
    const query: Record<string, unknown> = {};
    if (filters?.type != null) query['type'] = filters.type;
    if (filters?.parentId != null) query['parentId'] = filters.parentId;
    const docs = await this.col('jurisdictions').find(query).toArray();
    return docs.map(docToJurisdiction);
  }

  async getJurisdiction(id: string): Promise<Jurisdiction | null> {
    const doc = await this.col('jurisdictions').findOne({ id });
    return doc != null ? docToJurisdiction(doc) : null;
  }

  async createJurisdiction(data: CreateJurisdictionInput): Promise<Jurisdiction> {
    const now = new Date().toISOString();
    const doc = {
      id: data.id,
      name: data.name,
      type: data.type,
      parentId: data.parentId ?? null,
      iso3166: data.iso3166 ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.col('jurisdictions').insertOne(doc);
    return docToJurisdiction(doc);
  }

  async updateJurisdiction(id: string, data: Partial<CreateJurisdictionInput>): Promise<Jurisdiction> {
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { updatedAt: now };
    if (data.name != null) set['name'] = data.name;
    if (data.type != null) set['type'] = data.type;
    if ('parentId' in data) set['parentId'] = data.parentId ?? null;
    if ('iso3166' in data) set['iso3166'] = data.iso3166 ?? null;
    await this.col('jurisdictions').updateOne({ id }, { $set: set });
    const doc = await this.col('jurisdictions').findOne({ id });
    if (doc == null) throw new Error(`Jurisdiction ${id} not found`);
    return docToJurisdiction(doc);
  }

  async deleteJurisdiction(id: string): Promise<void> {
    await this.col('jurisdictions').deleteOne({ id });
  }

  // -------------------------------------------------------------------------
  // Regulations
  // -------------------------------------------------------------------------

  async listRegulations(filters?: RegulationFilters): Promise<Regulation[]> {
    const query: Record<string, unknown> = {};
    if (filters?.jurisdictionId != null) query['jurisdictionId'] = filters.jurisdictionId;
    if (filters?.status != null) query['status'] = filters.status;
    if (filters?.scope != null) query['scope'] = filters.scope;
    const docs = await this.col('regulations').find(query).toArray();
    return docs.map(docToRegulation);
  }

  async getRegulation(id: string): Promise<Regulation | null> {
    const doc = await this.col('regulations').findOne({ id });
    return doc != null ? docToRegulation(doc) : null;
  }

  async createRegulation(data: CreateRegulationInput): Promise<Regulation> {
    const now = new Date().toISOString();
    const doc = {
      id: data.id,
      jurisdictionId: data.jurisdictionId,
      name: data.name,
      shortName: data.shortName,
      reference: data.reference,
      url: data.url,
      enforcementDate: data.enforcementDate,
      status: data.status,
      scope: data.scope,
      sectors: data.sectors,
      description: data.description,
      createdAt: now,
      updatedAt: now,
    };
    await this.col('regulations').insertOne(doc);
    return docToRegulation(doc);
  }

  async updateRegulation(id: string, data: Partial<CreateRegulationInput>): Promise<Regulation> {
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { updatedAt: now };
    if (data.name != null) set['name'] = data.name;
    if (data.jurisdictionId != null) set['jurisdictionId'] = data.jurisdictionId;
    if (data.shortName != null) set['shortName'] = data.shortName;
    if (data.reference != null) set['reference'] = data.reference;
    if (data.url != null) set['url'] = data.url;
    if (data.enforcementDate != null) set['enforcementDate'] = data.enforcementDate;
    if (data.status != null) set['status'] = data.status;
    if (data.scope != null) set['scope'] = data.scope;
    if (data.sectors != null) set['sectors'] = data.sectors;
    if (data.description != null) set['description'] = data.description;
    await this.col('regulations').updateOne({ id }, { $set: set });
    const doc = await this.col('regulations').findOne({ id });
    if (doc == null) throw new Error(`Regulation ${id} not found`);
    return docToRegulation(doc);
  }

  async deleteRegulation(id: string): Promise<void> {
    await this.col('regulations').deleteOne({ id });
  }

  // -------------------------------------------------------------------------
  // Requirements
  // -------------------------------------------------------------------------

  async listRequirements(filters?: RequirementFilters): Promise<Requirement[]> {
    const query: Record<string, unknown> = {};
    if (filters?.regulationId != null) query['regulationId'] = filters.regulationId;
    if (filters?.wcagCriterion != null) query['wcagCriterion'] = filters.wcagCriterion;
    if (filters?.obligation != null) query['obligation'] = filters.obligation;
    const docs = await this.col('requirements').find(query).toArray();
    return docs.map(docToRequirement);
  }

  async getRequirement(id: string): Promise<Requirement | null> {
    const doc = await this.col('requirements').findOne({ id });
    return doc != null ? docToRequirement(doc) : null;
  }

  async createRequirement(data: CreateRequirementInput): Promise<Requirement> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const doc = {
      id,
      regulationId: data.regulationId,
      wcagVersion: data.wcagVersion,
      wcagLevel: data.wcagLevel,
      wcagCriterion: data.wcagCriterion,
      obligation: data.obligation,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.col('requirements').insertOne(doc);
    return docToRequirement(doc);
  }

  async updateRequirement(id: string, data: Partial<CreateRequirementInput>): Promise<Requirement> {
    const now = new Date().toISOString();
    const set: Record<string, unknown> = { updatedAt: now };
    if (data.regulationId != null) set['regulationId'] = data.regulationId;
    if (data.wcagVersion != null) set['wcagVersion'] = data.wcagVersion;
    if (data.wcagLevel != null) set['wcagLevel'] = data.wcagLevel;
    if (data.wcagCriterion != null) set['wcagCriterion'] = data.wcagCriterion;
    if (data.obligation != null) set['obligation'] = data.obligation;
    if ('notes' in data) set['notes'] = data.notes ?? null;
    await this.col('requirements').updateOne({ id }, { $set: set });
    const doc = await this.col('requirements').findOne({ id });
    if (doc == null) throw new Error(`Requirement ${id} not found`);
    return docToRequirement(doc);
  }

  async deleteRequirement(id: string): Promise<void> {
    await this.col('requirements').deleteOne({ id });
  }

  async bulkCreateRequirements(data: readonly CreateRequirementInput[]): Promise<Requirement[]> {
    if (data.length === 0) return [];
    const now = new Date().toISOString();
    const docs = data.map(item => ({
      id: randomUUID(),
      regulationId: item.regulationId,
      wcagVersion: item.wcagVersion,
      wcagLevel: item.wcagLevel,
      wcagCriterion: item.wcagCriterion,
      obligation: item.obligation,
      notes: item.notes ?? null,
      createdAt: now,
      updatedAt: now,
    }));
    await this.col('requirements').insertMany(docs);
    return docs.map(docToRequirement);
  }

  async findRequirementsByCriteria(
    jurisdictionIds: readonly string[],
    wcagCriteria: readonly string[],
  ): Promise<RequirementWithRegulation[]> {
    if (jurisdictionIds.length === 0 || wcagCriteria.length === 0) return [];

    const pipeline = [
      // Join requirements → regulations
      {
        $lookup: {
          from: 'regulations',
          localField: 'regulationId',
          foreignField: 'id',
          as: 'reg',
        },
      },
      { $unwind: '$reg' },
      // Filter by jurisdiction and criteria (exact or wildcard)
      {
        $match: {
          'reg.jurisdictionId': { $in: jurisdictionIds as string[] },
          $or: [
            { wcagCriterion: { $in: wcagCriteria as string[] } },
            { wcagCriterion: '*' },
          ],
        },
      },
      // Project required fields
      {
        $project: {
          id: 1,
          regulationId: 1,
          wcagVersion: 1,
          wcagLevel: 1,
          wcagCriterion: 1,
          obligation: 1,
          notes: 1,
          createdAt: 1,
          updatedAt: 1,
          regulationName: '$reg.name',
          regulationShortName: '$reg.shortName',
          jurisdictionId: '$reg.jurisdictionId',
          enforcementDate: '$reg.enforcementDate',
        },
      },
    ];

    const docs = await this.col('requirements').aggregate(pipeline).toArray();
    return docs.map(docToRequirementWithRegulation);
  }

  // -------------------------------------------------------------------------
  // Update proposals
  // -------------------------------------------------------------------------

  async listUpdateProposals(filters?: { status?: string }): Promise<UpdateProposal[]> {
    const query: Record<string, unknown> = {};
    if (filters?.status != null) query['status'] = filters.status;
    const docs = await this.col('update_proposals').find(query).toArray();
    return docs.map(docToUpdateProposal);
  }

  async getUpdateProposal(id: string): Promise<UpdateProposal | null> {
    const doc = await this.col('update_proposals').findOne({ id });
    return doc != null ? docToUpdateProposal(doc) : null;
  }

  async createUpdateProposal(data: CreateUpdateProposalInput): Promise<UpdateProposal> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const doc = {
      id,
      source: data.source,
      detectedAt: now,
      type: data.type,
      affectedRegulationId: data.affectedRegulationId ?? null,
      affectedJurisdictionId: data.affectedJurisdictionId ?? null,
      summary: data.summary,
      proposedChanges: data.proposedChanges,
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
    };
    await this.col('update_proposals').insertOne(doc);
    return docToUpdateProposal(doc);
  }

  async updateUpdateProposal(id: string, data: Partial<UpdateProposal>): Promise<UpdateProposal> {
    const set: Record<string, unknown> = {};
    if (data.status != null) set['status'] = data.status;
    if (data.reviewedBy != null) set['reviewedBy'] = data.reviewedBy;
    if (data.reviewedAt != null) set['reviewedAt'] = data.reviewedAt;
    if (data.summary != null) set['summary'] = data.summary;
    if (data.proposedChanges != null) set['proposedChanges'] = data.proposedChanges;
    await this.col('update_proposals').updateOne({ id }, { $set: set });
    const doc = await this.col('update_proposals').findOne({ id });
    if (doc == null) throw new Error(`UpdateProposal ${id} not found`);
    return docToUpdateProposal(doc);
  }

  // -------------------------------------------------------------------------
  // Monitored sources
  // -------------------------------------------------------------------------

  async listSources(): Promise<MonitoredSource[]> {
    const docs = await this.col('monitored_sources').find({}).toArray();
    return docs.map(docToMonitoredSource);
  }

  async createSource(data: CreateSourceInput): Promise<MonitoredSource> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const doc = {
      id,
      name: data.name,
      url: data.url,
      type: data.type,
      schedule: data.schedule,
      lastCheckedAt: null,
      lastContentHash: null,
      createdAt: now,
    };
    await this.col('monitored_sources').insertOne(doc);
    return docToMonitoredSource(doc);
  }

  async deleteSource(id: string): Promise<void> {
    await this.col('monitored_sources').deleteOne({ id });
  }

  async updateSourceLastChecked(id: string, contentHash: string): Promise<void> {
    const now = new Date().toISOString();
    await this.col('monitored_sources').updateOne(
      { id },
      { $set: { lastCheckedAt: now, lastContentHash: contentHash } },
    );
  }

  // -------------------------------------------------------------------------
  // OAuth clients
  // -------------------------------------------------------------------------

  async getClientById(clientId: string): Promise<OAuthClient | null> {
    const doc = await this.col('oauth_clients').findOne({ id: clientId });
    return doc != null ? docToOAuthClient(doc) : null;
  }

  async createClient(data: CreateClientInput): Promise<OAuthClient & { secret: string }> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const secret = randomUUID();
    const salt = genSaltSync(10);
    const secretHash = hashSync(secret, salt);

    const doc = {
      id,
      name: data.name,
      secretHash,
      scopes: data.scopes,
      grantTypes: data.grantTypes,
      redirectUris: data.redirectUris ?? null,
      createdAt: now,
    };
    await this.col('oauth_clients').insertOne(doc);
    return { ...docToOAuthClient(doc), secret };
  }

  async listClients(): Promise<OAuthClient[]> {
    const docs = await this.col('oauth_clients').find({}).toArray();
    return docs.map(docToOAuthClient);
  }

  async deleteClient(id: string): Promise<void> {
    await this.col('oauth_clients').deleteOne({ id });
  }

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  async getUserByUsername(username: string): Promise<User | null> {
    const doc = await this.col('users').findOne({ username });
    return doc != null ? docToUser(doc) : null;
  }

  async createUser(data: CreateUserInput): Promise<User> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const salt = genSaltSync(10);
    const passwordHash = hashSync(data.password, salt);

    const doc = {
      id,
      username: data.username,
      passwordHash,
      role: data.role,
      createdAt: now,
    };
    await this.col('users').insertOne(doc);
    return docToUser(doc);
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  async listWebhooks(): Promise<Webhook[]> {
    const docs = await this.col('webhooks').find({}).toArray();
    return docs.map(docToWebhook);
  }

  async createWebhook(data: CreateWebhookInput): Promise<Webhook> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const doc = {
      id,
      url: data.url,
      secret: data.secret,
      events: data.events,
      active: true,
      createdAt: now,
    };
    await this.col('webhooks').insertOne(doc);
    return docToWebhook(doc);
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.col('webhooks').deleteOne({ id });
  }
}
