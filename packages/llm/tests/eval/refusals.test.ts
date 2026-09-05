import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWcagFixSet, loadImageAltSet } from '../../src/eval/load-reference-set.js';
import {
  InvalidReferenceSetError,
  InvalidProvenanceTierError,
  MissingReferenceAssetError,
  ReferenceSetVersionMismatchError,
  UnattributedReferenceItemError,
  UnsafeReferenceIdentifierError,
} from '../../src/eval/types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const REAL_WCAG_SET_PATH = join(__dirname, 'sets', 'wcag-fixes.v1.json');
const REAL_IMAGE_SET_PATH = join(__dirname, 'sets', 'image-alt.v1.json');
const REAL_IMAGES_DIR = join(__dirname, 'images');
const SEED_ASSET_PATH = join(REAL_IMAGES_DIR, 'img-informative-seed.jpg');

function loadRealWcagSet(): Json {
  return JSON.parse(readFileSync(REAL_WCAG_SET_PATH, 'utf-8'));
}

function loadRealImageSet(): Json {
  return JSON.parse(readFileSync(REAL_IMAGE_SET_PATH, 'utf-8'));
}

/** Every case builds a MUTATED COPY of a real committed set in a fresh temp
 * directory — never a malformed file committed alongside the real ones. */
function tempWcagSetPath(mutate: (data: Json) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'luqen-eval-'));
  mkdirSync(join(dir, 'sets'), { recursive: true });
  const data = structuredClone(loadRealWcagSet());
  mutate(data);
  const setPath = join(dir, 'sets', 'wcag-fixes.v1.json');
  writeFileSync(setPath, JSON.stringify(data));
  return setPath;
}

// Mirrors load-reference-set.ts's MEDIA_TYPE_EXTENSIONS mapping exactly — the
// production code maps 'image/jpeg' to the 'jpg' extension, not 'jpeg'.
const MEDIA_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function tempImageSetPath(mutate: (data: Json) => void, opts?: { skipAsset?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'luqen-eval-'));
  mkdirSync(join(dir, 'sets'), { recursive: true });
  mkdirSync(join(dir, 'images'), { recursive: true });
  const data = structuredClone(loadRealImageSet());
  mutate(data);
  const setPath = join(dir, 'sets', 'image-alt.v1.json');
  writeFileSync(setPath, JSON.stringify(data));
  if (!opts?.skipAsset) {
    for (const item of data.items as Json[]) {
      const ext = MEDIA_TYPE_TO_EXT[String(item.mediaType)];
      copyFileSync(SEED_ASSET_PATH, join(dir, 'images', `${item.id}.${ext}`));
    }
  }
  return setPath;
}

function captureError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

describe('reference-set loader refusals — every named error observed firing', () => {
  it('UnattributedReferenceItemError: provenance deleted from an item, naming that item id', () => {
    const setPath = tempWcagSetPath((data) => {
      delete data.items[0].provenance;
    });

    const err = captureError(() => loadWcagFixSet(setPath, 'v1'));

    expect(err).toBeInstanceOf(UnattributedReferenceItemError);
    expect((err as UnattributedReferenceItemError).itemId).toBe('wcag-img-missing-alt-01');
  });

  it('InvalidProvenanceTierError: provenance.tier is an unknown value, carrying that tier string', () => {
    const setPath = tempWcagSetPath((data) => {
      data.items[0].provenance.tier = 'wikipedia';
    });

    const err = captureError(() => loadWcagFixSet(setPath, 'v1'));

    expect(err).toBeInstanceOf(InvalidProvenanceTierError);
    expect((err as InvalidProvenanceTierError).tier).toBe('wikipedia');
  });

  it('UnattributedReferenceItemError: provenance.tier deleted but the rest of provenance intact', () => {
    const setPath = tempWcagSetPath((data) => {
      delete data.items[0].provenance.tier;
    });

    const err = captureError(() => loadWcagFixSet(setPath, 'v1'));

    // An untiered item is unattributed, not merely malformed.
    expect(err).toBeInstanceOf(UnattributedReferenceItemError);
    expect((err as UnattributedReferenceItemError).itemId).toBe('wcag-img-missing-alt-01');
  });

  it('ReferenceSetVersionMismatchError: setVersion does not match the requested version', () => {
    const setPath = tempWcagSetPath((data) => {
      data.setVersion = 'v2';
    });

    const err = captureError(() => loadWcagFixSet(setPath, 'v1'));

    expect(err).toBeInstanceOf(ReferenceSetVersionMismatchError);
    expect((err as ReferenceSetVersionMismatchError).expected).toBe('v1');
    expect((err as ReferenceSetVersionMismatchError).found).toBe('v2');
  });

  it('InvalidReferenceSetError: file truncated to invalid JSON, never an empty-array/{} default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'luqen-eval-'));
    mkdirSync(join(dir, 'sets'), { recursive: true });
    const setPath = join(dir, 'sets', 'wcag-fixes.v1.json');
    writeFileSync(setPath, '{ this is not valid json');

    const err = captureError(() => loadWcagFixSet(setPath, 'v1'));

    expect(err).toBeInstanceOf(InvalidReferenceSetError);
    expect((err as InvalidReferenceSetError).detail).toMatch(/invalid JSON/i);
  });

  it('InvalidReferenceSetError: a required field deleted, message names the offending field path', () => {
    const setPath = tempWcagSetPath((data) => {
      delete data.items[0].expected.fixedHtml;
    });

    const err = captureError(() => loadWcagFixSet(setPath, 'v1'));

    expect(err).toBeInstanceOf(InvalidReferenceSetError);
    expect((err as InvalidReferenceSetError).message).toContain('fixedHtml');
  });

  it('MissingReferenceAssetError: an image item asset file removed from the temp copy', () => {
    const setPath = tempImageSetPath(() => {}, { skipAsset: true });

    const err = captureError(() => loadImageAltSet(setPath, 'v1'));

    expect(err).toBeInstanceOf(MissingReferenceAssetError);
    expect((err as MissingReferenceAssetError).itemId).toBe('img-informative-seed');
  });

  it('UnsafeReferenceIdentifierError: an id containing a 4+ digit run (a timestamp)', () => {
    const setPath = tempWcagSetPath((data) => {
      data.items[0].id = 'wcag-20260905-fix';
    });

    const err = captureError(() => loadWcagFixSet(setPath, 'v1'));

    expect(err).toBeInstanceOf(UnsafeReferenceIdentifierError);
    expect((err as UnsafeReferenceIdentifierError).itemId).toBe('wcag-20260905-fix');
  });

  it('UnsafeReferenceIdentifierError: an id containing a dot (could be a hostname)', () => {
    const setPath = tempWcagSetPath((data) => {
      data.items[0].id = 'shop.example.com-fix';
    });

    const err = captureError(() => loadWcagFixSet(setPath, 'v1'));

    expect(err).toBeInstanceOf(UnsafeReferenceIdentifierError);
    expect((err as UnsafeReferenceIdentifierError).itemId).toBe('shop.example.com-fix');
  });

  // POSITIVE CONTROL — so the negative cases above cannot pass vacuously. A
  // refusal suite that would also pass against a loader that rejects
  // everything measures nothing.
  it('POSITIVE CONTROL: the unmutated temp copy of the WCAG set loads successfully', () => {
    const setPath = tempWcagSetPath(() => {});

    const result = loadWcagFixSet(setPath, 'v1');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('wcag-img-missing-alt-01');
  });

  it('POSITIVE CONTROL: the unmutated temp copy of the image-alt set loads successfully', () => {
    const setPath = tempImageSetPath(() => {});

    const result = loadImageAltSet(setPath, 'v1');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('img-informative-seed');
  });

  // POISON ROUND-TRIP — D-05/EVALSET-05: poison items are never rejected.
  // 83-02/83-03 add the permanent poison items to the committed sets; this
  // task only proves the loader carries them through.
  it('poison item (WCAG set): loads, is returned, and its candidate survives round-trip intact', () => {
    const poisonCandidate = { fixedHtml: '<img src="../images/animal.jpg">', explanation: 'no change needed', effort: 'low' };
    const setPath = tempWcagSetPath((data) => {
      const poisoned = structuredClone(data.items[0]);
      poisoned.id = 'wcag-poison-seed';
      poisoned.poison = {
        expect: 'scored-down',
        reason: 'candidate leaves the missing alt attribute in place',
        candidate: poisonCandidate,
      };
      data.items.push(poisoned);
    });

    const result = loadWcagFixSet(setPath, 'v1');
    const poisonItem = result.items.find((item) => item.id === 'wcag-poison-seed');

    expect(poisonItem).toBeDefined();
    expect(poisonItem?.poison?.expect).toBe('scored-down');
    expect(poisonItem?.poison?.candidate).toEqual(poisonCandidate);
  });

  it('poison item (image-alt set): loads, is returned, and its candidate survives round-trip intact', () => {
    const poisonCandidate = { verdict: 'pass', findings: [] };
    const setPath = tempImageSetPath((data) => {
      const poisoned = structuredClone(data.items[0]);
      poisoned.id = 'img-poison-seed';
      poisoned.poison = {
        expect: 'scored-down',
        reason: 'candidate wrongly reports pass for a missing-alt image',
        candidate: poisonCandidate,
      };
      data.items.push(poisoned);
    });

    const result = loadImageAltSet(setPath, 'v1');
    const poisonItem = result.items.find((item) => item.id === 'img-poison-seed');

    expect(poisonItem).toBeDefined();
    expect(poisonItem?.poison?.expect).toBe('scored-down');
    expect(poisonItem?.poison?.candidate).toEqual(poisonCandidate);
  });
});
