import type {
  Provider, CreateProviderInput, UpdateProviderInput,
  Model, CreateModelInput,
  CapabilityAssignment, AssignCapabilityInput, CapabilityName,
  OAuthClient, User,
} from '../types.js';

export interface DbAdapter {
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Providers
  listProviders(): Promise<readonly Provider[]>;
  getProvider(id: string): Promise<Provider | undefined>;
  createProvider(data: CreateProviderInput): Promise<Provider>;
  updateProvider(id: string, data: UpdateProviderInput): Promise<Provider | undefined>;
  deleteProvider(id: string): Promise<boolean>;

  // Models
  listModels(providerId?: string): Promise<readonly Model[]>;
  getModel(id: string): Promise<Model | undefined>;
  createModel(data: CreateModelInput): Promise<Model>;
  deleteModel(id: string): Promise<boolean>;

  // Capability assignments
  listCapabilityAssignments(orgId?: string): Promise<readonly CapabilityAssignment[]>;
  assignCapability(data: AssignCapabilityInput): Promise<CapabilityAssignment>;
  unassignCapability(capability: CapabilityName, modelId: string, orgId?: string): Promise<boolean>;
  getModelForCapability(capability: CapabilityName, orgId?: string): Promise<Model | undefined>;

  // OAuth clients
  getClientById(id: string): Promise<OAuthClient | undefined>;
  createClient(data: { name: string; secretHash: string; scopes: readonly string[]; grantTypes: readonly string[]; orgId: string }): Promise<OAuthClient>;
  listClients(): Promise<readonly OAuthClient[]>;
  deleteClient(id: string): Promise<boolean>;

  // Users
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(data: { username: string; passwordHash: string; role: string }): Promise<User>;
}
