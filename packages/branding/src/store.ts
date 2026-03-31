import type { BrandGuideline, IBrandingStore } from './types.js';

interface SiteAssignment {
  readonly guidelineId: string;
  readonly siteUrl: string;
  readonly orgId: string;
}

export class GuidelineStore implements IBrandingStore {
  private readonly guidelines = new Map<string, BrandGuideline>();
  private assignments: readonly SiteAssignment[] = [];

  addGuideline(guideline: BrandGuideline): void {
    this.guidelines.set(guideline.id, guideline);
  }

  updateGuideline(id: string, updates: Partial<Omit<BrandGuideline, 'id' | 'orgId'>>): void {
    const existing = this.guidelines.get(id);
    if (!existing) return;
    this.guidelines.set(id, { ...existing, ...updates, version: existing.version + 1 });
  }

  removeGuideline(id: string): void {
    this.guidelines.delete(id);
    this.assignments = this.assignments.filter(a => a.guidelineId !== id);
  }

  getGuideline(id: string): BrandGuideline | null {
    return this.guidelines.get(id) ?? null;
  }

  listGuidelines(orgId: string): readonly BrandGuideline[] {
    return Array.from(this.guidelines.values()).filter(g => g.orgId === orgId);
  }

  assignToSite(guidelineId: string, siteUrl: string, orgId: string): void {
    // Remove any existing assignment for this site+org
    this.assignments = this.assignments.filter(
      a => !(a.siteUrl === siteUrl && a.orgId === orgId),
    );
    this.assignments = [...this.assignments, { guidelineId, siteUrl, orgId }];
  }

  unassignFromSite(siteUrl: string, orgId: string): void {
    this.assignments = this.assignments.filter(
      a => !(a.siteUrl === siteUrl && a.orgId === orgId),
    );
  }

  getGuidelineForSite(siteUrl: string, orgId: string): BrandGuideline | null {
    const assignment = this.assignments.find(
      a => a.siteUrl === siteUrl && a.orgId === orgId,
    );
    if (!assignment) return null;
    return this.guidelines.get(assignment.guidelineId) ?? null;
  }

  getSiteAssignments(guidelineId: string): readonly string[] {
    return this.assignments
      .filter(a => a.guidelineId === guidelineId)
      .map(a => a.siteUrl);
  }
}
