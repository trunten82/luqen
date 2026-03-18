import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PageResult, SourceMapping } from '../types.js';
import { detectFramework } from './framework-detector.js';
import { resolveUrlToFile } from './routing-strategies.js';
import { matchSelectorToSource } from './element-matcher.js';

function extractUrlPath(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

function matchOverride(urlPath: string, sourceMap: Readonly<Record<string, string>>): string | null {
  if (sourceMap[urlPath]) return sourceMap[urlPath];
  for (const [pattern, file] of Object.entries(sourceMap)) {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1);
      if (urlPath.startsWith(prefix)) return file;
    }
  }
  return null;
}

export async function mapIssuesToSource(
  pages: readonly PageResult[], repoPath: string, sourceMapOverrides: Readonly<Record<string, string>>
): Promise<PageResult[]> {
  const framework = await detectFramework(repoPath);
  return Promise.all(pages.map(async (page): Promise<PageResult> => {
    const urlPath = extractUrlPath(page.url);
    const overrideFile = matchOverride(urlPath, sourceMapOverrides);
    let filePath: string | null = null;
    if (overrideFile) {
      const fullPath = join(repoPath, overrideFile);
      filePath = existsSync(fullPath) ? fullPath : null;
    } else {
      filePath = await resolveUrlToFile(urlPath, framework, repoPath);
    }
    if (!filePath) return page;

    let sourceMapping: SourceMapping = { file: filePath, confidence: 'none' };
    if (page.issues.length > 0) {
      try {
        const source = await readFile(filePath, 'utf-8');
        const match = matchSelectorToSource(page.issues[0].selector, source);
        sourceMapping = { file: filePath, line: match.line, confidence: match.confidence };
      } catch { /* use default */ }
    } else {
      sourceMapping = { file: filePath, confidence: 'high' };
    }
    return { ...page, sourceMap: sourceMapping };
  }));
}
