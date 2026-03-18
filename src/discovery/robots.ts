import robotsParser from 'robots-parser';

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
