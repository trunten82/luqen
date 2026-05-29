import type {
  Provider, CreateProviderInput, UpdateProviderInput,
  Model, CreateModelInput,
  CapabilityAssignment, AssignCapabilityInput, CapabilityName,
  OAuthClient, User, PromptOverride,
  LlmUsageRecord, RecordUsageInput, UsageFilter,
  UsageGroupDimension, UsageSummaryRow,
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

  // Prompt overrides
  getPromptOverride(capability: CapabilityName, orgId?: string): Promise<PromptOverride | undefined>;
  setPromptOverride(capability: CapabilityName, template: string, orgId?: string): Promise<PromptOverride>;
  deletePromptOverride(capability: CapabilityName, orgId?: string): Promise<boolean>;
  listPromptOverrides(): Promise<readonly PromptOverride[]>;

  // Full chain for retry
  getModelsForCapability(capability: CapabilityName, orgId?: string): Promise<readonly Model[]>;

  // Priority helpers
  getMaxCapabilityPriority(capability: CapabilityName, orgId?: string): Promise<number>;

  // OAuth clients
  getClientById(id: string): Promise<OAuthClient | undefined>;
  createClient(data: { name: string; secretHash: string; scopes: readonly string[]; grantTypes: readonly string[]; orgId: string }): Promise<OAuthClient>;
  listClients(): Promise<readonly OAuthClient[]>;
  deleteClient(id: string): Promise<boolean>;

  // Users
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(data: { username: string; passwordHash: string; role: string }): Promise<User>;

  // Usage telemetry (Phase 72-01)
  recordUsage(input: RecordUsageInput): Promise<LlmUsageRecord>;
  listUsage(filter?: UsageFilter): Promise<readonly LlmUsageRecord[]>;

  /**
   * Phase 76 — delete llm_usage rows whose occurred_at is older than
   * `olderThanIso`. Returns the row count purged. The caller is
   * responsible for computing the cutoff from the retention policy.
   */
  purgeUsageBefore(olderThanIso: string): Promise<number>;

  /**
   * Phase 77 — aggregate llm_usage rows by a chosen dimension. Used
   * by the dashboard's breakdown view. Aggregation runs in SQL so
   * large date ranges don't fan-out into Node.
   */
  summarizeUsage(
    filter: UsageFilter,
    groupBy: UsageGroupDimension,
  ): Promise<readonly UsageSummaryRow[]>;
}
