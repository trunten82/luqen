// TypeBox schemas mirroring types.ts (OR-1: TypeBox, not zod — matches the
// module-scope Type.Object idiom used throughout src/api/routes/*.ts).
import { Type, type TSchema } from '@sinclair/typebox';

// A dot-free lowercase slug cannot be a hostname (identifiers are content).
// The additional 4+-digit-run / dot check happens at runtime in
// load-reference-set.ts (UnsafeReferenceIdentifierError) since it needs to
// fire as its OWN named error, distinct from a structural schema failure.
const ItemId = Type.String({ pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' });

const Citation = Type.Object({
  id: Type.String(),
  url: Type.String(),
  retrievedAt: Type.String(),
  notice: Type.String(),
});

const OwnerProvenance = Type.Object({
  tier: Type.Literal('owner'),
  adjudicatedBy: Type.String(),
  adjudicatedAt: Type.String(),
  rationale: Type.String(),
});

const WcagW3cProvenance = Type.Object({
  tier: Type.Literal('w3c'),
  failure: Citation,
  technique: Citation,
  techniqueRating: Type.Union([Type.Literal('sufficient'), Type.Literal('advisory')]),
});

const WcagDerivedProvenance = Type.Object({
  tier: Type.Literal('derived'),
  markupOrigin: Type.Union([Type.Literal('scan-corpus'), Type.Literal('luqen-product')]),
  markupNote: Type.String(),
  labelSource: WcagW3cProvenance,
});

const WcagProvenance = Type.Union([WcagW3cProvenance, OwnerProvenance, WcagDerivedProvenance]);

const ImageW3cProvenance = Type.Object({
  tier: Type.Literal('w3c'),
  guidance: Citation,
});

const ImageDerivedProvenance = Type.Object({
  tier: Type.Literal('derived'),
  markupOrigin: Type.Union([Type.Literal('scan-corpus'), Type.Literal('luqen-product')]),
  markupNote: Type.String(),
  labelSource: ImageW3cProvenance,
});

const ImageProvenance = Type.Union([ImageW3cProvenance, OwnerProvenance, ImageDerivedProvenance]);

// candidate is a deliberately-wrong answer shaped like the capability's own
// result type; it must survive round-trip intact but is never itself
// structurally validated (D-05/EVALSET-05 — the loader carries poison items,
// it does not police the shape of a deliberately-wrong answer).
const Poison = Type.Object({
  expect: Type.Literal('scored-down'),
  reason: Type.String(),
  candidate: Type.Unknown(),
});

export const WcagFixItemSchema: TSchema = Type.Object({
  id: ItemId,
  input: Type.Object({
    wcagCriterion: Type.String(),
    issueMessage: Type.String(),
    htmlContext: Type.String(),
    cssContext: Type.Optional(Type.String()),
    platform: Type.Optional(
      Type.Union([Type.Literal('html'), Type.Literal('wordpress-gutenberg')]),
    ),
  }),
  expected: Type.Object({
    fixedHtml: Type.String(),
    explanationMustMention: Type.Array(Type.String()),
    effort: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
  }),
  provenance: WcagProvenance,
  poison: Type.Optional(Poison),
});

export const ImageAltItemSchema: TSchema = Type.Object({
  id: ItemId,
  category: Type.Union([
    Type.Literal('informative'),
    Type.Literal('complex'),
    Type.Literal('decorative'),
    Type.Literal('functional'),
  ]),
  mediaType: Type.Union([
    Type.Literal('image/png'),
    Type.Literal('image/jpeg'),
    Type.Literal('image/webp'),
    Type.Literal('image/gif'),
  ]),
  input: Type.Object({
    check: Type.Literal('alt-text'),
    context: Type.String(),
  }),
  expectedVerdict: Type.Union([Type.Literal('issue'), Type.Literal('pass')]),
  expected: Type.Object({
    altClassification: Type.Union([Type.Literal('decorative'), Type.Literal('informational')]),
    suggestedAlt: Type.String(),
  }),
  licence: Type.Object({
    id: Type.String(),
    name: Type.String(),
    sourceUrl: Type.String(),
    fileUrl: Type.String(),
    author: Type.String(),
    retrievedAt: Type.String(),
    verifiedVia: Type.String(),
  }),
  provenance: ImageProvenance,
  poison: Type.Optional(Poison),
});

export const WcagFixSetSchema: TSchema = Type.Object({
  set: Type.Literal('wcag-fixes'),
  setVersion: Type.String(),
  capability: Type.Literal('generate-fix'),
  notes: Type.Optional(Type.String()),
  items: Type.Array(WcagFixItemSchema),
});

export const ImageAltSetSchema: TSchema = Type.Object({
  set: Type.Literal('image-alt'),
  setVersion: Type.String(),
  capability: Type.Literal('analyse-visual'),
  notes: Type.Optional(Type.String()),
  items: Type.Array(ImageAltItemSchema),
});
