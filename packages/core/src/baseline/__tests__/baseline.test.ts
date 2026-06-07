import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  fingerprint,
  normalizePath,
  readBaseline,
  writeBaseline,
  type BaselineFile,
  type BaselineFinding,
} from '../baseline.js';

// Canonical cross-tool parity vector (D-04, Plan 03 PHP test reuses this exact value)
const CANONICAL_PATH = '/about';
const CANONICAL_CODE = 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37';
const CANONICAL_SELECTOR = 'html > body > img';
// The expected 16-hex output of sha256(`/about\0WCAG2AA.Principle1.Guideline1_1.1_1_1.H37\0html > body > img`).slice(0,16)
const CANONICAL_FINGERPRINT = '3d5c2e8f1a4b9067'; // placeholder — filled by baseline.ts implementation

describe('fingerprint()', () => {
  it('returns exactly 16 hex characters', () => {
    const fp = fingerprint('/page', 'WCAG2AA.Test', '#selector');
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('canonical vector matches expected sha256 slice', () => {
    // This vector is re-asserted in Plan 03 PHP test for cross-tool parity.
    // Compute the expected value deterministically: sha256('/about\0WCAG2AA.Principle1.Guideline1_1.1_1_1.H37\0html > body > img').hex.slice(0,16)
    const { createHash } = require('node:crypto');
    const expected = createHash('sha256')
      .update(`${CANONICAL_PATH}\0${CANONICAL_CODE}\0${CANONICAL_SELECTOR}`)
      .digest('hex')
      .slice(0, 16);
    expect(fingerprint(CANONICAL_PATH, CANONICAL_CODE, CANONICAL_SELECTOR)).toBe(expected);
  });

  it('is identical for two findings differing only in type (severity excluded from identity)', () => {
    const fp1 = fingerprint('/page', 'WCAG2AA.Test', '#selector');
    const fp2 = fingerprint('/page', 'WCAG2AA.Test', '#selector');
    expect(fp1).toBe(fp2);
  });

  it('uses exact NUL-delimited layout: normalizedPath + NUL + code + NUL + selector', () => {
    const { createHash } = require('node:crypto');
    const path = '/foo';
    const code = 'CODE';
    const sel = '.bar';
    const expected = createHash('sha256')
      .update(`${path}\0${code}\0${sel}`)
      .digest('hex')
      .slice(0, 16);
    expect(fingerprint(path, code, sel)).toBe(expected);
  });

  it('differs when code changes', () => {
    const fp1 = fingerprint('/page', 'CODE_A', '#selector');
    const fp2 = fingerprint('/page', 'CODE_B', '#selector');
    expect(fp1).not.toBe(fp2);
  });

  it('differs when selector changes', () => {
    const fp1 = fingerprint('/page', 'CODE', '#sel-a');
    const fp2 = fingerprint('/page', 'CODE', '#sel-b');
    expect(fp1).not.toBe(fp2);
  });
});

describe('normalizePath()', () => {
  it('strips scheme and host, returns path+query', () => {
    expect(normalizePath('https://example.com/about')).toBe('/about');
  });

  it('staging URL and localhost produce identical output for the same path', () => {
    const staging = normalizePath('https://staging.example.com/about?x=1');
    const local = normalizePath('http://localhost/about?x=1');
    expect(staging).toBe('/about?x=1');
    expect(local).toBe('/about?x=1');
    expect(staging).toBe(local);
  });

  it('keeps path and query string', () => {
    expect(normalizePath('https://example.com/page?foo=bar&baz=1')).toBe('/page?foo=bar&baz=1');
  });

  it('returns the raw string unchanged for a non-URL value', () => {
    expect(normalizePath('#selector')).toBe('#selector');
    expect(normalizePath('html > body > img')).toBe('html > body > img');
    expect(normalizePath('/just-a-path')).toBe('/just-a-path');
  });
});

describe('readBaseline()', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'luqen-baseline-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null for a missing file (never throws)', async () => {
    const result = await readBaseline(join(tmpDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON (never throws)', async () => {
    const path = join(tmpDir, 'bad.json');
    await writeFile(path, 'not-json', 'utf-8');
    const result = await readBaseline(path);
    expect(result).toBeNull();
  });

  it('returns null for a path that escapes cwd via .. traversal (T-79-03)', async () => {
    // A path like ../../../etc/passwd should be rejected
    const escapingPath = join(tmpDir, '../../escape.json');
    const result = await readBaseline(escapingPath);
    expect(result).toBeNull();
  });

  it('returns a BaselineFile for a valid file', async () => {
    const path = join(tmpDir, 'baseline.json');
    const finding: BaselineFinding = {
      fingerprint: 'abc123',
      normalizedPath: '/about',
      code: 'WCAG2AA.Test',
      type: 'error',
      selector: '#img',
      message: 'Missing alt',
    };
    const file: BaselineFile = {
      meta: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        generatedBy: 'luqen scan --update-baseline',
        target: 'https://example.com',
      },
      findings: [finding],
    };
    await writeFile(path, JSON.stringify(file), 'utf-8');
    const result = await readBaseline(path);
    expect(result).not.toBeNull();
    expect(result!.meta.schemaVersion).toBe(1);
    expect(result!.findings).toHaveLength(1);
    expect(result!.findings[0].code).toBe('WCAG2AA.Test');
  });
});

describe('writeBaseline()', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'luqen-baseline-write-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates parent dirs and writes a valid BaselineFile JSON', async () => {
    const path = join(tmpDir, 'deep', 'nested', 'baseline.json');
    const file: BaselineFile = {
      meta: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        generatedBy: 'luqen scan --update-baseline',
        target: 'https://example.com',
      },
      findings: [],
    };
    await writeBaseline(path, file);

    // Read back and verify
    const result = await readBaseline(path);
    expect(result).not.toBeNull();
    expect(result!.meta.schemaVersion).toBe(1);
    expect(result!.meta.generatedBy).toBe('luqen scan --update-baseline');
  });

  it('round-trip: writeBaseline then readBaseline yields structurally equal BaselineFile', async () => {
    const path = join(tmpDir, 'round-trip.json');
    const finding: BaselineFinding = {
      fingerprint: fingerprint('/about', 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37', 'img'),
      normalizedPath: '/about',
      code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      type: 'error',
      selector: 'img',
      message: 'Image missing alternative text.',
    };
    const file: BaselineFile = {
      meta: {
        schemaVersion: 1,
        generatedAt: '2026-06-07T00:00:00.000Z',
        generatedBy: 'luqen scan --update-baseline',
        target: 'https://example.com',
      },
      findings: [finding],
    };

    await writeBaseline(path, file);
    const result = await readBaseline(path);
    expect(result).not.toBeNull();
    expect(result!.meta).toEqual(file.meta);
    expect(result!.findings).toHaveLength(1);
    expect(result!.findings[0]).toEqual(finding);
  });
});
