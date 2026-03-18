import { readdir, readFile, access } from 'fs/promises';
import { join } from 'path';

export type Framework =
  | 'nextjs-app'
  | 'nextjs-pages'
  | 'nuxt'
  | 'sveltekit'
  | 'angular'
  | 'plain-html'
  | 'unknown';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await readdir(dirPath);
    return Array.isArray(stat);
  } catch {
    return false;
  }
}

async function hasConfigFile(repoPath: string, prefix: string): Promise<boolean> {
  try {
    const entries = await readdir(repoPath);
    return entries.some((entry) => entry.startsWith(prefix + '.'));
  } catch {
    return false;
  }
}

async function getPackageDeps(repoPath: string): Promise<Record<string, string>> {
  const pkgPath = join(repoPath, 'package.json');
  try {
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
  } catch {
    return {};
  }
}

export async function detectFramework(repoPath: string): Promise<Framework> {
  const [deps, hasNextConfig, hasNuxtConfig, hasSvelteConfig, hasAngularJson, hasIndexHtml] =
    await Promise.all([
      getPackageDeps(repoPath),
      hasConfigFile(repoPath, 'next.config'),
      hasConfigFile(repoPath, 'nuxt.config'),
      hasConfigFile(repoPath, 'svelte.config'),
      fileExists(join(repoPath, 'angular.json')),
      fileExists(join(repoPath, 'index.html')),
    ]);

  const isNext = hasNextConfig || 'next' in deps;
  if (isNext) {
    const [hasAppPage, hasPagesDir] = await Promise.all([
      fileExists(join(repoPath, 'app', 'page.tsx')),
      dirExists(join(repoPath, 'pages')),
    ]);
    if (hasAppPage) return 'nextjs-app';
    if (hasPagesDir) return 'nextjs-pages';
    return 'nextjs-app';
  }

  if (hasNuxtConfig || 'nuxt' in deps) return 'nuxt';
  if (hasSvelteConfig || '@sveltejs/kit' in deps) return 'sveltekit';
  if (hasAngularJson || '@angular/core' in deps) return 'angular';
  if (hasIndexHtml) return 'plain-html';

  return 'unknown';
}
