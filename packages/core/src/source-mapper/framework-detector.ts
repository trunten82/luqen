import type { FileReader } from './file-reader.js';

export type Framework =
  | 'nextjs-app'
  | 'nextjs-pages'
  | 'nuxt'
  | 'sveltekit'
  | 'angular'
  | 'plain-html'
  | 'unknown';

async function hasConfigFile(reader: FileReader, prefix: string): Promise<boolean> {
  try {
    const entries = await reader.list('');
    return entries.some((entry) => entry.startsWith(prefix + '.'));
  } catch {
    return false;
  }
}

async function getPackageDeps(reader: FileReader): Promise<Record<string, string>> {
  try {
    const raw = await reader.read('package.json');
    if (raw === null) return {};
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

export async function detectFramework(reader: FileReader): Promise<Framework> {
  const [deps, hasNextConfig, hasNuxtConfig, hasSvelteConfig, hasAngularJson, hasIndexHtml] =
    await Promise.all([
      getPackageDeps(reader),
      hasConfigFile(reader, 'next.config'),
      hasConfigFile(reader, 'nuxt.config'),
      hasConfigFile(reader, 'svelte.config'),
      reader.exists('angular.json'),
      reader.exists('index.html'),
    ]);

  const isNext = hasNextConfig || 'next' in deps;
  if (isNext) {
    const [hasAppPage, hasPagesDir] = await Promise.all([
      reader.exists('app/page.tsx'),
      reader.list('pages').then((entries) => entries.length > 0),
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
