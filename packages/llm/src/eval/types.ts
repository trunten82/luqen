// Named error classes for reference-set loading refusals (EVALSET-02).
//
// Every failure below propagates as a NAMED error subclass carrying the
// specific values that made the load fail — never a bare `Error`, and never a
// swallow-and-return-default handler (the opposite of config.ts:readConfigFile).

export class InvalidReferenceSetError extends Error {
  constructor(
    public readonly setPath: string,
    public readonly detail: string,
  ) {
    super(`Invalid reference set at "${setPath}": ${detail}`);
    this.name = 'InvalidReferenceSetError';
  }
}

export class ReferenceSetVersionMismatchError extends Error {
  constructor(
    public readonly setPath: string,
    public readonly expected: string,
    public readonly found: string,
  ) {
    super(
      `Reference set at "${setPath}" has setVersion "${found}", expected "${expected}"`,
    );
    this.name = 'ReferenceSetVersionMismatchError';
  }
}

export class UnattributedReferenceItemError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly setPath: string,
  ) {
    super(
      `Reference item "${itemId}" in "${setPath}" has no attributed provenance`,
    );
    this.name = 'UnattributedReferenceItemError';
  }
}

export class InvalidProvenanceTierError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly tier: string,
    public readonly setPath: string,
  ) {
    super(
      `Reference item "${itemId}" in "${setPath}" has invalid provenance tier "${tier}" (expected w3c|owner|derived)`,
    );
    this.name = 'InvalidProvenanceTierError';
  }
}

export class MissingReferenceAssetError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly assetPath: string,
  ) {
    super(`Reference item "${itemId}" is missing its asset at "${assetPath}"`);
    this.name = 'MissingReferenceAssetError';
  }
}

export class UnsafeReferenceIdentifierError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly reason: string,
  ) {
    super(`Reference item id "${itemId}" is unsafe: ${reason}`);
    this.name = 'UnsafeReferenceIdentifierError';
  }
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** A single attributable source document/page, cited by its stable identifier. */
export interface Citation {
  readonly id: string;
  readonly url: string;
  readonly retrievedAt: string;
  /** The W3C Document License (or equivalent) attribution string for this citation. */
  readonly notice: string;
}

/** Tier 2 (D-01): adjudicated by the product owner. An opinion with a name on it. */
export interface OwnerProvenance {
  readonly tier: 'owner';
  readonly adjudicatedBy: string;
  readonly adjudicatedAt: string;
  readonly rationale: string;
}

/** Tier 1 (D-01) for a WCAG fix item — the fix is canonical, not somebody's opinion. */
export interface WcagW3cProvenance {
  readonly tier: 'w3c';
  readonly failure: Citation;
  readonly technique: Citation;
  readonly techniqueRating: 'sufficient' | 'advisory';
}

/** Tier 3 (D-01) for a WCAG fix item: the markup is ours, the label is not. */
export interface WcagDerivedProvenance {
  readonly tier: 'derived';
  readonly markupOrigin: 'scan-corpus' | 'luqen-product';
  readonly markupNote: string;
  readonly labelSource: WcagW3cProvenance;
}

export type WcagProvenance = WcagW3cProvenance | OwnerProvenance | WcagDerivedProvenance;

/** Tier 1 (D-01) for an image item — the CATEGORY CRITERIA are W3C, the pixels are not (OR-2). */
export interface ImageW3cProvenance {
  readonly tier: 'w3c';
  readonly guidance: Citation;
}

/** Tier 3 (D-01) for an image item: the markup is ours, the label is not. */
export interface ImageDerivedProvenance {
  readonly tier: 'derived';
  readonly markupOrigin: 'scan-corpus' | 'luqen-product';
  readonly markupNote: string;
  readonly labelSource: ImageW3cProvenance;
}

export type ImageProvenance = ImageW3cProvenance | OwnerProvenance | ImageDerivedProvenance;

/**
 * D-05/EVALSET-05: a poison item is an ORDINARY item with a deliberately-wrong
 * candidate answer attached. The poison is in `candidate`, never in `expected`.
 */
export interface PoisonFlag {
  readonly expect: 'scored-down';
  readonly reason: string;
  /** Deliberately-wrong answer shaped like the capability's own result type. */
  readonly candidate: unknown;
}

/** Reuses GenerateFixInput's exact field names (capabilities/generate-fix.ts) so
 * Phase 84 can spread `item.input` straight into `executeGenerateFix` with no
 * translation layer. */
export interface WcagFixItem {
  readonly id: string;
  readonly input: {
    readonly wcagCriterion: string;
    readonly issueMessage: string;
    readonly htmlContext: string;
    readonly cssContext?: string;
    readonly platform?: 'html' | 'wordpress-gutenberg';
  };
  readonly expected: {
    readonly fixedHtml: string;
    readonly explanationMustMention: readonly string[];
    readonly effort: 'low' | 'medium' | 'high';
  };
  readonly provenance: WcagProvenance;
  readonly poison?: PoisonFlag;
}

/**
 * `expectedVerdict` is a TOP-LEVEL required field (EVALSET-04, D-04) — Phase 84
 * counts false-PASS and false-ISSUE separately and must never infer them from a
 * score. Deliberately narrower than AnalyseVisualResult['verdict']: ground truth
 * is never itself 'uncertain'.
 */
export interface ImageAltItem {
  readonly id: string;
  readonly category: 'informative' | 'complex' | 'decorative' | 'functional';
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  readonly input: {
    readonly check: 'alt-text';
    readonly context: string;
  };
  readonly expectedVerdict: 'issue' | 'pass';
  readonly expected: {
    readonly altClassification: 'decorative' | 'informational';
    readonly suggestedAlt: string;
  };
  readonly licence: {
    readonly id: string;
    readonly name: string;
    readonly sourceUrl: string;
    readonly fileUrl: string;
    readonly author: string;
    readonly retrievedAt: string;
    readonly verifiedVia: string;
  };
  readonly provenance: ImageProvenance;
  readonly poison?: PoisonFlag;
}

/**
 * An `ImageAltItem` as returned by `loadImageAltSet`: the loader DERIVES
 * `assetPath` from the item id (never a caller-supplied field), and throws
 * `MissingReferenceAssetError` when that file is absent.
 */
export interface ResolvedImageAltItem extends ImageAltItem {
  readonly assetPath: string;
}

export interface ReferenceSet<TItem> {
  readonly set: string;
  readonly setVersion: string;
  readonly capability: string;
  readonly notes?: string;
  readonly items: readonly TItem[];
}
