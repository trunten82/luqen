import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { computeDirectoryChecksum } from '../../src/plugins/checksum.js';

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `checksum-test-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
});

describe('computeDirectoryChecksum', () => {
  it('produces a 64-char hex hash', () => {
    writeFileSync(join(testDir, 'index.js'), 'module.exports = {}');
    const hash = computeDirectoryChecksum(testDir);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same hash for identical content', () => {
    writeFileSync(join(testDir, 'a.txt'), 'hello');
    writeFileSync(join(testDir, 'b.txt'), 'world');
    const hash1 = computeDirectoryChecksum(testDir);
    const hash2 = computeDirectoryChecksum(testDir);
    expect(hash1).toBe(hash2);
  });

  it('returns different hash when file content changes', () => {
    writeFileSync(join(testDir, 'index.js'), 'original');
    const hash1 = computeDirectoryChecksum(testDir);

    writeFileSync(join(testDir, 'index.js'), 'modified');
    const hash2 = computeDirectoryChecksum(testDir);

    expect(hash1).not.toBe(hash2);
  });

  it('returns different hash when a file is added', () => {
    writeFileSync(join(testDir, 'a.txt'), 'content');
    const hash1 = computeDirectoryChecksum(testDir);

    writeFileSync(join(testDir, 'b.txt'), 'extra');
    const hash2 = computeDirectoryChecksum(testDir);

    expect(hash1).not.toBe(hash2);
  });

  it('includes subdirectory files', () => {
    mkdirSync(join(testDir, 'sub'), { recursive: true });
    writeFileSync(join(testDir, 'sub', 'deep.txt'), 'deep content');
    const hash1 = computeDirectoryChecksum(testDir);

    writeFileSync(join(testDir, 'sub', 'deep.txt'), 'changed');
    const hash2 = computeDirectoryChecksum(testDir);

    expect(hash1).not.toBe(hash2);
  });

  it('ignores node_modules directory', () => {
    writeFileSync(join(testDir, 'index.js'), 'main');
    mkdirSync(join(testDir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(testDir, 'node_modules', 'dep', 'pkg.json'), '{}');
    const hash1 = computeDirectoryChecksum(testDir);

    // Modifying node_modules should not change the hash
    writeFileSync(join(testDir, 'node_modules', 'dep', 'pkg.json'), '{"v":2}');
    const hash2 = computeDirectoryChecksum(testDir);

    expect(hash1).toBe(hash2);
  });

  it('detects file rename (different path same content)', () => {
    writeFileSync(join(testDir, 'old-name.js'), 'content');
    const hash1 = computeDirectoryChecksum(testDir);

    rmSync(join(testDir, 'old-name.js'));
    writeFileSync(join(testDir, 'new-name.js'), 'content');
    const hash2 = computeDirectoryChecksum(testDir);

    expect(hash1).not.toBe(hash2);
  });
});
