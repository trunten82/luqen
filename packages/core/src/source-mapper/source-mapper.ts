import type { PageResult, SourceMapping } from '../types.js';
import type { FileReader } from './file-reader.js';
import { LocalFileReader } from './file-reader.js';
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
  pages: readonly PageResult[],
  repoPath: string,
  sourceMapOverrides: Readonly<Record<string, string>>,
  reader?: FileReader,
): Promise<PageResult[]> {
  const effectiveReader = reader ?? new LocalFileReader(repoPath);
  const framework = await detectFramework(effectiveReader);
  return Promise.all(pages.map(async (page): Promise<PageResult> => {
    const urlPath = extractUrlPath(page.url);
    const overrideFile = matchOverride(urlPath, sourceMapOverrides);
    let relativePath: string | null = null;
    if (overrideFile) {
      const exists = await effectiveReader.exists(overrideFile);
      relativePath = exists ? overrideFile : null;
    } else {
      relativePath = await resolveUrlToFile(urlPath, framework, effectiveReader);
    }
    if (!relativePath) return page;

    let sourceMapping: SourceMapping = { file: relativePath, confidence: 'none' };
    if (page.issues.length > 0) {
      try {
        const source = await effectiveReader.read(relativePath);
        if (source !== null) {
          const match = matchSelectorToSource(page.issues[0].selector, source);
          sourceMapping = { file: relativePath, line: match.line, confidence: match.confidence };
        }
      } catch { /* use default */ }
    } else {
      sourceMapping = { file: relativePath, confidence: 'high' };
    }
    return { ...page, sourceMap: sourceMapping };
  }));
}
