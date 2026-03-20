import { createHash } from 'node:crypto';
import { VERSION } from './version.js';

// ---- Types ----

export type SourceType = 'html' | 'rss' | 'api';

export interface FetchedSource {
  readonly url: string;
  readonly content: string;
  readonly contentHash: string;
  readonly fetchedAt: string;
  readonly type: SourceType;
}

export interface ContentDiff {
  readonly changed: boolean;
  readonly oldHash: string;
  readonly newHash: string;
}

export interface FetchOptions {
  readonly userAgent?: string;
  readonly timeoutMs?: number;
}

// ---- Helpers ----

/** Compute SHA-256 hex digest of a string. */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Strip HTML tags and collapse whitespace to extract plain text. */
export function stripHtml(html: string): string {
  // Remove script and style blocks first
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const noStyle = noScript.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Remove all remaining tags
  const noTags = noStyle.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  const decoded = noTags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  return decoded.replace(/\s+/g, ' ').trim();
}

/** Extract RSS entry titles and descriptions from raw XML. */
export function parseRssEntries(xml: string): string {
  const items: string[] = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRegex) ?? [];
  for (const item of matches) {
    const titleMatch = item.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descMatch = item.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const desc = descMatch ? stripHtml(descMatch[1].trim()) : '';
    if (title !== '' || desc !== '') {
      items.push(`${title} ${desc}`.trim());
    }
  }
  return items.join('\n');
}

/** Normalise content based on source type for stable hashing. */
export function normaliseContent(raw: string, type: SourceType): string {
  switch (type) {
    case 'html':
      return stripHtml(raw);
    case 'rss':
      return parseRssEntries(raw);
    case 'api':
      // Normalise JSON: parse then re-stringify with sorted keys
      try {
        const parsed: unknown = JSON.parse(raw);
        return JSON.stringify(parsed, null, 0);
      } catch {
        return raw.trim();
      }
  }
}

// ---- Core functions ----

/**
 * Fetch a legal source page and return normalised content with a SHA-256 hash.
 * Respects robots.txt by checking it before fetching the target URL.
 */
export async function fetchSource(
  url: string,
  type: SourceType = 'html',
  options: FetchOptions = {},
): Promise<FetchedSource> {
  const userAgent = options.userAgent ?? `pally-monitor/${VERSION}`;
  const timeoutMs = options.timeoutMs ?? 15_000;

  // Check robots.txt
  const allowed = await isAllowedByRobots(url, userAgent, timeoutMs);
  if (!allowed) {
    throw new Error(`Robots.txt disallows crawling ${url} for ${userAgent}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let raw: string;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    raw = await response.text();
  } finally {
    clearTimeout(timer);
  }

  const content = normaliseContent(raw, type);
  const contentHash = sha256(content);

  return {
    url,
    content,
    contentHash,
    fetchedAt: new Date().toISOString(),
    type,
  };
}

/**
 * Check whether the given URL is allowed by the site's robots.txt.
 * Returns true if allowed or if robots.txt cannot be fetched.
 */
export async function isAllowedByRobots(
  url: string,
  userAgent: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  let robotsUrl: string;
  try {
    const parsed = new URL(url);
    robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
  } catch {
    return true; // Unparseable URL — allow and let the main fetch fail
  }

  let robotsTxt: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(robotsUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': userAgent },
      });
      if (!response.ok) return true; // No robots.txt → allowed
      robotsTxt = await response.text();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return true; // Network error → assume allowed
  }

  return parseRobotsTxt(robotsTxt, url, userAgent);
}

/**
 * Parse a robots.txt string and determine if the given URL path is allowed
 * for the given user agent.
 */
export function parseRobotsTxt(robotsTxt: string, url: string, userAgent: string): boolean {
  let parsedPath: string;
  try {
    parsedPath = new URL(url).pathname;
  } catch {
    return true;
  }

  const lines = robotsTxt.split(/\r?\n/);
  const agentLower = userAgent.toLowerCase();

  // We'll track applicable rules: [disallow, allow] pairs for matching agents
  const disallowedPaths: string[] = [];
  const allowedPaths: string[] = [];

  let inRelevantBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#') || line === '') {
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === 'user-agent') {
      inRelevantBlock =
        value === '*' || agentLower.includes(value.toLowerCase());
    } else if (inRelevantBlock) {
      if (directive === 'disallow') {
        if (value !== '') disallowedPaths.push(value);
      } else if (directive === 'allow') {
        if (value !== '') allowedPaths.push(value);
      }
    }
  }

  // Check allow rules first (more specific wins)
  for (const path of allowedPaths) {
    if (parsedPath.startsWith(path)) return true;
  }

  for (const path of disallowedPaths) {
    if (parsedPath.startsWith(path)) return false;
  }

  return true;
}

/**
 * Diff two content hashes to detect changes.
 */
export function diffContent(oldHash: string, newHash: string): ContentDiff {
  return {
    changed: oldHash !== newHash,
    oldHash,
    newHash,
  };
}
