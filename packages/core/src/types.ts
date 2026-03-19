export interface PallyConfig {
  readonly webserviceUrl: string;
  readonly webserviceHeaders: Readonly<Record<string, string>>;
  readonly standard: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
  readonly concurrency: number;
  readonly timeout: number;
  readonly pollTimeout: number;
  readonly maxPages: number;
  readonly crawlDepth: number;
  readonly alsoCrawl: boolean;
  readonly ignore: readonly string[];
  readonly hideElements: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly wait: number;
  readonly outputDir: string;
  readonly sourceMap: Readonly<Record<string, string>>;
}

export interface DiscoveredUrl {
  readonly url: string;
  readonly discoveryMethod: 'sitemap' | 'crawl';
}

export interface ScanProgress {
  readonly type: 'scan:start' | 'scan:complete' | 'scan:error' | 'scan:progress';
  readonly url: string;
  readonly current: number;
  readonly total: number;
  readonly timestamp: string;
  readonly error?: string;
}

export interface ScanError {
  readonly url: string;
  readonly code: 'TIMEOUT' | 'WEBSERVICE_ERROR' | 'HTTP_ERROR' | 'UNKNOWN';
  readonly message: string;
  readonly retried: boolean;
}

export interface AccessibilityIssue {
  readonly code: string;
  readonly type: 'error' | 'warning' | 'notice';
  readonly message: string;
  readonly selector: string;
  readonly context: string;
  readonly fixSuggestion?: string;
}

export interface SourceMapping {
  readonly file: string;
  readonly line?: number;
  readonly component?: string;
  readonly confidence: 'high' | 'low' | 'none';
}

export interface PageResult {
  readonly url: string;
  readonly discoveryMethod: 'sitemap' | 'crawl';
  readonly issueCount: number;
  readonly issues: readonly AccessibilityIssue[];
  readonly sourceMap?: SourceMapping;
  readonly error?: ScanError;
}

export interface ScanSummary {
  readonly url: string;
  readonly pagesScanned: number;
  readonly pagesFailed: number;
  readonly totalIssues: number;
  readonly byLevel: {
    readonly error: number;
    readonly warning: number;
    readonly notice: number;
  };
}

export interface ScanReport {
  readonly summary: ScanSummary;
  readonly pages: readonly PageResult[];
  readonly errors: readonly ScanError[];
  readonly reportPath: string;
}

export interface FixProposal {
  readonly file: string;
  readonly line: number;
  readonly issue: string;
  readonly description: string;
  readonly oldText: string;
  readonly newText: string;
  readonly confidence: 'high' | 'low';
}

export interface FixResult {
  readonly applied: boolean;
  readonly file: string;
  readonly diff: string;
}

export type ProgressListener = (progress: ScanProgress) => void;

// ---------------------------------------------------------------------------
// Compliance enrichment types
// ---------------------------------------------------------------------------

export interface ComplianceEnrichment {
  readonly matrix: Record<string, JurisdictionComplianceResult>;
  readonly issueAnnotations: ReadonlyMap<string, readonly RegulationAnnotation[]>;
  readonly summary: ComplianceSummary;
}

export interface JurisdictionComplianceResult {
  readonly jurisdictionId: string;
  readonly jurisdictionName: string;
  readonly status: 'pass' | 'fail';
  readonly mandatoryViolations: number;
  readonly recommendedViolations: number;
  readonly regulations: readonly RegulationComplianceResult[];
}

export interface RegulationComplianceResult {
  readonly regulationId: string;
  readonly regulationName: string;
  readonly shortName: string;
  readonly status: 'pass' | 'fail';
  readonly enforcementDate: string;
  readonly violationCount: number;
}

export interface RegulationAnnotation {
  readonly regulationName: string;
  readonly shortName: string;
  readonly jurisdictionId: string;
  readonly obligation: 'mandatory' | 'recommended' | 'optional';
}

export interface ComplianceSummary {
  readonly totalJurisdictions: number;
  readonly passing: number;
  readonly failing: number;
  readonly totalMandatoryViolations: number;
}

export interface ComplianceConfig {
  readonly url: string;
  readonly jurisdictions: readonly string[];
  readonly clientId?: string;
  readonly clientSecret?: string;
}
