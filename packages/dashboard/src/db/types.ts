/**
 * Shared domain types for the Luqen dashboard storage layer.
 *
 * This file is the single source of truth for all domain types used across
 * storage backends (SQLite, Postgres, MongoDB). It contains NO SQL, no row
 * types, and no conversion functions — those belong in each backend's
 * implementation.
 */

// ---------------------------------------------------------------------------
// Re-exports from plugin types
// ---------------------------------------------------------------------------

export type { PluginRecord, PluginType, PluginStatus } from '../plugins/types.js';

// ---------------------------------------------------------------------------
// Re-exports from manual criteria
// ---------------------------------------------------------------------------

export type { ManualTestResult, ManualTestStatus } from '../manual-criteria.js';

// ---------------------------------------------------------------------------
// Scan types
// ---------------------------------------------------------------------------

export interface ScanRecord {
  readonly id: string;
  readonly siteUrl: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly standard: string;
  readonly jurisdictions: string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly pagesScanned?: number;
  readonly totalIssues?: number;
  readonly errors?: number;
  readonly warnings?: number;
  readonly notices?: number;
  readonly confirmedViolations?: number;
  readonly jsonReportPath?: string;
  readonly jsonReport?: string;
  readonly error?: string;
  readonly orgId: string;
}

export interface ScanFilters {
  readonly status?: ScanRecord['status'];
  readonly createdBy?: string;
  readonly siteUrl?: string;
  readonly orgId?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly from?: string;
  readonly to?: string;
}

export type ScanUpdateData = Partial<Omit<ScanRecord, 'id' | 'createdBy' | 'createdAt'>>;

export interface CreateScanInput {
  readonly id: string;
  readonly siteUrl: string;
  readonly standard: string;
  readonly jurisdictions: string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly orgId?: string;
}

// ---------------------------------------------------------------------------
// Team types
// ---------------------------------------------------------------------------

export interface Team {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly orgId: string;
  readonly roleId: string | null;
  readonly createdAt: string;
  readonly memberCount?: number;
  readonly members?: ReadonlyArray<TeamMember>;
}

export interface TeamMember {
  readonly userId: string;
  readonly username: string;
  readonly role: string;
}

// ---------------------------------------------------------------------------
// SMTP / email types
// ---------------------------------------------------------------------------

export interface SmtpConfig {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly orgId: string;
}

export interface SmtpConfigInput {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
  readonly fromName?: string;
  readonly orgId?: string;
}

export interface EmailReport {
  readonly id: string;
  readonly name: string;
  readonly siteUrl: string;
  readonly recipients: string;
  readonly frequency: string;
  readonly format: string;
  readonly includeCsv: boolean;
  readonly includeWarnings?: boolean;
  readonly includeNotices?: boolean;
  readonly nextSendAt: string;
  readonly lastSentAt: string | null;
  readonly enabled: boolean;
  readonly createdBy: string;
  readonly orgId: string;
}

export interface CreateEmailReportInput {
  readonly id: string;
  readonly name: string;
  readonly siteUrl: string;
  readonly recipients: string;
  readonly frequency: string;
  readonly format?: string;
  readonly includeCsv?: boolean;
  readonly includeWarnings?: boolean;
  readonly includeNotices?: boolean;
  readonly nextSendAt: string;
  readonly createdBy: string;
  readonly orgId?: string;
}

// ---------------------------------------------------------------------------
// Connected repo types
// ---------------------------------------------------------------------------

export interface ConnectedRepo {
  readonly id: string;
  readonly siteUrlPattern: string;
  readonly repoUrl: string;
  readonly repoPath: string | null;
  readonly branch: string;
  readonly authToken: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly orgId: string;
  readonly gitHostConfigId: string | null;
}

// ---------------------------------------------------------------------------
// Role types
// ---------------------------------------------------------------------------

export interface Role {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isSystem: boolean;
  readonly orgId: string;
  readonly createdAt: string;
  readonly permissions: readonly string[];
}

// ---------------------------------------------------------------------------
// Issue assignment types
// ---------------------------------------------------------------------------

export type IssueAssignmentStatus = 'open' | 'assigned' | 'in-progress' | 'fixed' | 'verified';

export interface IssueAssignment {
  readonly id: string;
  readonly scanId: string;
  readonly issueFingerprint: string;
  readonly wcagCriterion: string | null;
  readonly wcagTitle: string | null;
  readonly severity: string;
  readonly message: string;
  readonly selector: string | null;
  readonly pageUrl: string | null;
  readonly status: IssueAssignmentStatus;
  readonly assignedTo: string | null;
  readonly notes: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly orgId: string;
}

export interface AssignmentFilters {
  readonly scanId?: string;
  readonly status?: IssueAssignmentStatus;
  readonly assignedTo?: string;
  readonly orgId?: string;
}

export interface AssignmentStats {
  readonly open: number;
  readonly assigned: number;
  readonly inProgress: number;
  readonly fixed: number;
  readonly verified: number;
  readonly total: number;
}

export interface CreateAssignmentInput {
  readonly id: string;
  readonly scanId: string;
  readonly issueFingerprint: string;
  readonly wcagCriterion?: string | null;
  readonly wcagTitle?: string | null;
  readonly severity: string;
  readonly message: string;
  readonly selector?: string | null;
  readonly pageUrl?: string | null;
  readonly status?: IssueAssignmentStatus;
  readonly assignedTo?: string | null;
  readonly notes?: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly orgId: string;
}

// ---------------------------------------------------------------------------
// Scan schedule types
// ---------------------------------------------------------------------------

export interface ScanSchedule {
  readonly id: string;
  readonly siteUrl: string;
  readonly standard: string;
  readonly scanMode: string;
  readonly jurisdictions: string[];
  readonly frequency: string;
  readonly nextRunAt: string;
  readonly lastRunAt: string | null;
  readonly enabled: boolean;
  readonly createdBy: string;
  readonly orgId: string;
  readonly runner: string | null;
  readonly incremental: boolean;
}

export interface CreateScheduleInput {
  readonly id: string;
  readonly siteUrl: string;
  readonly standard: string;
  readonly scanMode: string;
  readonly jurisdictions: string[];
  readonly frequency: string;
  readonly nextRunAt: string;
  readonly createdBy: string;
  readonly orgId: string;
  readonly runner?: string;
  readonly incremental?: boolean;
}

// ---------------------------------------------------------------------------
// Page hash types
// ---------------------------------------------------------------------------

export interface PageHashEntry {
  readonly siteUrl: string;
  readonly pageUrl: string;
  readonly hash: string;
  readonly orgId: string;
}

// ---------------------------------------------------------------------------
// User types
// ---------------------------------------------------------------------------

export interface DashboardUser {
  readonly id: string;
  readonly username: string;
  readonly role: 'admin' | 'developer' | 'editor' | 'user' | 'viewer' | 'executive';
  readonly active: boolean;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Organization types
// ---------------------------------------------------------------------------

export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: string;
  readonly complianceClientId?: string;
  readonly complianceClientSecret?: string;
}

export interface OrgMember {
  readonly orgId: string;
  readonly userId: string;
  readonly role: string;
  readonly joinedAt: string;
  /** 'direct' = from org_members table, 'team' = inherited via team membership */
  readonly source?: 'direct' | 'team';
  /** When source is 'team', the team name that grants membership */
  readonly teamName?: string;
}

// ---------------------------------------------------------------------------
// Audit types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly details: string | null;
  readonly ipAddress: string | null;
  readonly orgId: string;
}

export interface AuditQuery {
  readonly actor?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly from?: string;
  readonly to?: string;
  readonly orgId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CreateAuditInput {
  readonly actor: string;
  readonly actorId?: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly details?: string | Record<string, unknown>;
  readonly ipAddress?: string;
  readonly orgId?: string;
}

// ---------------------------------------------------------------------------
// Manual test types
// ---------------------------------------------------------------------------

export interface UpsertManualTestInput {
  readonly scanId: string;
  readonly criterionId: string;
  readonly status: import('../manual-criteria.js').ManualTestStatus;
  readonly notes?: string | null;
  readonly testedBy?: string | null;
  readonly testedAt?: string | null;
  readonly orgId?: string;
}

// ---------------------------------------------------------------------------
// API key types
// ---------------------------------------------------------------------------

export type ApiKeyRole = 'admin' | 'read-only' | 'scan-only';

export const API_KEY_ROLES: readonly ApiKeyRole[] = ['admin', 'read-only', 'scan-only'] as const;

export interface ApiKeyRecord {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly orgId: string;
  readonly role: ApiKeyRole;
}

// ---------------------------------------------------------------------------
// Git host types
// ---------------------------------------------------------------------------

export interface GitHostConfig {
  readonly id: string;
  readonly orgId: string;
  readonly pluginType: string;
  readonly hostUrl: string;
  readonly displayName: string;
  readonly createdAt: string;
}

export interface DeveloperCredential {
  readonly id: string;
  readonly userId: string;
  readonly gitHostConfigId: string;
  readonly tokenHint: string;
  readonly validatedUsername: string | null;
  readonly createdAt: string;
}
