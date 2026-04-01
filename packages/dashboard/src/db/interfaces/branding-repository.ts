import type {
  BrandingGuidelineRecord, BrandingColorRecord, BrandingFontRecord,
  BrandingSelectorRecord, CreateBrandingGuidelineInput, BrandingGuidelineUpdateData,
} from '../types.js';

export interface BrandingRepository {
  createGuideline(data: CreateBrandingGuidelineInput): Promise<BrandingGuidelineRecord>;
  getGuideline(id: string): Promise<BrandingGuidelineRecord | null>;
  listGuidelines(orgId: string): Promise<readonly BrandingGuidelineRecord[]>;
  listAllGuidelines(): Promise<readonly BrandingGuidelineRecord[]>;
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
