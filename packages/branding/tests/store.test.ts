import { describe, it, expect, beforeEach } from 'vitest';
import { GuidelineStore } from '../src/store.js';
import type { BrandGuideline } from '../src/types.js';

const makeGuideline = (overrides: Partial<BrandGuideline> = {}): BrandGuideline => ({
  id: 'g1',
  orgId: 'org-1',
  name: 'Test Guide',
  version: 1,
  active: true,
  colors: [],
  fonts: [],
  selectors: [],
  ...overrides,
});

describe('GuidelineStore', () => {
  let store: GuidelineStore;

  beforeEach(() => {
    store = new GuidelineStore();
  });

  it('adds and retrieves a guideline', () => {
    const g = makeGuideline();
    store.addGuideline(g);
    expect(store.getGuideline('g1')).toEqual(g);
  });

  it('lists guidelines by org (filters correctly)', () => {
    const g1 = makeGuideline({ id: 'g1', orgId: 'org-1', name: 'Guide A' });
    const g2 = makeGuideline({ id: 'g2', orgId: 'org-2', name: 'Guide B' });
    store.addGuideline(g1);
    store.addGuideline(g2);

    const org1Results = store.listGuidelines('org-1');
    expect(org1Results).toHaveLength(1);
    expect(org1Results[0].id).toBe('g1');

    const org2Results = store.listGuidelines('org-2');
    expect(org2Results).toHaveLength(1);
    expect(org2Results[0].id).toBe('g2');
  });

  it('updates guideline and bumps version from 1 to 2', () => {
    store.addGuideline(makeGuideline({ version: 1 }));
    store.updateGuideline('g1', { name: 'Updated Guide', active: false });

    const updated = store.getGuideline('g1');
    expect(updated?.name).toBe('Updated Guide');
    expect(updated?.active).toBe(false);
    expect(updated?.version).toBe(2);
    expect(updated?.id).toBe('g1');
    expect(updated?.orgId).toBe('org-1');
  });

  it('removes a guideline (returns null after removal)', () => {
    store.addGuideline(makeGuideline());
    expect(store.getGuideline('g1')).not.toBeNull();

    store.removeGuideline('g1');
    expect(store.getGuideline('g1')).toBeNull();
  });

  it('assigns and resolves guideline for site', () => {
    store.addGuideline(makeGuideline());
    store.assignToSite('g1', 'https://example.com', 'org-1');

    const result = store.getGuidelineForSite('https://example.com', 'org-1');
    expect(result?.id).toBe('g1');
  });

  it('unassigns site (returns null after unassignment)', () => {
    store.addGuideline(makeGuideline());
    store.assignToSite('g1', 'https://example.com', 'org-1');
    expect(store.getGuidelineForSite('https://example.com', 'org-1')).not.toBeNull();

    store.unassignFromSite('https://example.com', 'org-1');
    expect(store.getGuidelineForSite('https://example.com', 'org-1')).toBeNull();
  });

  it('returns null for unassigned site', () => {
    expect(store.getGuidelineForSite('https://unknown.com', 'org-1')).toBeNull();
  });

  it('getSiteAssignments lists all sites for a guideline', () => {
    store.addGuideline(makeGuideline());
    store.assignToSite('g1', 'https://site-a.com', 'org-1');
    store.assignToSite('g1', 'https://site-b.com', 'org-1');

    const assignments = store.getSiteAssignments('g1');
    expect(assignments).toHaveLength(2);
    expect(assignments).toContain('https://site-a.com');
    expect(assignments).toContain('https://site-b.com');
  });

  it('assignToSite replaces existing assignment for same site+org', () => {
    const g1 = makeGuideline({ id: 'g1' });
    const g2 = makeGuideline({ id: 'g2', name: 'Guide 2' });
    store.addGuideline(g1);
    store.addGuideline(g2);

    store.assignToSite('g1', 'https://example.com', 'org-1');
    store.assignToSite('g2', 'https://example.com', 'org-1');

    const result = store.getGuidelineForSite('https://example.com', 'org-1');
    expect(result?.id).toBe('g2');

    // g1 should no longer have the site assignment
    expect(store.getSiteAssignments('g1')).not.toContain('https://example.com');
  });

  it('removeGuideline also removes related site assignments', () => {
    store.addGuideline(makeGuideline());
    store.assignToSite('g1', 'https://example.com', 'org-1');

    store.removeGuideline('g1');
    expect(store.getGuidelineForSite('https://example.com', 'org-1')).toBeNull();
    expect(store.getSiteAssignments('g1')).toHaveLength(0);
  });
});
