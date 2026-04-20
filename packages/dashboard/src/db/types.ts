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
// Re-exports from scoring types (needed for ScanRecord.brandScore — Phase 18-05)
// ---------------------------------------------------------------------------

import type { ScoreResult } from '../services/scoring/types.js';

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
  /**
   * Explicit regulation ids selected at scan time, independent of jurisdictions.
   * Added in migration 039 (07-P02). Always an array — empty when the scan was
   * jurisdictions-only. Pre-migration rows default to `[]` via the column default.
   */
  readonly regulations: string[];
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
  readonly brandingGuidelineId?: string;
  readonly brandingGuidelineVersion?: number;
  readonly brandRelatedCount?: number;
  /**
   * Phase 18-05: Latest brand_scores row for this scan, reconstructed as a
   * Phase 15 ScoreResult tagged union. Populated ONLY by queries that opt
   * into the brand_scores LEFT JOIN (currently getTrendData); direct
   * getScan / listScans leave this field undefined.
   *
   * Semantics:
   *   - undefined  → query did not join brand_scores (legacy call site)
   *   - null       → LEFT JOIN matched no brand_scores row for this scan
   *                  (pre-v2.11.0 scan, or a scan whose scorer produced
   *                  nothing because the guideline was never applied).
   *                  Distinct from `{ kind: 'unscorable' }` — "not measured"
   *                  vs "measured and unscorable".
   *   - ScoreResult → reconstructed tagged union (kind 'scored' or 'unscorable').
   *
   * Never 0, never NaN. BSTORE-04 regression is pinned on this type.
   */
  readonly brandScore?: ScoreResult | null;
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
  /** Optional — defaults to [] when omitted (07-P02). */
  readonly regulations?: string[];
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
  readonly brandingClientId?: string;
  readonly brandingClientSecret?: string;
  readonly llmClientId?: string;
  readonly llmClientSecret?: string;
  readonly brandingMode?: 'embedded' | 'remote';
  /**
   * Per-org agent display name (D-14 — the ONLY per-org agent knob;
   * per-org system-prompt override is permanently out of scope). Nullable;
   * when null, callers fall back to the project-wide default ("Luqen
   * Assistant") per D-19. Populated by migration 055 (Phase 32 Plan 03).
   *
   * Contract: `null` = unset, `''` (empty string) = explicitly blank
   * (which the fallback UI treats the same as null). Repo writes preserve
   * the caller's intent — pass `null` to clear, `''` to record blank.
   */
  readonly agentDisplayName?: string | null;
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

export const API_KEY_RATE_LIMITS: Record<ApiKeyRole, number> = {
  'admin': 200,
  'read-only': 100,
  'scan-only': 50,
} as const;

export interface ApiKeyRecord {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly orgId: string;
  readonly role: ApiKeyRole;
  readonly expiresAt: string | null;
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

// ---------------------------------------------------------------------------
// Branding types
// ---------------------------------------------------------------------------

export interface BrandingGuidelineRecord {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly description?: string;
  readonly version: number;
  readonly active: boolean;
  readonly createdBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly colors?: readonly BrandingColorRecord[];
  readonly fonts?: readonly BrandingFontRecord[];
  readonly selectors?: readonly BrandingSelectorRecord[];
  readonly siteCount?: number;
  readonly imagePath?: string;
  /**
   * Set when this guideline was produced by cloneSystemGuideline() — references
   * the source system guideline id. Null/undefined for all other rows.
   * Added in 08-P01 (migration 040).
   */
  readonly clonedFromSystemGuidelineId?: string | null;
}

export interface BrandingColorRecord {
  readonly id: string;
  readonly guidelineId: string;
  readonly name: string;
  readonly hexValue: string;
  readonly usage?: string;
  readonly context?: string;
}

export interface BrandingFontRecord {
  readonly id: string;
  readonly guidelineId: string;
  readonly family: string;
  readonly weights?: readonly string[];
  readonly usage?: string;
  readonly context?: string;
}

export interface BrandingSelectorRecord {
  readonly id: string;
  readonly guidelineId: string;
  readonly pattern: string;
  readonly description?: string;
}

export interface SiteBrandingRecord {
  readonly siteUrl: string;
  readonly guidelineId: string;
  readonly orgId: string;
}

export interface CreateBrandingGuidelineInput {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly description?: string;
  readonly createdBy?: string;
}

export type BrandingGuidelineUpdateData = Partial<
  Omit<BrandingGuidelineRecord, 'id' | 'orgId' | 'createdBy' | 'createdAt'>
>;
