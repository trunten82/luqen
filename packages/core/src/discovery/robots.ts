import { createRequire } from 'node:module';

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

export async function fetchRobots(baseUrl: string): Promise<RobotsResult> {
  const robotsUrl = new URL('/robots.txt', baseUrl).href;
  try {
    const response = await fetch(robotsUrl);
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
