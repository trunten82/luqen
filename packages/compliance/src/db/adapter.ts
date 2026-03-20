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

export interface DbAdapter {
  // Jurisdictions
  listJurisdictions(filters?: JurisdictionFilters): Promise<Jurisdiction[]>;
  getJurisdiction(id: string): Promise<Jurisdiction | null>;
  createJurisdiction(data: CreateJurisdictionInput): Promise<Jurisdiction>;
  updateJurisdiction(
    id: string,
    data: Partial<CreateJurisdictionInput>,
  ): Promise<Jurisdiction>;
  deleteJurisdiction(id: string): Promise<void>;

  // Regulations
  listRegulations(filters?: RegulationFilters): Promise<Regulation[]>;
  getRegulation(id: string): Promise<Regulation | null>;
  createRegulation(data: CreateRegulationInput): Promise<Regulation>;
  updateRegulation(
    id: string,
    data: Partial<CreateRegulationInput>,
  ): Promise<Regulation>;
  deleteRegulation(id: string): Promise<void>;

  // Requirements
  listRequirements(filters?: RequirementFilters): Promise<Requirement[]>;
  getRequirement(id: string): Promise<Requirement | null>;
  createRequirement(data: CreateRequirementInput): Promise<Requirement>;
  updateRequirement(
    id: string,
    data: Partial<CreateRequirementInput>,
  ): Promise<Requirement>;
  deleteRequirement(id: string): Promise<void>;
  bulkCreateRequirements(
    data: readonly CreateRequirementInput[],
  ): Promise<Requirement[]>;

  // Requirements by criterion (used by compliance checker)
  findRequirementsByCriteria(
    jurisdictionIds: readonly string[],
    wcagCriteria: readonly string[],
  ): Promise<RequirementWithRegulation[]>;

  // Update proposals
  listUpdateProposals(
    filters?: { status?: string },
  ): Promise<UpdateProposal[]>;
  getUpdateProposal(id: string): Promise<UpdateProposal | null>;
  createUpdateProposal(
    data: CreateUpdateProposalInput,
  ): Promise<UpdateProposal>;
  updateUpdateProposal(
    id: string,
    data: Partial<UpdateProposal>,
  ): Promise<UpdateProposal>;

  // Monitored sources
  listSources(): Promise<MonitoredSource[]>;
  createSource(data: CreateSourceInput): Promise<MonitoredSource>;
  deleteSource(id: string): Promise<void>;
  updateSourceLastChecked(
    id: string,
    contentHash: string,
  ): Promise<void>;

  // OAuth clients
  getClientById(clientId: string): Promise<OAuthClient | null>;
  createClient(
    data: CreateClientInput,
  ): Promise<OAuthClient & { secret: string }>;
  listClients(): Promise<OAuthClient[]>;
  deleteClient(id: string): Promise<void>;

  // Users
  getUserByUsername(username: string): Promise<User | null>;
  createUser(data: CreateUserInput): Promise<User>;
  listUsers(): Promise<User[]>;
  deactivateUser(id: string): Promise<void>;

  // Webhooks
  listWebhooks(): Promise<Webhook[]>;
  createWebhook(data: CreateWebhookInput): Promise<Webhook>;
  deleteWebhook(id: string): Promise<void>;

  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
}
