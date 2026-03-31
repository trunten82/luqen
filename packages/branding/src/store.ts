import type { BrandGuideline, IBrandingStore } from './types.js';

export class GuidelineStore implements IBrandingStore {
  addGuideline(_g: BrandGuideline): void {}
  updateGuideline(_id: string, _updates: Partial<Omit<BrandGuideline, 'id' | 'orgId'>>): void {}
  removeGuideline(_id: string): void {}
  getGuideline(_id: string): BrandGuideline | null { return null; }
  listGuidelines(_orgId: string): readonly BrandGuideline[] { return []; }
  assignToSite(_guidelineId: string, _siteUrl: string, _orgId: string): void {}
  unassignFromSite(_siteUrl: string, _orgId: string): void {}
  getGuidelineForSite(_siteUrl: string, _orgId: string): BrandGuideline | null { return null; }
  getSiteAssignments(_guidelineId: string): readonly string[] { return []; }
}
