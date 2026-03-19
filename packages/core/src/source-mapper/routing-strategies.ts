import { access, readdir } from 'fs/promises';
import { join } from 'path';
import type { Framework } from './framework-detector.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function firstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function findDynamicSegment(dirPath: string): Promise<string | null> {
  try {
    const entries = await readdir(dirPath);
    const dynamic = entries.find(
      (e) => e.startsWith('[') && !e.startsWith('[...') && e.endsWith(']'),
    );
    return dynamic ?? null;
  } catch {
    return null;
  }
}

async function findCatchAllSegment(dirPath: string): Promise<string | null> {
  try {
    const entries = await readdir(dirPath);
    const catchAll = entries.find((e) => e.startsWith('[...') && e.endsWith(']'));
    return catchAll ?? null;
  } catch {
    return null;
  }
}

const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const;

async function resolveNextjsApp(urlPath: string, repoPath: string): Promise<string | null> {
  const segment = urlPath === '/' ? '' : urlPath.replace(/^\//, '').replace(/\/$/, '');
  const appBase = join(repoPath, 'app');

  if (segment === '') {
    for (const ext of EXTENSIONS) {
      const candidate = join(appBase, `page${ext}`);
      if (await fileExists(candidate)) return candidate;
    }
    return null;
  }

  const parts = segment.split('/');
  const targetDir = join(appBase, ...parts);
  for (const ext of EXTENSIONS) {
    const candidate = join(targetDir, `page${ext}`);
    if (await fileExists(candidate)) return candidate;
  }

  // Try dynamic segment in parent dir
  const parentDir = parts.length > 1 ? join(appBase, ...parts.slice(0, -1)) : appBase;
  const dynamic = await findDynamicSegment(parentDir);
  if (dynamic) {
    for (const ext of EXTENSIONS) {
      const candidate = join(parentDir, dynamic, `page${ext}`);
      if (await fileExists(candidate)) return candidate;
    }
  }

  // Try catch-all
  const catchAll = await findCatchAllSegment(appBase);
  if (catchAll) {
    for (const ext of EXTENSIONS) {
      const candidate = join(appBase, catchAll, `page${ext}`);
      if (await fileExists(candidate)) return candidate;
    }
  }

  return null;
}

async function resolveNextjsPages(urlPath: string, repoPath: string): Promise<string | null> {
  const segment = urlPath === '/' ? 'index' : urlPath.replace(/^\//, '').replace(/\/$/, '');
  const pagesBase = join(repoPath, 'pages');

  for (const ext of EXTENSIONS) {
    const candidate = join(pagesBase, `${segment}${ext}`);
    if (await fileExists(candidate)) return candidate;
  }

  // Try dynamic segment
  const parts = segment.split('/');
  const parentDir = parts.length > 1 ? join(pagesBase, ...parts.slice(0, -1)) : pagesBase;
  const dynamic = await findDynamicSegment(parentDir);
  if (dynamic) {
    for (const ext of EXTENSIONS) {
      const candidate = join(parentDir, `${dynamic}${ext}`);
      if (await fileExists(candidate)) return candidate;
    }
  }

  return null;
}

async function resolveNuxt(urlPath: string, repoPath: string): Promise<string | null> {
  const segment = urlPath === '/' ? 'index' : urlPath.replace(/^\//, '').replace(/\/$/, '');
  const pagesBase = join(repoPath, 'pages');

  const candidate = join(pagesBase, `${segment}.vue`);
  if (await fileExists(candidate)) return candidate;

  // Dynamic segment
  const parts = segment.split('/');
  const parentDir = parts.length > 1 ? join(pagesBase, ...parts.slice(0, -1)) : pagesBase;
  const dynamic = await findDynamicSegment(parentDir);
  if (dynamic) {
    const dynCandidate = join(parentDir, `${dynamic}.vue`);
    if (await fileExists(dynCandidate)) return dynCandidate;
  }

  return null;
}

async function resolveSvelteKit(urlPath: string, repoPath: string): Promise<string | null> {
  const segment = urlPath === '/' ? '' : urlPath.replace(/^\//, '').replace(/\/$/, '');
  const routesBase = join(repoPath, 'src', 'routes');

  if (segment === '') {
    const candidate = join(routesBase, '+page.svelte');
    if (await fileExists(candidate)) return candidate;
    return null;
  }

  const parts = segment.split('/');
  const targetDir = join(routesBase, ...parts);
  const candidate = join(targetDir, '+page.svelte');
  if (await fileExists(candidate)) return candidate;

  // Dynamic segment
  const parentDir = parts.length > 1 ? join(routesBase, ...parts.slice(0, -1)) : routesBase;
  const dynamic = await findDynamicSegment(parentDir);
  if (dynamic) {
    const dynCandidate = join(parentDir, dynamic, '+page.svelte');
    if (await fileExists(dynCandidate)) return dynCandidate;
  }

  return null;
}

async function resolvePlainHtml(urlPath: string, repoPath: string): Promise<string | null> {
  const segment = urlPath === '/' ? 'index' : urlPath.replace(/^\//, '').replace(/\/$/, '');

  const candidates = [
    join(repoPath, `${segment}.html`),
    join(repoPath, segment, 'index.html'),
  ];

  return firstExisting(candidates);
}

export async function resolveUrlToFile(
  urlPath: string,
  framework: Framework,
  repoPath: string,
): Promise<string | null> {
  switch (framework) {
    case 'nextjs-app':
      return resolveNextjsApp(urlPath, repoPath);
    case 'nextjs-pages':
      return resolveNextjsPages(urlPath, repoPath);
    case 'nuxt':
      return resolveNuxt(urlPath, repoPath);
    case 'sveltekit':
      return resolveSvelteKit(urlPath, repoPath);
    case 'plain-html':
      return resolvePlainHtml(urlPath, repoPath);
    default:
      return null;
  }
}
