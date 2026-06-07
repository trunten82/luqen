/**
 * Baseline store: fingerprinting, URL normalization, and baseline file I/O.
 *
 * Security:
 * - T-79-01: JSON.parse inside try/catch; never eval/require baseline content
 * - T-79-03: resolve() the baseline path and confirm containment within cwd
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaselineFinding {
  readonly fingerprint: string;
  readonly normalizedPath: string;
  readonly code: string;
  readonly type: 'error' | 'warning' | 'notice';
  readonly selector: string;
  readonly message: string;
}

export interface BaselineFile {
  readonly meta: {
    readonly schemaVersion: 1;
    readonly generatedAt: string;
    readonly generatedBy: string; // 'luqen scan --update-baseline'
    readonly target: string;
  };
  readonly findings: readonly BaselineFinding[];
}

// ---------------------------------------------------------------------------
// Fingerprint (D-04)
//
// Stable identity: sha256(normalizedPath NUL code NUL selector).hex.slice(0,16)
// Severity/type is EXCLUDED from identity — a finding that changes severity
// is still the same finding, not a new one.
// This byte layout is the cross-tool contract Plan 03 (WP PHP) must reproduce.
// ---------------------------------------------------------------------------

export function fingerprint(
  normalizedPath: string,
  code: string,
  selector: string,
): string {
  return createHash('sha256')
    .update(`${normalizedPath}\0${code}\0${selector}`)
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// URL normalization (D-05)
//
// Drop scheme + host, keep path + query so a baseline captured locally
// (http://localhost) still matches the same page scanned in CI (https://staging…).
// A non-URL string is returned unchanged.
// ---------------------------------------------------------------------------

export function normalizePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + (parsed.search || '');
  } catch {
    // Not a valid URL — return the raw value (e.g. CSS selector, relative path)
    return url;
  }
}

// ---------------------------------------------------------------------------
// Path-traversal safety (T-79-03)
//
// Detect paths that use `..` components to escape out of the expected
// directory hierarchy.  A path like `../../etc/shadow` would resolve to a
// location that differs from what a naive join would produce, indicating
// traversal intent.
//
// Strategy: split the normalized path into segments and reject any path that
// contains a `..` component, which is the canonical traversal indicator.
// Absolute paths to outside cwd are fine (the developer explicitly passes
// them); only paths containing `..` segments are rejected.
// ---------------------------------------------------------------------------

function hasTraversalComponents(baselinePath: string): boolean {
  // Normalize separators and split into segments
  const normalized = baselinePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments.some((seg) => seg === '..');
}

// ---------------------------------------------------------------------------
// readBaseline (D-10)
//
// Returns null on missing/unreadable/invalid-JSON file — never throws.
// Returns null (with implicit diagnostic at call site) for paths escaping cwd.
// ---------------------------------------------------------------------------

export async function readBaseline(path: string): Promise<BaselineFile | null> {
  // T-79-03: reject paths containing .. traversal components
  if (hasTraversalComponents(path)) {
    return null;
  }

  try {
    const raw = await readFile(path, 'utf-8');
    // T-79-01: parse inside try/catch, never eval/require
    return JSON.parse(raw) as BaselineFile;
  } catch {
    // File missing, unreadable, or invalid JSON — caller handles the diagnostic
    return null;
  }
}

// ---------------------------------------------------------------------------
// writeBaseline
//
// Creates parent dirs (mkdir recursive) and writes the BaselineFile as JSON.
// ---------------------------------------------------------------------------

export async function writeBaseline(path: string, file: BaselineFile): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(resolve(path), JSON.stringify(file, null, 2), 'utf-8');
}
