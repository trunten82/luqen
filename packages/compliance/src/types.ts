// === Core domain entities ===

export interface Jurisdiction {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly type: 'supranational' | 'country' | 'state';
  readonly parentId?: string;
  readonly iso3166?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Regulation {
  readonly id: string;
  readonly orgId: string;
  readonly jurisdictionId: string;
  readonly name: string;
  readonly shortName: string;
  readonly reference: string;
  readonly url: string;
  readonly enforcementDate: string;
  readonly status: 'active' | 'draft' | 'repealed';
  readonly scope: 'public' | 'private' | 'all';
  readonly sectors: readonly string[];
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Requirement {
  readonly id: string;
  readonly orgId: string;
  readonly regulationId: string;
  readonly wcagVersion: '2.0' | '2.1' | '2.2';
  readonly wcagLevel: 'A' | 'AA' | 'AAA';
  readonly wcagCriterion: string;
  readonly obligation: 'mandatory' | 'recommended' | 'optional';
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RequirementWithRegulation extends Requirement {
  readonly regulationName: string;
  readonly regulationShortName: string;
  readonly jurisdictionId: string;
  readonly enforcementDate: string;
}

export interface ProposedChange {
  readonly action: 'create' | 'update' | 'delete';
  readonly entityType: 'jurisdiction' | 'regulation' | 'requirement';
  readonly entityId?: string;
  readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>;
}

export interface UpdateProposal {
  readonly id: string;
  readonly source: string;
  readonly detectedAt: string;
  readonly type: 'new_regulation' | 'amendment' | 'repeal' | 'new_requirement' | 'new_jurisdiction';
  readonly affectedRegulationId?: string;
  readonly affectedJurisdictionId?: string;
  readonly summary: string;
  readonly proposedChanges: ProposedChange;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly reviewedBy?: string;
  readonly reviewedAt?: string;
  readonly createdAt: string;
}

export interface Webhook {
  readonly id: string;
  readonly url: string;
  readonly secret: string;
  readonly events: readonly string[];
  readonly active: boolean;
  readonly createdAt: string;
}

export interface MonitoredSource {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly type: 'html' | 'rss' | 'api';
  readonly schedule: 'daily' | 'weekly' | 'monthly';
  readonly lastCheckedAt?: string;
  readonly lastContentHash?: string;
  readonly createdAt: string;
}

export interface OAuthClient {
  readonly id: string;
  readonly name: string;
  readonly secretHash: string;
  readonly scopes: readonly string[];
  readonly grantTypes: readonly ('client_credentials' | 'authorization_code')[];
  readonly redirectUris?: readonly string[];
  readonly orgId: string;
  readonly createdAt: string;
}

export interface User {
  readonly id: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly role: 'admin' | 'editor' | 'viewer';
  readonly active: boolean;
  readonly createdAt: string;
}

// === API request/response types ===

export interface ComplianceCheckRequest {
  readonly jurisdictions: readonly string[];
  readonly issues: readonly {
    readonly code: string;
    readonly type: string;
    readonly message: string;
    readonly selector: string;
    readonly context: string;
    readonly url?: string;
  }[];
  readonly includeOptional?: boolean;
  readonly sectors?: readonly string[];
}

export interface JurisdictionResult {
  readonly jurisdictionId: string;
  readonly jurisdictionName: string;
  readonly status: 'pass' | 'fail';
  readonly mandatoryViolations: number;
  readonly recommendedViolations: number;
  readonly optionalViolations: number;
  readonly regulations: readonly RegulationResult[];
}

export interface RegulationResult {
  readonly regulationId: string;
  readonly regulationName: string;
  readonly shortName: string;
  readonly status: 'pass' | 'fail';
  readonly enforcementDate: string;
  readonly scope: string;
  readonly violations: readonly {
    readonly wcagCriterion: string;
    readonly obligation: 'mandatory' | 'recommended' | 'optional';
    readonly issueCount: number;
  }[];
}

export interface AnnotatedIssue {
  readonly code: string;
  readonly wcagCriterion: string;
  readonly wcagLevel: string;
  readonly originalIssue: Record<string, unknown>;
  readonly regulations: readonly {
    readonly regulationId: string;
    readonly regulationName: string;
    readonly shortName: string;
    readonly jurisdictionId: string;
    readonly obligation: 'mandatory' | 'recommended' | 'optional';
    readonly enforcementDate: string;
  }[];
}

export interface ComplianceCheckResponse {
  readonly matrix: Record<string, JurisdictionResult>;
  readonly annotatedIssues: readonly AnnotatedIssue[];
  readonly summary: {
    readonly totalJurisdictions: number;
    readonly passing: number;
    readonly failing: number;
    readonly totalMandatoryViolations: number;
    readonly totalOptionalViolations: number;
  };
}

export interface PaginatedResponse<T> {
  readonly data: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface WebhookPayload {
  readonly event: string;
  readonly timestamp: string;
  readonly data: Record<string, unknown>;
}

// === Filter types ===

export interface JurisdictionFilters {
  readonly type?: 'supranational' | 'country' | 'state';
  readonly parentId?: string;
  readonly orgId?: string;
}

export interface RegulationFilters {
  readonly jurisdictionId?: string;
  readonly status?: 'active' | 'draft' | 'repealed';
  readonly scope?: 'public' | 'private' | 'all';
  readonly orgId?: string;
}

export interface RequirementFilters {
  readonly regulationId?: string;
  readonly wcagCriterion?: string;
  readonly obligation?: 'mandatory' | 'recommended' | 'optional';
  readonly orgId?: string;
}

// === Input types (for create operations) ===

export interface CreateJurisdictionInput {
  readonly id?: string;
  readonly name: string;
  readonly type: 'supranational' | 'country' | 'state';
  readonly parentId?: string;
  readonly iso3166?: string;
  readonly orgId?: string;
}

export interface CreateRegulationInput {
  readonly id?: string;
  readonly jurisdictionId: string;
  readonly name: string;
  readonly shortName: string;
  readonly reference: string;
  readonly url: string;
  readonly enforcementDate: string;
  readonly status: 'active' | 'draft' | 'repealed';
  readonly scope: 'public' | 'private' | 'all';
  readonly sectors: readonly string[];
  readonly description: string;
  readonly orgId?: string;
}

export interface CreateRequirementInput {
  readonly regulationId: string;
  readonly wcagVersion: '2.0' | '2.1' | '2.2';
  readonly wcagLevel: 'A' | 'AA' | 'AAA';
  readonly wcagCriterion: string;
  readonly obligation: 'mandatory' | 'recommended' | 'optional';
  readonly notes?: string;
  readonly orgId?: string;
}

export interface CreateUpdateProposalInput {
  readonly source: string;
  readonly detectedAt?: string;
  readonly type: 'new_regulation' | 'amendment' | 'repeal' | 'new_requirement' | 'new_jurisdiction';
  readonly affectedRegulationId?: string;
  readonly affectedJurisdictionId?: string;
  readonly summary: string;
  readonly proposedChanges: ProposedChange | string;
  readonly orgId?: string;
}

export interface CreateSourceInput {
  readonly name: string;
  readonly url: string;
  readonly type: 'html' | 'rss' | 'api';
  readonly schedule: 'daily' | 'weekly' | 'monthly';
  readonly orgId?: string;
}

export interface CreateClientInput {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly grantTypes: readonly ('client_credentials' | 'authorization_code')[];
  readonly redirectUris?: readonly string[];
  readonly orgId?: string;
}

export interface CreateUserInput {
  readonly username: string;
  readonly password: string;
  readonly role: 'admin' | 'editor' | 'viewer';
}

export interface CreateWebhookInput {
  readonly url: string;
  readonly secret: string;
  readonly events: readonly string[];
  readonly orgId?: string;
}

// === Configuration ===

export interface ComplianceConfig {
  readonly port: number;
  readonly host: string;
  readonly dbPath?: string;
  readonly redisUrl?: string;
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

// === Seed data shape ===

export interface BaselineSeedData {
  readonly version: string;
  readonly generatedAt: string;
  readonly jurisdictions: readonly CreateJurisdictionInput[];
  readonly regulations: readonly CreateRegulationInput[];
  readonly requirements: readonly CreateRequirementInput[];
  readonly sources?: readonly CreateSourceInput[];
}

