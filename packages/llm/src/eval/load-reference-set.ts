import { readFileSync } from 'node:fs';
import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';
import { WcagFixItemSchema, WcagFixSetSchema } from './schema.js';
import {
  InvalidReferenceSetError,
  InvalidProvenanceTierError,
  ReferenceSetVersionMismatchError,
  UnattributedReferenceItemError,
  UnsafeReferenceIdentifierError,
  type ReferenceSet,
  type WcagFixItem,
} from './types.js';

const KNOWN_TIERS = new Set(['w3c', 'owner', 'derived']);

// An id containing a run of 4+ digits (a year or a timestamp) or a dot could
// encode a real host, person, or time — identifiers are content.
const UNSAFE_ID_PATTERN = /\d{4,}|\./;

/**
 * `config.ts`'s `readConfigFile` is allowed to swallow-and-default because a
 * missing config file is a normal first-run state. A reference set is the
 * OPPOSITE: EVALSET-02 requires the loader to REFUSE loudly. Every failure
 * below propagates as a named error — no catch-and-return-default anywhere in
 * this file.
 */
function readAndParse(setPath: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(setPath, 'utf-8');
  } catch (err) {
    throw new InvalidReferenceSetError(
      setPath,
      `could not read file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new InvalidReferenceSetError(
      setPath,
      `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

interface RawSetShape {
  readonly set: string;
  readonly setVersion: string;
  readonly capability: string;
  readonly notes?: string;
  readonly items: readonly unknown[];
}

function assertTopLevelShape(parsed: unknown, setPath: string): RawSetShape {
  if (parsed === null || typeof parsed !== 'object') {
    throw new InvalidReferenceSetError(setPath, 'top-level value is not an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj.set !== 'string' ||
    typeof obj.setVersion !== 'string' ||
    typeof obj.capability !== 'string' ||
    !Array.isArray(obj.items)
  ) {
    throw new InvalidReferenceSetError(
      setPath,
      'missing or malformed "set", "setVersion", "capability", or "items" (items must be an array)',
    );
  }
  return obj as unknown as RawSetShape;
}

function extractItemId(rawItem: unknown, index: number): string {
  if (
    rawItem !== null &&
    typeof rawItem === 'object' &&
    typeof (rawItem as Record<string, unknown>).id === 'string'
  ) {
    return (rawItem as Record<string, unknown>).id as string;
  }
  return `<item-index-${index}>`;
}

/** EVALSET-02: an item with no attributed provenance never loads. */
function assertAttributedProvenance(rawItem: unknown, itemId: string, setPath: string): void {
  const item = rawItem as Record<string, unknown>;
  const provenance = item.provenance;
  if (provenance === undefined || provenance === null || typeof provenance !== 'object') {
    throw new UnattributedReferenceItemError(itemId, setPath);
  }
  const tier = (provenance as Record<string, unknown>).tier;
  if (tier === undefined || tier === null || tier === '') {
    // An untiered item is unattributed, not merely malformed.
    throw new UnattributedReferenceItemError(itemId, setPath);
  }
  if (typeof tier !== 'string' || !KNOWN_TIERS.has(tier)) {
    throw new InvalidProvenanceTierError(itemId, String(tier), setPath);
  }
}

function assertSafeId(itemId: string): void {
  if (UNSAFE_ID_PATTERN.test(itemId)) {
    throw new UnsafeReferenceIdentifierError(
      itemId,
      'id contains a 4+ digit run or a dot, which could encode a real host, person, or timestamp',
    );
  }
}

function firstSchemaErrorDetail(schema: TSchema, value: unknown, itemId: string): string {
  const errors = [...Value.Errors(schema, value)];
  const first = errors[0];
  if (first == null) return `item "${itemId}" failed schema validation`;
  return `item "${itemId}": ${first.path} ${first.message}`;
}

/** Deep-freezes a plain JSON value so a caller mutating a returned item either
 * throws (strict mode) or has no effect — matching config.ts's
 * Object.freeze pattern, extended to the nested shape of a reference item. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function validateItem<TItem>(
  rawItem: unknown,
  index: number,
  itemSchema: TSchema,
  setPath: string,
): TItem {
  const itemId = extractItemId(rawItem, index);

  if (rawItem === null || typeof rawItem !== 'object') {
    throw new InvalidReferenceSetError(setPath, `item at index ${index} is not an object`);
  }

  // Steps 4-5: provenance/tier checks run BEFORE the full structural check so
  // each produces its own named error (EVALSET-02's refusal is not merely a
  // schema-validation failure).
  assertAttributedProvenance(rawItem, itemId, setPath);

  // Step 6: full TypeBox structural check.
  if (!Value.Check(itemSchema, rawItem)) {
    throw new InvalidReferenceSetError(setPath, firstSchemaErrorDetail(itemSchema, rawItem, itemId));
  }

  // Step 7: id safety, checked last so a malformed item never reaches this far
  // carrying an unsafe id undetected.
  assertSafeId(itemId);

  return deepFreeze(rawItem) as TItem;
}

function loadTypedSet<TItem>(
  setPath: string,
  expectedVersion: string,
  expectedSetName: string,
  expectedCapability: string,
  itemSchema: TSchema,
): ReferenceSet<TItem> {
  const parsed = readAndParse(setPath);
  const raw = assertTopLevelShape(parsed, setPath);

  if (raw.set !== expectedSetName) {
    throw new InvalidReferenceSetError(
      setPath,
      `expected set "${expectedSetName}", found "${raw.set}"`,
    );
  }
  if (raw.capability !== expectedCapability) {
    throw new InvalidReferenceSetError(
      setPath,
      `expected capability "${expectedCapability}", found "${raw.capability}"`,
    );
  }
  if (raw.setVersion !== expectedVersion) {
    throw new ReferenceSetVersionMismatchError(setPath, expectedVersion, raw.setVersion);
  }

  const items = raw.items.map((rawItem, index) =>
    validateItem<TItem>(rawItem, index, itemSchema, setPath),
  );

  return deepFreeze({
    set: raw.set,
    setVersion: raw.setVersion,
    capability: raw.capability,
    notes: raw.notes,
    items,
  });
}

export function loadWcagFixSet(setPath: string, expectedVersion: string): ReferenceSet<WcagFixItem> {
  return loadTypedSet<WcagFixItem>(
    setPath,
    expectedVersion,
    'wcag-fixes',
    'generate-fix',
    WcagFixItemSchema,
  );
}

// Exported for reuse by loadImageAltSet (Task 2) so both loaders share this
// exact refusal ladder rather than forking a second validation routine.
export { loadTypedSet, deepFreeze, assertSafeId, UNSAFE_ID_PATTERN };

// Re-exported so callers that only imported from this module still get the
// full-set schema without a second import path.
export { WcagFixSetSchema };
