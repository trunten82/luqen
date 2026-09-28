import { createRequire } from 'node:module';
import { guardedFetch } from '../net/guarded-fetch.js';
import type { NetworkGuardPolicy } from '../net/ssrf-guard.js';

const require = createRequire(import.meta.url);

interface RobotsTxtParser {
  isAllowed(url: string, ua?: string): boolean | undefined;
}

// robots-parser is a CommonJS module; use require to avoid ESM interop type issues
const robotsParser = require('robots-parser') as (url: string, robotstxt: string) => RobotsTxtParser;

export interface RobotsResult {
  readonly sitemapUrls: readonly string[];
  readonly isAllowed: (url: string) => boolean;
}

function createPermissiveResult(): RobotsResult {
  return { sitemapUrls: [], isAllowed: () => true };
}

/**
 * Fetches robots.txt through the SSRF guard (DISCOVERY-SSRF-1). A refused
 * target degrades exactly like a network error: permissive, no sitemaps.
 */
export async function fetchRobots(baseUrl: string, guard: NetworkGuardPolicy = {}): Promise<RobotsResult> {
  const robotsUrl = new URL('/robots.txt', baseUrl).href;
  try {
    const response = await guardedFetch(robotsUrl, {}, guard);
    if (!response.ok) return createPermissiveResult();
    const body = await response.text();
    const robots = robotsParser(robotsUrl, body);
    const sitemapUrls = body.split('\n')
      .filter((line) => line.toLowerCase().startsWith('sitemap:'))
      .map((line) => line.slice('sitemap:'.length).trim())
      .filter((url) => url.length > 0);
    return {
      sitemapUrls,
      isAllowed: (url: string) => robots.isAllowed(url, '*') ?? true,
    };
  } catch {
    return createPermissiveResult();
  }
}
