// ---------------------------------------------------------------------------
// Logo cache (Phase 49-01)
//
// Tiny LRU cache of fetched org logos keyed by orgId. Used by the email
// renderer to embed a logo as a CID attachment without re-fetching on every
// notification. The cache is bounded (max 100 orgs), entries expire after
// `DEFAULT_TTL_MS`, and remote fetches time out at `DEFAULT_TIMEOUT_MS` so a
// stalled brand-asset host can never block notification delivery.
//
// Failures (timeout, 4xx/5xx, non-image content-type) resolve to `null` —
// the renderer omits the logo silently in that case.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';

export interface LogoCacheEntry {
  readonly buffer: Buffer;
  readonly contentType: string;
  readonly cachedAt: number;
}

export interface LogoCacheOptions {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
  /** Override fetch — used by tests. */
  readonly fetchImpl?: typeof fetch;
  readonly nowFn?: () => number;
}

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h
const DEFAULT_TIMEOUT_MS = 3000;

export class LogoCache {
  private readonly entries = new Map<string, LogoCacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(opts: LogoCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.nowFn ?? Date.now;
  }

  /** Read-only lookup — does not refresh on stale entries. */
  get(orgId: string): LogoCacheEntry | null {
    const e = this.entries.get(orgId);
    if (e === undefined) return null;
    if (this.now() - e.cachedAt > this.ttlMs) {
      this.entries.delete(orgId);
      return null;
    }
    // LRU bump
    this.entries.delete(orgId);
    this.entries.set(orgId, e);
    return e;
  }

  /**
   * Get-or-fetch. Returns the cached entry when fresh, otherwise fetches
   * from `source` (URL or local file path). On failure (network error,
   * timeout, non-2xx, non-image), returns null and DOES NOT cache the
   * miss — next call retries.
   */
  async fetch(orgId: string, source: string): Promise<LogoCacheEntry | null> {
    const cached = this.get(orgId);
    if (cached !== null) return cached;

    const entry = await this.load(source);
    if (entry === null) return null;

    if (this.entries.size >= this.maxEntries) {
      // Evict oldest (first) — Map preserves insertion order.
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(orgId, entry);
    return entry;
  }

  /** Drop a cached entry — used by branding-update hooks. */
  invalidate(orgId: string): void {
    this.entries.delete(orgId);
  }

  /** Test helper: count of cached entries. */
  size(): number {
    return this.entries.size;
  }

  // -------------------------------------------------------------------------
  // Private — actual fetch logic
  // -------------------------------------------------------------------------

  private async load(source: string): Promise<LogoCacheEntry | null> {
    if (/^https?:\/\//i.test(source)) {
      return this.loadHttp(source);
    }
    // Treat as local file path (BrandingGuidelineRecord.imagePath)
    return this.loadFile(source);
  }

  private async loadHttp(url: string): Promise<LogoCacheEntry | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) return null;
      const arr = await res.arrayBuffer();
      return {
        buffer: Buffer.from(arr),
        contentType,
        cachedAt: this.now(),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async loadFile(path: string): Promise<LogoCacheEntry | null> {
    try {
      const s = await stat(path);
      if (!s.isFile()) return null;
      const buffer = await readFile(path);
      return {
        buffer,
        contentType: contentTypeFromExtension(path),
        cachedAt: this.now(),
      };
    } catch {
      return null;
    }
  }
}

function contentTypeFromExtension(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
