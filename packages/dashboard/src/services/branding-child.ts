/**
 * Does a brand color/font/selector belong to a given guideline? Shared by the
 * admin HTML branding routes and the /api/v1/branding JSON routes, which both
 * address a child as /guidelines/:id/<kind>/:childId and must refuse a child
 * id that belongs to some other guideline.
 */
import type { StorageAdapter } from '../db/adapter.js';

export type BrandingChildKind = 'color' | 'font' | 'selector';

export async function guidelineHasChild(
  storage: StorageAdapter,
  kind: BrandingChildKind,
  guidelineId: string,
  childId: string,
): Promise<boolean> {
  const children = kind === 'color'
    ? await storage.branding.listColors(guidelineId)
    : kind === 'font'
      ? await storage.branding.listFonts(guidelineId)
      : await storage.branding.listSelectors(guidelineId);
  return children.some((c) => c.id === childId);
}
