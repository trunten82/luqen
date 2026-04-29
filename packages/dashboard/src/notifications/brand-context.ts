// ---------------------------------------------------------------------------
// Brand context adapter (Phase 49-01)
//
// Exposes the minimum brand metadata the channel renderers need: the org's
// logo source (file path or URL) and the primary/secondary brand colors.
// The renderers consume this *synchronously* (after one async resolve) so
// the cost of a missing org or missing guideline is just a single repo call.
//
// Returns `null` when the org has no active branding guideline — the
// renderers fall back to neutral defaults in that case.
// ---------------------------------------------------------------------------

import type { BrandingRepository } from '../db/interfaces/branding-repository.js';
import type { BrandingGuidelineRecord } from '../db/types.js';

export interface BrandContext {
  readonly orgId: string;
  readonly logoSource?: string; // file path or http(s) URL
  readonly colors: {
    readonly primary: string;
    readonly secondary?: string;
  };
}

const DEFAULT_PRIMARY = '#1f4e7a';
const HEX_RE = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

function normaliseHex(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!HEX_RE.test(trimmed)) return undefined;
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function pickPrimaryColor(guideline: BrandingGuidelineRecord): string {
  const colors = guideline.colors ?? [];
  // Prefer explicit "primary" usage, else first valid hex.
  const primary = colors.find((c) => (c.usage ?? '').toLowerCase().includes('primary'));
  const fallback = colors[0];
  const candidate = primary?.hexValue ?? fallback?.hexValue;
  return normaliseHex(candidate) ?? DEFAULT_PRIMARY;
}

function pickSecondaryColor(guideline: BrandingGuidelineRecord): string | undefined {
  const colors = guideline.colors ?? [];
  const secondary = colors.find((c) => (c.usage ?? '').toLowerCase().includes('secondary'));
  return normaliseHex(secondary?.hexValue);
}

export interface BrandContextProvider {
  get(orgId: string): Promise<BrandContext | null>;
}

export class BrandingRepoBrandContextProvider implements BrandContextProvider {
  constructor(private readonly branding: BrandingRepository) {}

  async get(orgId: string): Promise<BrandContext | null> {
    let guidelines: readonly BrandingGuidelineRecord[];
    try {
      guidelines = await this.branding.listGuidelines(orgId);
    } catch {
      return null;
    }
    if (guidelines.length === 0) return null;
    // Active guideline preferred, else the first row (listGuidelines returns
    // sorted by updated_at DESC in current sqlite implementation).
    const active = guidelines.find((g) => g.active) ?? guidelines[0];

    // Hydrate colors if missing (listGuidelines may omit them per impl).
    let colors = active.colors;
    if (colors === undefined) {
      try {
        colors = await this.branding.listColors(active.id);
      } catch {
        colors = [];
      }
    }
    const hydrated: BrandingGuidelineRecord = { ...active, colors };

    const ctx: BrandContext = {
      orgId,
      colors: {
        primary: pickPrimaryColor(hydrated),
        ...(pickSecondaryColor(hydrated) !== undefined
          ? { secondary: pickSecondaryColor(hydrated) as string }
          : {}),
      },
      ...(active.imagePath !== undefined ? { logoSource: active.imagePath } : {}),
    };
    return ctx;
  }
}

/** Test helper: build a `BrandContextProvider` from a fixed map. */
export function staticBrandContextProvider(
  byOrg: Readonly<Record<string, BrandContext | null>>,
): BrandContextProvider {
  return {
    get: async (orgId) =>
      Object.prototype.hasOwnProperty.call(byOrg, orgId) ? byOrg[orgId] : null,
  };
}

export const DEFAULT_BRAND_PRIMARY_COLOR = DEFAULT_PRIMARY;
