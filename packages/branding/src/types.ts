// ─── Entities ────────────────────────────────────────────────────────────────

export type ColorUsage = 'primary' | 'secondary' | 'accent' | 'background' | 'text' | 'border' | 'error' | 'warning' | 'success' | 'info';
export type FontUsage = 'heading' | 'body' | 'monospace' | 'caption' | 'display';

export interface BrandColor {
  readonly hex: string;
  readonly name?: string;
  readonly usage?: readonly ColorUsage[];
  readonly variants?: readonly string[];
}

export interface BrandFont {
  readonly family: string;
  readonly usage?: readonly FontUsage[];
  readonly weights?: readonly number[];
  readonly fallbacks?: readonly string[];
}

export interface BrandSelector {
  readonly selector: string;
  readonly description?: string;
  readonly appliesTo?: readonly string[];
}

export interface BrandGuideline {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly colors: readonly BrandColor[];
  readonly fonts: readonly BrandFont[];
  readonly selectors: readonly BrandSelector[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── Matching ─────────────────────────────────────────────────────────────────

export type MatchStrategy = 'color' | 'font' | 'selector';

export interface BrandMatch {
  readonly matched: true;
  readonly strategy: MatchStrategy;
  readonly confidence: number;
  readonly detail: string;
  readonly guidelineId: string;
  readonly guidelineName: string;
}

export interface NoBrandMatch {
  readonly matched: false;
}

export type BrandMatchResult = BrandMatch | NoBrandMatch;

// ─── Issues ───────────────────────────────────────────────────────────────────

export interface MatchableIssue {
  readonly code: string;
  readonly message: string;
  readonly context?: string;
  readonly selector?: string;
}

export interface BrandedIssue<T extends MatchableIssue = MatchableIssue> {
  readonly issue: T;
  readonly brandMatch: BrandMatchResult;
}

// ─── Store Interface ──────────────────────────────────────────────────────────

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

// ─── LLM Interface ────────────────────────────────────────────────────────────

export interface ExtractedBrandData {
  readonly colors: readonly BrandColor[];
  readonly fonts: readonly BrandFont[];
  readonly selectors: readonly BrandSelector[];
}

export interface IBrandingLLMProvider {
  extractBrandData(content: string, mimeType: string): Promise<ExtractedBrandData>;
}

// ─── Parser Input ─────────────────────────────────────────────────────────────

export interface CreateGuidelineInput {
  readonly orgId: string;
  readonly name: string;
  readonly colors?: readonly BrandColor[];
  readonly fonts?: readonly BrandFont[];
  readonly selectors?: readonly BrandSelector[];
}
