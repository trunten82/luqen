import { join } from 'path';
import type { Framework } from './framework-detector.js';
import type { FileReader } from './file-reader.js';

async function firstExisting(reader: FileReader, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await reader.exists(candidate)) return candidate;
  }
  return null;
}

async function findDynamicSegment(reader: FileReader, dirPath: string): Promise<string | null> {
  try {
    const entries = await reader.list(dirPath);
    const dynamic = entries.find(
      (e) => e.startsWith('[') && !e.startsWith('[...') && e.endsWith(']'),
    );
    return dynamic ?? null;
  } catch {
    return null;
  }
}

async function findCatchAllSegment(reader: FileReader, dirPath: string): Promise<string | null> {
  try {
    const entries = await reader.list(dirPath);
    const catchAll = entries.find((e) => e.startsWith('[...') && e.endsWith(']'));
    return catchAll ?? null;
  } catch {
    return null;
  }
}

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const;

async function resolveNextjsApp(urlPath: string, reader: FileReader): Promise<string | null> {
  const segment = urlPath === '/' ? '' : urlPath.replace(/^\//, '').replace(/\/$/, '');
  const appBase = 'app';

  if (segment === '') {
    for (const ext of EXTENSIONS) {
      const candidate = join(appBase, `page${ext}`);
      if (await reader.exists(candidate)) return candidate;
    }
    return null;
  }

  const parts = segment.split('/');
  const targetDir = join(appBase, ...parts);
  for (const ext of EXTENSIONS) {
    const candidate = join(targetDir, `page${ext}`);
    if (await reader.exists(candidate)) return candidate;
  }

  // Try dynamic segment in parent dir
  const parentDir = parts.length > 1 ? join(appBase, ...parts.slice(0, -1)) : appBase;
  const dynamic = await findDynamicSegment(reader, parentDir);
  if (dynamic) {
    for (const ext of EXTENSIONS) {
      const candidate = join(parentDir, dynamic, `page${ext}`);
      if (await reader.exists(candidate)) return candidate;
    }
  }

  // Try catch-all
  const catchAll = await findCatchAllSegment(reader, appBase);
  if (catchAll) {
    for (const ext of EXTENSIONS) {
      const candidate = join(appBase, catchAll, `page${ext}`);
      if (await reader.exists(candidate)) return candidate;
    }
  }

  return null;
}

async function resolveNextjsPages(urlPath: string, reader: FileReader): Promise<string | null> {
  const segment = urlPath === '/' ? 'index' : urlPath.replace(/^\//, '').replace(/\/$/, '');
  const pagesBase = 'pages';

  for (const ext of EXTENSIONS) {
    const candidate = join(pagesBase, `${segment}${ext}`);
    if (await reader.exists(candidate)) return candidate;
  }

  // Try dynamic segment
  const parts = segment.split('/');
  const parentDir = parts.length > 1 ? join(pagesBase, ...parts.slice(0, -1)) : pagesBase;
  const dynamic = await findDynamicSegment(reader, parentDir);
  if (dynamic) {
    for (const ext of EXTENSIONS) {
      const candidate = join(parentDir, `${dynamic}${ext}`);
      if (await reader.exists(candidate)) return candidate;
    }
  }

  return null;
}

async function resolveNuxt(urlPath: string, reader: FileReader): Promise<string | null> {
  const segment = urlPath === '/' ? 'index' : urlPath.replace(/^\//, '').replace(/\/$/, '');
  const pagesBase = 'pages';

  const candidate = join(pagesBase, `${segment}.vue`);
  if (await reader.exists(candidate)) return candidate;

  // Dynamic segment
  const parts = segment.split('/');
  const parentDir = parts.length > 1 ? join(pagesBase, ...parts.slice(0, -1)) : pagesBase;
  const dynamic = await findDynamicSegment(reader, parentDir);
  if (dynamic) {
    const dynCandidate = join(parentDir, `${dynamic}.vue`);
    if (await reader.exists(dynCandidate)) return dynCandidate;
  }

  return null;
}

async function resolveSvelteKit(urlPath: string, reader: FileReader): Promise<string | null> {
  const segment = urlPath === '/' ? '' : urlPath.replace(/^\//, '').replace(/\/$/, '');
  const routesBase = join('src', 'routes');

  if (segment === '') {
    const candidate = join(routesBase, '+page.svelte');
    if (await reader.exists(candidate)) return candidate;
    return null;
  }

  const parts = segment.split('/');
  const targetDir = join(routesBase, ...parts);
  const candidate = join(targetDir, '+page.svelte');
  if (await reader.exists(candidate)) return candidate;

  // Dynamic segment
  const parentDir = parts.length > 1 ? join(routesBase, ...parts.slice(0, -1)) : routesBase;
  const dynamic = await findDynamicSegment(reader, parentDir);
  if (dynamic) {
    const dynCandidate = join(parentDir, dynamic, '+page.svelte');
    if (await reader.exists(dynCandidate)) return dynCandidate;
  }

  return null;
}

async function resolvePlainHtml(urlPath: string, reader: FileReader): Promise<string | null> {
  const segment = urlPath === '/' ? 'index' : urlPath.replace(/^\//, '').replace(/\/$/, '');

  const candidates = [
    `${segment}.html`,
    join(segment, 'index.html'),
  ];

  return firstExisting(reader, candidates);
}

/**
 * Resolve a URL path to a relative file path (relative to repo root)
 * using the appropriate framework routing strategy.
 * Returns a relative path or null if no matching file is found.
 */
export async function resolveUrlToFile(
  urlPath: string,
  framework: Framework,
  reader: FileReader,
): Promise<string | null> {
  switch (framework) {
    case 'nextjs-app':
      return resolveNextjsApp(urlPath, reader);
    case 'nextjs-pages':
      return resolveNextjsPages(urlPath, reader);
    case 'nuxt':
      return resolveNuxt(urlPath, reader);
    case 'sveltekit':
      return resolveSvelteKit(urlPath, reader);
    case 'plain-html':
      return resolvePlainHtml(urlPath, reader);
    default:
      // Fallback: try plain HTML resolution even for unknown frameworks
      return resolvePlainHtml(urlPath, reader);
  }
}
