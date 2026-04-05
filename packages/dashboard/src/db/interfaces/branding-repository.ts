import type {
  BrandingGuidelineRecord, BrandingColorRecord, BrandingFontRecord,
  BrandingSelectorRecord, CreateBrandingGuidelineInput, BrandingGuidelineUpdateData,
} from '../types.js';

export interface BrandingRepository {
  createGuideline(data: CreateBrandingGuidelineInput): Promise<BrandingGuidelineRecord>;
  getGuideline(id: string): Promise<BrandingGuidelineRecord | null>;
  listGuidelines(orgId: string): Promise<readonly BrandingGuidelineRecord[]>;
  listAllGuidelines(): Promise<readonly BrandingGuidelineRecord[]>;
  /**
   * List all guidelines with `org_id = 'system'` — the System Library shown
   * on the dashboard admin page and the org-scoped System Library tab.
   * Added in 08-P01 (migration 040).
   */
  listSystemGuidelines(): Promise<readonly BrandingGuidelineRecord[]>;
  /**
   * Clone a system-scoped guideline (and its colors/fonts/selectors) into
   * `targetOrgId` as an independent, editable row. The clone's
   * `clonedFromSystemGuidelineId` is set to the source id. Throws if the
   * source does not exist or is not org_id='system'.
   * Added in 08-P01 (migration 040).
   */
  cloneSystemGuideline(
    sourceId: string,
    targetOrgId: string,
    overrides?: { name?: string },
  ): Promise<BrandingGuidelineRecord>;
  updateGuideline(id: string, data: BrandingGuidelineUpdateData): Promise<BrandingGuidelineRecord>;
  deleteGuideline(id: string): Promise<void>;

  addColor(guidelineId: string, color: Omit<BrandingColorRecord, 'guidelineId'>): Promise<BrandingColorRecord>;
  updateColor(id: string, data: Partial<Omit<BrandingColorRecord, 'id' | 'guidelineId'>>): Promise<void>;
  removeColor(id: string): Promise<void>;
  listColors(guidelineId: string): Promise<readonly BrandingColorRecord[]>;

  addFont(guidelineId: string, font: Omit<BrandingFontRecord, 'guidelineId'>): Promise<BrandingFontRecord>;
  updateFont(id: string, data: Partial<Omit<BrandingFontRecord, 'id' | 'guidelineId'>>): Promise<void>;
  removeFont(id: string): Promise<void>;
  listFonts(guidelineId: string): Promise<readonly BrandingFontRecord[]>;

  addSelector(guidelineId: string, selector: Omit<BrandingSelectorRecord, 'guidelineId'>): Promise<BrandingSelectorRecord>;
  updateSelector(id: string, data: Partial<Omit<BrandingSelectorRecord, 'id' | 'guidelineId'>>): Promise<void>;
  removeSelector(id: string): Promise<void>;
  listSelectors(guidelineId: string): Promise<readonly BrandingSelectorRecord[]>;

  assignToSite(guidelineId: string, siteUrl: string, orgId: string): Promise<void>;
  unassignFromSite(siteUrl: string, orgId: string): Promise<void>;
  getGuidelineForSite(siteUrl: string, orgId: string): Promise<BrandingGuidelineRecord | null>;
  getSiteAssignments(guidelineId: string): Promise<readonly string[]>;
}
