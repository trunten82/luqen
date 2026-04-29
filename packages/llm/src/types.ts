// ---- Domain entities ----

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly type: ProviderType;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly status: ProviderStatus;
  readonly timeout: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'gemini';
export type ProviderStatus = 'active' | 'inactive' | 'error';

export interface Model {
  readonly id: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly status: 'active' | 'inactive';
  readonly capabilities: readonly CapabilityName[];
  readonly createdAt: string;
}

export type CapabilityName =
  | 'extract-requirements'
  | 'generate-fix'
  | 'analyse-report'
  | 'discover-branding'
  | 'agent-conversation'
  | 'generate-notification-content';

export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  'extract-requirements',
  'generate-fix',
  'analyse-report',
  'discover-branding',
  'agent-conversation',
  'generate-notification-content',
] as const;

export interface CapabilityAssignment {
  readonly capability: CapabilityName;
  readonly modelId: string;
  readonly priority: number;
  readonly orgId: string;
}

// ---- Create/Update inputs ----

export interface CreateProviderInput {
  readonly name: string;
  readonly type: ProviderType;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeout?: number;
}

export interface UpdateProviderInput {
  readonly name?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly status?: ProviderStatus;
  readonly timeout?: number;
}

export interface CreateModelInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly capabilities?: readonly CapabilityName[];
}

export interface AssignCapabilityInput {
  readonly capability: CapabilityName;
  readonly modelId: string;
  readonly priority?: number;
  readonly orgId?: string;
}

// ---- Auth entities ----

export interface OAuthClient {
  readonly id: string;
  readonly name: string;
  readonly secretHash: string;
  readonly scopes: readonly string[];
  readonly grantTypes: readonly string[];
  readonly orgId: string;
  readonly createdAt: string;
}

export interface User {
  readonly id: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly role: string;
  readonly active: boolean;
  readonly createdAt: string;
}

// ---- Capability execution ----

export interface ExtractedRequirements {
  readonly wcagVersion: string;
  readonly wcagLevel: string;
  readonly criteria: ReadonlyArray<{
    readonly criterion: string;
    readonly obligation: 'mandatory' | 'recommended' | 'optional' | 'excluded';
    readonly notes?: string;
  }>;
  readonly confidence: number;
}

export interface PromptOverride {
  readonly capability: CapabilityName;
  readonly orgId: string;
  readonly template: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---- Config ----

export interface LLMConfig {
  readonly port: number;
  readonly host: string;
  readonly dbPath: string;
  readonly jwtKeyPair: {
    readonly publicKeyPath: string;
    readonly privateKeyPath: string;
  };
  readonly tokenExpiry: string;
  readonly rateLimit: {
    readonly read: number;
    readonly write: number;
    readonly windowMs: number;
  };
  readonly cors: {
    readonly origin: readonly string[];
    readonly credentials: boolean;
  };
}
