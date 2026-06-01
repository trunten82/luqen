import type {
  Provider, CreateProviderInput, UpdateProviderInput,
  Model, CreateModelInput,
  CapabilityAssignment, AssignCapabilityInput, CapabilityName,
  OAuthClient, User, PromptOverride,
  LlmUsageRecord, RecordUsageInput, UsageFilter,
  UsageGroupDimension, UsageSummaryRow,
  CreditBalance, CreditLedgerEntry,
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

  // Credits (Phase 80) — admin-controlled AI-fix metering on top of llm_usage.

  /**
   * Current credit position for an org. Orgs with no row are reported with
   * the configurable default free allocation and zero used.
   */
  getCreditBalance(orgId: string): Promise<CreditBalance>;

  /**
   * Set an org's allocation to an absolute value (a fresh grant — resets used
   * to 0). Writes a ledger entry. Used by the dashboard admin "set" control.
   */
  setCreditAllocation(orgId: string, allocated: number, updatedBy?: string): Promise<CreditBalance>;

  /**
   * Add (or subtract) credits — a top-up that raises the allocation without
   * resetting consumption. Writes a ledger entry.
   */
  addCredits(orgId: string, delta: number, updatedBy?: string, reason?: string): Promise<CreditBalance>;

  /**
   * Atomically consume credits for a successful metered call. Returns ok:false
   * (and leaves state unchanged) when the balance is insufficient.
   */
  consumeCredit(orgId: string, amount: number, reason: string): Promise<{ ok: boolean; balance: CreditBalance }>;

  /** Recent ledger entries for an org, newest first. */
  listCreditLedger(orgId: string, limit?: number): Promise<readonly CreditLedgerEntry[]>;
}

/**
 * Default free monthly AI-fix credit allocation for an org with no explicit
 * allocation. Admin-configurable via env (no hardcoded business value);
 * seeds at 50 when unset.
 */
export function defaultFreeCredits(): number {
  const raw = process.env.LLM_FREE_DEFAULT_CREDITS;
  const n = raw != null ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 50;
}
