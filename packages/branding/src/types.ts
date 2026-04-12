/**
 * Domain types for the @luqen/branding package.
 */

// ---------------------------------------------------------------------------
// Brand guideline entities
// ---------------------------------------------------------------------------

export interface BrandGuideline {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly description?: string;
  readonly version: number;
  readonly active: boolean;
  readonly colors: readonly BrandColor[];
  readonly fonts: readonly BrandFont[];
  readonly selectors: readonly BrandSelector[];
  readonly createdBy?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface BrandColor {
  readonly id: string;
  readonly name: string;
  readonly hexValue: string;
  readonly usage?: ColorUsage;
  readonly context?: string;
}

export type ColorUsage = 'primary' | 'secondary' | 'background' | 'text' | 'accent';

export interface BrandFont {
  readonly id: string;
  readonly family: string;
  readonly weights?: readonly string[];
  readonly usage?: FontUsage;
  readonly context?: string;
  readonly xHeight?: number;
  readonly capHeight?: number;
  readonly unitsPerEm?: number;
}

export type FontUsage = 'heading' | 'body' | 'accent' | 'monospace';

export interface BrandSelector {
  readonly id: string;
  readonly pattern: string;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Matching result types
// ---------------------------------------------------------------------------

export type MatchStrategy = 'color-pair' | 'font' | 'selector';

export interface BrandMatch {
  readonly matched: true;
  readonly strategy: MatchStrategy;
  readonly guidelineName: string;
  readonly guidelineId: string;
  readonly matchDetail: string;
}

export interface NoBrandMatch {
  readonly matched: false;
}

export type BrandMatchResult = BrandMatch | NoBrandMatch;

// ---------------------------------------------------------------------------
// Issue types (minimal — we accept any object with these fields)
// ---------------------------------------------------------------------------

export interface MatchableIssue {
  readonly code: string;
  readonly type: 'error' | 'warning' | 'notice';
  readonly message: string;
  readonly selector: string;
  readonly context: string;
}

export interface BrandedIssue<T extends MatchableIssue = MatchableIssue> {
  readonly issue: T;
  readonly brandMatch: BrandMatchResult;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface IBrandingStore {
  addGuideline(guideline: BrandGuideline): void;
  updateGuideline(id: string, updates: Partial<Omit<BrandGuideline, 'id' | 'orgId'>>): void;
  removeGuideline(id: string): void;
  getGuideline(id: string): BrandGuideline | null;
  listGuidelines(orgId: string): readonly BrandGuideline[];
  assignToSite(guidelineId: string, siteUrl: string, orgId: string): void;
  unassignFromSite(siteUrl: string, orgId: string): void;
  getGuidelineForSite(siteUrl: string, orgId: string): BrandGuideline | null;
  getSiteAssignments(guidelineId: string): readonly string[];
}

// ---------------------------------------------------------------------------
// LLM provider interface (for PDF parsing)
// ---------------------------------------------------------------------------

export interface IBrandingLLMProvider {
  extractBrandData(text: string): Promise<ExtractedBrandData>;
}

export interface ExtractedBrandData {
  readonly colors: ReadonlyArray<{
    readonly name: string;
    readonly hex: string;
    readonly usage?: string;
  }>;
  readonly fonts: ReadonlyArray<{
    readonly family: string;
    readonly weights?: readonly string[];
    readonly usage?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Parser input types
// ---------------------------------------------------------------------------

export interface CreateGuidelineInput {
  readonly name: string;
  readonly orgId: string;
  readonly description?: string;
  readonly colors?: ReadonlyArray<Omit<BrandColor, 'id'>>;
  readonly fonts?: ReadonlyArray<Omit<BrandFont, 'id'>>;
  readonly selectors?: ReadonlyArray<Omit<BrandSelector, 'id'>>;
}
