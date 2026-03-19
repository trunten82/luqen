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
