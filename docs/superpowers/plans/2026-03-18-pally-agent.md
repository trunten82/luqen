# Pally Agent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI + MCP tool that scans entire websites for accessibility issues using a pa11y webservice, maps issues to source files, and proposes code fixes.

**Architecture:** Core library with focused modules (config, discovery, scanner, reporter, source-mapper, fixer) wrapped by a CLI (`commander`) and MCP server (`@modelcontextprotocol/sdk`). All pa11y interaction goes through the webservice REST API.

**Tech Stack:** TypeScript (strict), Node.js, commander, @modelcontextprotocol/sdk, xml2js, robots-parser, cheerio, handlebars, vitest

**Spec:** `docs/superpowers/specs/2026-03-18-pally-agent-design.md`

---

## File Structure

```
pally-agent/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── types.ts                        # All shared interfaces (ScanProgress, ScanError, PageResult, etc.)
│   ├── config.ts                       # Config loading, env var overrides, defaults, validation
│   ├── discovery/
│   │   ├── robots.ts                   # Robots.txt fetching + parsing
│   │   ├── sitemap.ts                  # Sitemap + sitemap index parsing
│   │   ├── crawler.ts                  # BFS link crawler fallback
│   │   └── discover.ts                 # Orchestrator: robots → sitemap → crawl fallback
│   ├── scanner/
│   │   ├── webservice-client.ts        # Low-level pa11y webservice HTTP client
│   │   └── scanner.ts                  # Concurrency, polling, progress events, error handling
│   ├── reporter/
│   │   ├── json-reporter.ts            # JSON report generation + file output
│   │   ├── html-reporter.ts            # HTML report generation (handlebars template)
│   │   └── report.hbs                  # Handlebars template for HTML report
│   ├── source-mapper/
│   │   ├── framework-detector.ts       # Detect framework from repo files
│   │   ├── routing-strategies.ts       # URL-to-file mapping per framework
│   │   ├── element-matcher.ts          # CSS selector → source line matching
│   │   └── source-mapper.ts            # Orchestrator: detect + map + match
│   ├── fixer/
│   │   ├── fix-rules.ts               # Fix patterns for common a11y issues
│   │   ├── fix-proposer.ts            # Generate fix proposals from scan results
│   │   └── fix-applier.ts             # Apply fixes to source files, generate diffs
│   ├── cli.ts                          # CLI entry point (commander setup)
│   └── mcp.ts                          # MCP server entry point
├── tests/
│   ├── config.test.ts
│   ├── discovery/
│   │   ├── robots.test.ts
│   │   ├── sitemap.test.ts
│   │   ├── crawler.test.ts
│   │   └── discover.test.ts
│   ├── scanner/
│   │   ├── webservice-client.test.ts
│   │   └── scanner.test.ts
│   ├── reporter/
│   │   ├── json-reporter.test.ts
│   │   └── html-reporter.test.ts
│   ├── source-mapper/
│   │   ├── framework-detector.test.ts
│   │   ├── routing-strategies.test.ts
│   │   ├── element-matcher.test.ts
│   │   └── source-mapper.test.ts
│   ├── fixer/
│   │   ├── fix-rules.test.ts
│   │   ├── fix-proposer.test.ts
│   │   └── fix-applier.test.ts
│   ├── cli.test.ts
│   └── mcp.test.ts
└── docs/
    └── superpowers/
        ├── specs/
        │   └── 2026-03-18-pally-agent-design.md
        └── plans/
            └── 2026-03-18-pally-agent.md
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Initialize package.json**

```bash
cd /root/pally-agent
npm init -y
```

Then edit `package.json`:

```json
{
  "name": "pally-agent",
  "version": "0.1.0",
  "description": "Accessibility testing agent using pa11y webservice",
  "type": "module",
  "main": "dist/cli.js",
  "bin": {
    "pally-agent": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc && cp src/reporter/report.hbs dist/reporter/report.hbs",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "tsc --noEmit"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install commander @modelcontextprotocol/sdk xml2js robots-parser cheerio handlebars zod
npm install -D typescript vitest @vitest/coverage-v8 @types/node @types/xml2js
```

- [ ] **Step 3: Create tsconfig.json**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: '.',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
```

- [ ] **Step 5: Create src/types.ts with all shared interfaces**

```typescript
export interface PallyConfig {
  readonly webserviceUrl: string;
  readonly webserviceHeaders: Readonly<Record<string, string>>;
  readonly standard: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
  readonly concurrency: number;
  readonly timeout: number;
  readonly pollTimeout: number;
  readonly maxPages: number;
  readonly crawlDepth: number;
  readonly alsoCrawl: boolean;
  readonly ignore: readonly string[];
  readonly hideElements: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly wait: number;
  readonly outputDir: string;
  readonly sourceMap: Readonly<Record<string, string>>;
}

export interface DiscoveredUrl {
  readonly url: string;
  readonly discoveryMethod: 'sitemap' | 'crawl';
}

export interface ScanProgress {
  readonly type: 'scan:start' | 'scan:complete' | 'scan:error' | 'scan:progress';
  readonly url: string;
  readonly current: number;
  readonly total: number;
  readonly timestamp: string;
  readonly error?: string;
}

export interface ScanError {
  readonly url: string;
  readonly code: 'TIMEOUT' | 'WEBSERVICE_ERROR' | 'HTTP_ERROR' | 'UNKNOWN';
  readonly message: string;
  readonly retried: boolean;
}

export interface AccessibilityIssue {
  readonly code: string;
  readonly type: 'error' | 'warning' | 'notice';
  readonly message: string;
  readonly selector: string;
  readonly context: string;
  readonly fixSuggestion?: string;
}

export interface SourceMapping {
  readonly file: string;
  readonly line?: number;
  readonly component?: string;
  readonly confidence: 'high' | 'low' | 'none';
}

export interface PageResult {
  readonly url: string;
  readonly discoveryMethod: 'sitemap' | 'crawl';
  readonly issueCount: number;
  readonly issues: readonly AccessibilityIssue[];
  readonly sourceMap?: SourceMapping;
  readonly error?: ScanError;
}

export interface ScanSummary {
  readonly url: string;
  readonly pagesScanned: number;
  readonly pagesFailed: number;
  readonly totalIssues: number;
  readonly byLevel: {
    readonly error: number;
    readonly warning: number;
    readonly notice: number;
  };
}

export interface ScanReport {
  readonly summary: ScanSummary;
  readonly pages: readonly PageResult[];
  readonly errors: readonly ScanError[];
  readonly reportPath: string;
}

export interface FixProposal {
  readonly file: string;
  readonly line: number;
  readonly issue: string;
  readonly description: string;
  readonly oldText: string;
  readonly newText: string;
  readonly confidence: 'high' | 'low';
}

export interface FixResult {
  readonly applied: boolean;
  readonly file: string;
  readonly diff: string;
}

export type ProgressListener = (progress: ScanProgress) => void;
```

- [ ] **Step 6: Verify build compiles**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/types.ts
git commit -m "feat: scaffold project with types, tsconfig, and vitest"
```

---

## Task 2: Configuration Module

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests for config**

Create `tests/config.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, DEFAULT_CONFIG } from '../src/config.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `pally-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.PALLY_WEBSERVICE_URL;
    delete process.env.PALLY_WEBSERVICE_AUTH;
    delete process.env.PALLY_AGENT_CONFIG;
  });

  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig({ cwd: tempDir });
    expect(config.standard).toBe('WCAG2AA');
    expect(config.concurrency).toBe(5);
    expect(config.timeout).toBe(30000);
    expect(config.pollTimeout).toBe(60000);
    expect(config.maxPages).toBe(100);
    expect(config.crawlDepth).toBe(3);
    expect(config.alsoCrawl).toBe(false);
  });

  it('loads config from .pally-agent.json in cwd', async () => {
    writeFileSync(
      join(tempDir, '.pally-agent.json'),
      JSON.stringify({ standard: 'WCAG2AAA', concurrency: 3 })
    );
    const config = await loadConfig({ cwd: tempDir });
    expect(config.standard).toBe('WCAG2AAA');
    expect(config.concurrency).toBe(3);
    expect(config.timeout).toBe(30000); // default preserved
  });

  it('walks up directories to find config', async () => {
    const child = join(tempDir, 'sub', 'dir');
    mkdirSync(child, { recursive: true });
    writeFileSync(
      join(tempDir, '.pally-agent.json'),
      JSON.stringify({ concurrency: 10 })
    );
    const config = await loadConfig({ cwd: child });
    expect(config.concurrency).toBe(10);
  });

  it('uses --config override over discovery', async () => {
    const configPath = join(tempDir, 'custom.json');
    writeFileSync(configPath, JSON.stringify({ concurrency: 42 }));
    writeFileSync(
      join(tempDir, '.pally-agent.json'),
      JSON.stringify({ concurrency: 1 })
    );
    const config = await loadConfig({ cwd: tempDir, configPath });
    expect(config.concurrency).toBe(42);
  });

  it('overrides webserviceUrl from PALLY_WEBSERVICE_URL env', async () => {
    process.env.PALLY_WEBSERVICE_URL = 'http://custom:9000';
    const config = await loadConfig({ cwd: tempDir });
    expect(config.webserviceUrl).toBe('http://custom:9000');
  });

  it('overrides webserviceHeaders.Authorization from PALLY_WEBSERVICE_AUTH', async () => {
    process.env.PALLY_WEBSERVICE_AUTH = 'Bearer secret';
    const config = await loadConfig({ cwd: tempDir });
    expect(config.webserviceHeaders.Authorization).toBe('Bearer secret');
  });

  it('uses PALLY_AGENT_CONFIG env as config path', async () => {
    const configPath = join(tempDir, 'env-config.json');
    writeFileSync(configPath, JSON.stringify({ concurrency: 99 }));
    process.env.PALLY_AGENT_CONFIG = configPath;
    const config = await loadConfig({ cwd: tempDir });
    expect(config.concurrency).toBe(99);
  });

  it('validates standard is a valid WCAG level', async () => {
    writeFileSync(
      join(tempDir, '.pally-agent.json'),
      JSON.stringify({ standard: 'INVALID' })
    );
    await expect(loadConfig({ cwd: tempDir })).rejects.toThrow(/standard/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/config.test.ts
```

Expected: FAIL — `loadConfig` not found

- [ ] **Step 3: Implement src/config.ts**

```typescript
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, parse } from 'node:path';
import type { PallyConfig } from './types.js';

const CONFIG_FILENAME = '.pally-agent.json';

const VALID_STANDARDS = new Set(['WCAG2A', 'WCAG2AA', 'WCAG2AAA']);

export const DEFAULT_CONFIG: PallyConfig = {
  webserviceUrl: 'http://localhost:3000',
  webserviceHeaders: {},
  standard: 'WCAG2AA',
  concurrency: 5,
  timeout: 30000,
  pollTimeout: 60000,
  maxPages: 100,
  crawlDepth: 3,
  alsoCrawl: false,
  ignore: [],
  hideElements: '',
  headers: {},
  wait: 0,
  outputDir: './pally-reports',
  sourceMap: {},
};

interface LoadConfigOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly repoPath?: string;
}

function findConfigFile(startDir: string): string | undefined {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

function validate(config: PallyConfig): void {
  if (!VALID_STANDARDS.has(config.standard)) {
    throw new Error(
      `Invalid standard "${config.standard}". Must be one of: ${[...VALID_STANDARDS].join(', ')}`
    );
  }
  if (config.concurrency < 1) {
    throw new Error('concurrency must be >= 1');
  }
  if (config.timeout < 1) {
    throw new Error('timeout must be >= 1');
  }
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<PallyConfig> {
  const cwd = options.cwd ?? process.cwd();

  // Determine config file path: explicit > env > discovery
  const configPath =
    options.configPath ??
    process.env.PALLY_AGENT_CONFIG ??
    findConfigFile(cwd) ??
    (options.repoPath ? findConfigFile(options.repoPath) : undefined);

  // Load file config if found
  let fileConfig: Record<string, unknown> = {};
  if (configPath && existsSync(configPath)) {
    fileConfig = await readJsonFile(configPath);
  }

  // Merge: defaults < file < env overrides
  const merged: PallyConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    webserviceHeaders: {
      ...DEFAULT_CONFIG.webserviceHeaders,
      ...(fileConfig.webserviceHeaders as Record<string, string> | undefined),
    },
  } as PallyConfig;

  // Apply env var overrides
  const envUrl = process.env.PALLY_WEBSERVICE_URL;
  const envAuth = process.env.PALLY_WEBSERVICE_AUTH;

  const withEnv: PallyConfig = {
    ...merged,
    ...(envUrl ? { webserviceUrl: envUrl } : {}),
    ...(envAuth
      ? {
          webserviceHeaders: {
            ...merged.webserviceHeaders,
            Authorization: envAuth,
          },
        }
      : {}),
  };

  validate(withEnv);
  return withEnv;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/config.test.ts
```

Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config module with file discovery and env overrides"
```

---

## Task 3: Robots.txt Parser

**Files:**
- Create: `src/discovery/robots.ts`
- Create: `tests/discovery/robots.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/discovery/robots.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchRobots, type RobotsResult } from '../../src/discovery/robots.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('fetchRobots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses disallow rules and sitemap directives', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => [
        'User-agent: *',
        'Disallow: /admin',
        'Disallow: /private/',
        'Sitemap: https://example.com/sitemap.xml',
      ].join('\n'),
    });

    const result = await fetchRobots('https://example.com');
    expect(result.sitemapUrls).toEqual(['https://example.com/sitemap.xml']);
    expect(result.isAllowed('https://example.com/about')).toBe(true);
    expect(result.isAllowed('https://example.com/admin')).toBe(false);
    expect(result.isAllowed('https://example.com/private/stuff')).toBe(false);
  });

  it('returns permissive result when robots.txt is 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await fetchRobots('https://example.com');
    expect(result.sitemapUrls).toEqual([]);
    expect(result.isAllowed('https://example.com/admin')).toBe(true);
  });

  it('returns permissive result on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchRobots('https://example.com');
    expect(result.sitemapUrls).toEqual([]);
    expect(result.isAllowed('https://example.com/anything')).toBe(true);
  });

  it('extracts multiple sitemap directives', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => [
        'User-agent: *',
        'Disallow:',
        'Sitemap: https://example.com/sitemap1.xml',
        'Sitemap: https://example.com/sitemap2.xml',
      ].join('\n'),
    });

    const result = await fetchRobots('https://example.com');
    expect(result.sitemapUrls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/discovery/robots.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/discovery/robots.ts**

```typescript
import robotsParser from 'robots-parser';

export interface RobotsResult {
  readonly sitemapUrls: readonly string[];
  readonly isAllowed: (url: string) => boolean;
}

function createPermissiveResult(): RobotsResult {
  return {
    sitemapUrls: [],
    isAllowed: () => true,
  };
}

export async function fetchRobots(baseUrl: string): Promise<RobotsResult> {
  const robotsUrl = new URL('/robots.txt', baseUrl).href;

  try {
    const response = await fetch(robotsUrl);
    if (!response.ok) {
      return createPermissiveResult();
    }

    const body = await response.text();
    const robots = robotsParser(robotsUrl, body);

    // Extract sitemap URLs manually (robots-parser may not expose them reliably)
    const sitemapUrls = body
      .split('\n')
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/discovery/robots.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/discovery/robots.ts tests/discovery/robots.test.ts
git commit -m "feat: add robots.txt parser with disallow rules and sitemap extraction"
```

---

## Task 4: Sitemap Parser

**Files:**
- Create: `src/discovery/sitemap.ts`
- Create: `tests/discovery/sitemap.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/discovery/sitemap.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSitemap } from '../../src/discovery/sitemap.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('parseSitemap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts URLs from a simple urlset sitemap', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/</loc></url>
          <url><loc>https://example.com/about</loc></url>
          <url><loc>https://example.com/contact</loc></url>
        </urlset>`,
    });

    const urls = await parseSitemap('https://example.com/sitemap.xml');
    expect(urls).toEqual([
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/contact',
    ]);
  });

  it('follows sitemapindex entries recursively', async () => {
    // First call returns sitemap index
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
          <sitemap><loc>https://example.com/sitemap-blog.xml</loc></sitemap>
        </sitemapindex>`,
    });
    // Second call: pages sitemap
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/</loc></url>
        </urlset>`,
    });
    // Third call: blog sitemap
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/blog/post-1</loc></url>
        </urlset>`,
    });

    const urls = await parseSitemap('https://example.com/sitemap.xml');
    expect(urls).toEqual([
      'https://example.com/',
      'https://example.com/blog/post-1',
    ]);
  });

  it('returns empty array on 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const urls = await parseSitemap('https://example.com/sitemap.xml');
    expect(urls).toEqual([]);
  });

  it('returns empty array on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const urls = await parseSitemap('https://example.com/sitemap.xml');
    expect(urls).toEqual([]);
  });

  it('deduplicates URLs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/</loc></url>
          <url><loc>https://example.com/</loc></url>
        </urlset>`,
    });
    const urls = await parseSitemap('https://example.com/sitemap.xml');
    expect(urls).toEqual(['https://example.com/']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/discovery/sitemap.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/discovery/sitemap.ts**

```typescript
import { parseStringPromise } from 'xml2js';

interface SitemapUrlset {
  urlset?: { url?: Array<{ loc?: string[] }> };
}

interface SitemapIndex {
  sitemapindex?: { sitemap?: Array<{ loc?: string[] }> };
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  const urls = new Set<string>();

  async function processSitemap(url: string): Promise<void> {
    const xml = await fetchXml(url);
    if (!xml) return;

    const parsed = (await parseStringPromise(xml)) as SitemapUrlset & SitemapIndex;

    // Check if it's a sitemap index
    if (parsed.sitemapindex?.sitemap) {
      const childUrls = parsed.sitemapindex.sitemap
        .map((entry) => entry.loc?.[0])
        .filter((loc): loc is string => typeof loc === 'string');

      await Promise.all(childUrls.map(processSitemap));
      return;
    }

    // Otherwise treat as urlset
    if (parsed.urlset?.url) {
      for (const entry of parsed.urlset.url) {
        const loc = entry.loc?.[0];
        if (typeof loc === 'string') {
          urls.add(loc);
        }
      }
    }
  }

  await processSitemap(sitemapUrl);
  return [...urls];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/discovery/sitemap.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/discovery/sitemap.ts tests/discovery/sitemap.test.ts
git commit -m "feat: add sitemap parser with index recursion and deduplication"
```

---

## Task 5: Link Crawler

**Files:**
- Create: `src/discovery/crawler.ts`
- Create: `tests/discovery/crawler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/discovery/crawler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crawlSite } from '../../src/discovery/crawler.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function htmlPage(links: string[]): string {
  const anchors = links.map((href) => `<a href="${href}">link</a>`).join('');
  return `<html><body>${anchors}</body></html>`;
}

describe('crawlSite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovers pages by following links', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => htmlPage(['/about', '/contact']),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => htmlPage([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => htmlPage([]),
      });

    const urls = await crawlSite('https://example.com', {
      maxPages: 100,
      maxDepth: 3,
      isAllowed: () => true,
    });

    expect(urls).toContain('https://example.com/');
    expect(urls).toContain('https://example.com/about');
    expect(urls).toContain('https://example.com/contact');
  });

  it('respects maxDepth', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => htmlPage(['/level2']),
    });

    const urls = await crawlSite('https://example.com', {
      maxPages: 100,
      maxDepth: 1,
      isAllowed: () => true,
    });

    // depth 0 = root, depth 1 = /level2, no further
    expect(urls.length).toBeLessThanOrEqual(2);
  });

  it('respects maxPages', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => htmlPage(['/a', '/b', '/c', '/d', '/e']),
    });

    const urls = await crawlSite('https://example.com', {
      maxPages: 3,
      maxDepth: 10,
      isAllowed: () => true,
    });

    expect(urls.length).toBeLessThanOrEqual(3);
  });

  it('skips disallowed URLs via isAllowed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => htmlPage(['/public', '/admin']),
    }).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => htmlPage([]),
    });

    const urls = await crawlSite('https://example.com', {
      maxPages: 100,
      maxDepth: 3,
      isAllowed: (url) => !url.includes('/admin'),
    });

    expect(urls).toContain('https://example.com/public');
    expect(urls).not.toContain('https://example.com/admin');
  });

  it('skips external links', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => htmlPage(['https://other.com/page', '/local']),
    }).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => htmlPage([]),
    });

    const urls = await crawlSite('https://example.com', {
      maxPages: 100,
      maxDepth: 3,
      isAllowed: () => true,
    });

    expect(urls).not.toContain('https://other.com/page');
    expect(urls).toContain('https://example.com/local');
  });

  it('skips fragments and non-HTML resources', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => htmlPage(['/page#section', '/image.png', '/doc.pdf', '/valid']),
    }).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => htmlPage([]),
    });

    const urls = await crawlSite('https://example.com', {
      maxPages: 100,
      maxDepth: 3,
      isAllowed: () => true,
    });

    expect(urls).not.toContain('https://example.com/image.png');
    expect(urls).not.toContain('https://example.com/doc.pdf');
    expect(urls).toContain('https://example.com/valid');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/discovery/crawler.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/discovery/crawler.ts**

```typescript
import * as cheerio from 'cheerio';

const NON_HTML_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.pdf', '.zip', '.tar', '.gz',
  '.css', '.js', '.json', '.xml',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv',
  '.woff', '.woff2', '.ttf', '.eot',
]);

interface CrawlOptions {
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly isAllowed: (url: string) => boolean;
}

function isHtmlUrl(url: string): boolean {
  const pathname = new URL(url).pathname;
  const ext = pathname.slice(pathname.lastIndexOf('.'));
  return !NON_HTML_EXTENSIONS.has(ext.toLowerCase());
}

function normalizeUrl(href: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(href, baseUrl);
    // Strip fragment
    parsed.hash = '';
    // Strip trailing slash for consistency (but keep root)
    const normalized = parsed.href;
    return normalized;
  } catch {
    return null;
  }
}

export async function crawlSite(
  startUrl: string,
  options: CrawlOptions,
): Promise<string[]> {
  const { maxPages, maxDepth, isAllowed } = options;
  const baseOrigin = new URL(startUrl).origin;
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [];

  const startNormalized = normalizeUrl(startUrl, startUrl);
  if (!startNormalized) return [];

  queue.push({ url: startNormalized, depth: 0 });
  visited.add(startNormalized);

  while (queue.length > 0 && visited.size <= maxPages) {
    const item = queue.shift();
    if (!item) break;

    const { url, depth } = item;

    if (depth > maxDepth) continue;

    try {
      const response = await fetch(url);
      if (!response.ok) continue;

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html')) continue;

      const html = await response.text();
      const $ = cheerio.load(html);

      if (depth < maxDepth) {
        $('a[href]').each((_, el) => {
          if (visited.size >= maxPages) return false;

          const href = $(el).attr('href');
          if (!href) return;

          const normalized = normalizeUrl(href, url);
          if (!normalized) return;
          if (!normalized.startsWith(baseOrigin)) return;
          if (visited.has(normalized)) return;
          if (!isHtmlUrl(normalized)) return;
          if (!isAllowed(normalized)) return;

          visited.add(normalized);
          queue.push({ url: normalized, depth: depth + 1 });
        });
      }
    } catch {
      // Skip pages that fail to load
    }
  }

  return [...visited];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/discovery/crawler.test.ts
```

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/discovery/crawler.ts tests/discovery/crawler.test.ts
git commit -m "feat: add BFS link crawler with depth/page limits and robots filtering"
```

---

## Task 6: Discovery Orchestrator

**Files:**
- Create: `src/discovery/discover.ts`
- Create: `tests/discovery/discover.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/discovery/discover.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverUrls } from '../../src/discovery/discover.js';
import * as robotsModule from '../../src/discovery/robots.js';
import * as sitemapModule from '../../src/discovery/sitemap.js';
import * as crawlerModule from '../../src/discovery/crawler.js';

vi.mock('../../src/discovery/robots.js');
vi.mock('../../src/discovery/sitemap.js');
vi.mock('../../src/discovery/crawler.js');

const mockFetchRobots = vi.mocked(robotsModule.fetchRobots);
const mockParseSitemap = vi.mocked(sitemapModule.parseSitemap);
const mockCrawlSite = vi.mocked(crawlerModule.crawlSite);

describe('discoverUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchRobots.mockResolvedValue({
      sitemapUrls: [],
      isAllowed: () => true,
    });
    mockParseSitemap.mockResolvedValue([]);
    mockCrawlSite.mockResolvedValue([]);
  });

  it('uses sitemap from robots.txt when available', async () => {
    mockFetchRobots.mockResolvedValue({
      sitemapUrls: ['https://example.com/custom-sitemap.xml'],
      isAllowed: () => true,
    });
    mockParseSitemap.mockResolvedValue(['https://example.com/', 'https://example.com/about']);

    const result = await discoverUrls('https://example.com', {
      maxPages: 100,
      crawlDepth: 3,
      alsoCrawl: false,
    });

    expect(mockParseSitemap).toHaveBeenCalledWith('https://example.com/custom-sitemap.xml');
    expect(result).toHaveLength(2);
    expect(result[0].discoveryMethod).toBe('sitemap');
  });

  it('falls back to /sitemap.xml when robots has no sitemap', async () => {
    mockParseSitemap.mockResolvedValue(['https://example.com/']);

    const result = await discoverUrls('https://example.com', {
      maxPages: 100,
      crawlDepth: 3,
      alsoCrawl: false,
    });

    expect(mockParseSitemap).toHaveBeenCalledWith('https://example.com/sitemap.xml');
    expect(result).toHaveLength(1);
  });

  it('crawls when no sitemap found', async () => {
    mockCrawlSite.mockResolvedValue(['https://example.com/', 'https://example.com/page']);

    const result = await discoverUrls('https://example.com', {
      maxPages: 100,
      crawlDepth: 3,
      alsoCrawl: false,
    });

    expect(mockCrawlSite).toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result[0].discoveryMethod).toBe('crawl');
  });

  it('merges sitemap and crawl when alsoCrawl is true', async () => {
    mockParseSitemap.mockResolvedValue(['https://example.com/', 'https://example.com/about']);
    mockCrawlSite.mockResolvedValue(['https://example.com/', 'https://example.com/hidden']);

    const result = await discoverUrls('https://example.com', {
      maxPages: 100,
      crawlDepth: 3,
      alsoCrawl: true,
    });

    const urls = result.map((r) => r.url);
    expect(urls).toContain('https://example.com/');
    expect(urls).toContain('https://example.com/about');
    expect(urls).toContain('https://example.com/hidden');
    // Deduplicated — root appears once
    expect(urls.filter((u) => u === 'https://example.com/').length).toBe(1);
  });

  it('filters disallowed URLs from sitemap results', async () => {
    mockFetchRobots.mockResolvedValue({
      sitemapUrls: [],
      isAllowed: (url: string) => !url.includes('/admin'),
    });
    mockParseSitemap.mockResolvedValue([
      'https://example.com/',
      'https://example.com/admin',
    ]);

    const result = await discoverUrls('https://example.com', {
      maxPages: 100,
      crawlDepth: 3,
      alsoCrawl: false,
    });

    expect(result.map((r) => r.url)).not.toContain('https://example.com/admin');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/discovery/discover.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/discovery/discover.ts**

```typescript
import type { DiscoveredUrl } from '../types.js';
import { fetchRobots } from './robots.js';
import { parseSitemap } from './sitemap.js';
import { crawlSite } from './crawler.js';

interface DiscoverOptions {
  readonly maxPages: number;
  readonly crawlDepth: number;
  readonly alsoCrawl: boolean;
}

export async function discoverUrls(
  baseUrl: string,
  options: DiscoverOptions,
): Promise<DiscoveredUrl[]> {
  const { maxPages, crawlDepth, alsoCrawl } = options;

  // Step 1: Fetch robots.txt
  const robots = await fetchRobots(baseUrl);

  // Step 2: Try sitemap
  let sitemapUrls: string[] = [];

  if (robots.sitemapUrls.length > 0) {
    const allUrls = await Promise.all(robots.sitemapUrls.map(parseSitemap));
    sitemapUrls = allUrls.flat();
  } else {
    const defaultSitemapUrl = new URL('/sitemap.xml', baseUrl).href;
    sitemapUrls = await parseSitemap(defaultSitemapUrl);
  }

  // Filter disallowed URLs from sitemap
  sitemapUrls = sitemapUrls.filter((url) => robots.isAllowed(url));

  const hasSitemap = sitemapUrls.length > 0;

  // Step 3: Crawl if no sitemap or alsoCrawl enabled
  let crawledUrls: string[] = [];
  if (!hasSitemap || alsoCrawl) {
    crawledUrls = await crawlSite(baseUrl, {
      maxPages,
      maxDepth: crawlDepth,
      isAllowed: robots.isAllowed,
    });
  }

  // Merge and deduplicate
  const seen = new Set<string>();
  const results: DiscoveredUrl[] = [];

  // Sitemap URLs first (higher priority)
  for (const url of sitemapUrls) {
    if (!seen.has(url)) {
      seen.add(url);
      results.push({ url, discoveryMethod: 'sitemap' });
    }
  }

  // Then crawled URLs
  for (const url of crawledUrls) {
    if (!seen.has(url)) {
      seen.add(url);
      results.push({ url, discoveryMethod: 'crawl' });
    }
  }

  return results.slice(0, maxPages);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/discovery/discover.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/discovery/discover.ts tests/discovery/discover.test.ts
git commit -m "feat: add discovery orchestrator (robots → sitemap → crawl fallback)"
```

---

## Task 7: Pa11y Webservice Client

**Files:**
- Create: `src/scanner/webservice-client.ts`
- Create: `tests/scanner/webservice-client.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/scanner/webservice-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebserviceClient } from '../../src/scanner/webservice-client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('WebserviceClient', () => {
  const client = new WebserviceClient('http://pa11y:3000', {});
  const clientWithAuth = new WebserviceClient('http://pa11y:3000', {
    Authorization: 'Bearer token',
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a task via POST /tasks', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'task-1', name: 'Test', url: 'https://example.com' }),
    });

    const task = await client.createTask({
      name: 'Test',
      url: 'https://example.com',
      standard: 'WCAG2AA',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://pa11y:3000/tasks',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(task.id).toBe('task-1');
  });

  it('sends webserviceHeaders with every request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'task-1' }),
    });

    await clientWithAuth.createTask({
      name: 'Test',
      url: 'https://example.com',
      standard: 'WCAG2AA',
    });

    const callArgs = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer token');
  });

  it('triggers a run via POST /tasks/{id}/run', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });

    await client.runTask('task-1');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://pa11y:3000/tasks/task-1/run',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fetches results via GET /tasks/{id}/results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ date: '2026-03-18', issues: [] }],
    });

    const results = await client.getResults('task-1');
    expect(results).toHaveLength(1);
    expect(results[0].date).toBe('2026-03-18');
  });

  it('deletes a task via DELETE /tasks/{id}', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

    await client.deleteTask('task-1');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://pa11y:3000/tasks/task-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(
      client.createTask({ name: 'Test', url: 'https://example.com', standard: 'WCAG2AA' }),
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/scanner/webservice-client.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/scanner/webservice-client.ts**

```typescript
export interface CreateTaskInput {
  readonly name: string;
  readonly url: string;
  readonly standard: string;
  readonly ignore?: readonly string[];
  readonly timeout?: number;
  readonly wait?: number;
  readonly hideElements?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface Pa11yTask {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly [key: string]: unknown;
}

export interface Pa11yResult {
  readonly date: string;
  readonly issues?: readonly Pa11yIssue[];
  readonly [key: string]: unknown;
}

export interface Pa11yIssue {
  readonly code: string;
  readonly type: string;
  readonly message: string;
  readonly selector: string;
  readonly context: string;
  readonly [key: string]: unknown;
}

export class WebserviceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly headers: Readonly<Record<string, string>>,
  ) {}

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
        ...(options.headers as Record<string, string> | undefined),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Pa11y webservice error: ${response.status} ${response.statusText} for ${options.method ?? 'GET'} ${path}`,
      );
    }

    if (response.status === 204 || response.status === 202) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async createTask(input: CreateTaskInput): Promise<Pa11yTask> {
    return this.request<Pa11yTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async runTask(taskId: string): Promise<void> {
    await this.request<void>(`/tasks/${taskId}/run`, { method: 'POST' });
  }

  async getResults(taskId: string): Promise<Pa11yResult[]> {
    return this.request<Pa11yResult[]>(`/tasks/${taskId}/results?full=true`);
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request<void>(`/tasks/${taskId}`, { method: 'DELETE' });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/scanner/webservice-client.test.ts
```

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/scanner/webservice-client.ts tests/scanner/webservice-client.test.ts
git commit -m "feat: add pa11y webservice REST client"
```

---

## Task 8: Scanner (Concurrency, Polling, Progress)

**Files:**
- Create: `src/scanner/scanner.ts`
- Create: `tests/scanner/scanner.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/scanner/scanner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scanUrls } from '../../src/scanner/scanner.js';
import { WebserviceClient } from '../../src/scanner/webservice-client.js';
import type { DiscoveredUrl, ScanProgress, PageResult } from '../../src/types.js';

vi.mock('../../src/scanner/webservice-client.js');

function makeUrls(count: number): DiscoveredUrl[] {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://example.com/page-${i}`,
    discoveryMethod: 'sitemap' as const,
  }));
}

describe('scanUrls', () => {
  let mockClient: {
    createTask: ReturnType<typeof vi.fn>;
    runTask: ReturnType<typeof vi.fn>;
    getResults: ReturnType<typeof vi.fn>;
    deleteTask: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    mockClient = {
      createTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
      runTask: vi.fn().mockResolvedValue(undefined),
      getResults: vi.fn().mockResolvedValue([
        {
          date: '2026-03-18',
          issues: [
            {
              code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
              type: 'error',
              message: 'Image missing alt',
              selector: 'img',
              context: '<img src="photo.jpg">',
            },
          ],
        },
      ]),
      deleteTask: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scans a single URL through the full lifecycle', async () => {
    const urls = makeUrls(1);
    const results = await scanUrls(urls, mockClient as unknown as WebserviceClient, {
      standard: 'WCAG2AA',
      concurrency: 5,
      timeout: 30000,
      pollTimeout: 60000,
      ignore: [],
      hideElements: '',
      headers: {},
      wait: 0,
    });

    expect(mockClient.createTask).toHaveBeenCalledTimes(1);
    expect(mockClient.runTask).toHaveBeenCalledTimes(1);
    expect(mockClient.getResults).toHaveBeenCalled();
    expect(mockClient.deleteTask).toHaveBeenCalledTimes(1);
    expect(results.pages).toHaveLength(1);
    expect(results.pages[0].issueCount).toBe(1);
    expect(results.errors).toHaveLength(0);
  });

  it('emits progress events', async () => {
    const urls = makeUrls(2);
    const events: ScanProgress[] = [];

    await scanUrls(urls, mockClient as unknown as WebserviceClient, {
      standard: 'WCAG2AA',
      concurrency: 5,
      timeout: 30000,
      pollTimeout: 60000,
      ignore: [],
      hideElements: '',
      headers: {},
      wait: 0,
      onProgress: (event) => events.push(event),
    });

    const starts = events.filter((e) => e.type === 'scan:start');
    const completes = events.filter((e) => e.type === 'scan:complete');
    expect(starts.length).toBe(2);
    expect(completes.length).toBe(2);
  });

  it('limits concurrency', async () => {
    let activeTasks = 0;
    let maxActive = 0;

    mockClient.createTask.mockImplementation(async () => {
      activeTasks++;
      maxActive = Math.max(maxActive, activeTasks);
      return { id: `task-${Date.now()}` };
    });

    mockClient.deleteTask.mockImplementation(async () => {
      activeTasks--;
    });

    const urls = makeUrls(10);
    await scanUrls(urls, mockClient as unknown as WebserviceClient, {
      standard: 'WCAG2AA',
      concurrency: 3,
      timeout: 30000,
      pollTimeout: 60000,
      ignore: [],
      hideElements: '',
      headers: {},
      wait: 0,
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('records scan error on timeout with retry', async () => {
    mockClient.getResults.mockResolvedValue([]); // Never completes

    const urls = makeUrls(1);
    const results = await scanUrls(urls, mockClient as unknown as WebserviceClient, {
      standard: 'WCAG2AA',
      concurrency: 5,
      timeout: 30000,
      pollTimeout: 100, // Very short for test
      ignore: [],
      hideElements: '',
      headers: {},
      wait: 0,
    });

    expect(results.errors).toHaveLength(1);
    expect(results.errors[0].code).toBe('TIMEOUT');
    expect(results.errors[0].retried).toBe(true);
    // Task should still be deleted
    expect(mockClient.deleteTask).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/scanner/scanner.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/scanner/scanner.ts**

```typescript
import type {
  DiscoveredUrl,
  PageResult,
  ScanError,
  ScanProgress,
  AccessibilityIssue,
  ProgressListener,
} from '../types.js';
import { WebserviceClient, type Pa11yResult } from './webservice-client.js';

interface ScanOptions {
  readonly standard: string;
  readonly concurrency: number;
  readonly timeout: number;
  readonly pollTimeout: number;
  readonly ignore: readonly string[];
  readonly hideElements: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly wait: number;
  readonly onProgress?: ProgressListener;
}

interface ScanResults {
  readonly pages: readonly PageResult[];
  readonly errors: readonly ScanError[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapIssues(result: Pa11yResult): AccessibilityIssue[] {
  if (!result.issues) return [];
  return result.issues.map((issue) => ({
    code: issue.code,
    type: issue.type as 'error' | 'warning' | 'notice',
    message: issue.message,
    selector: issue.selector,
    context: issue.context,
    fixSuggestion: `Refer to WCAG documentation for ${issue.code}`,
  }));
}

async function pollForResults(
  client: WebserviceClient,
  taskId: string,
  pollTimeout: number,
): Promise<Pa11yResult | null> {
  const start = Date.now();
  let delay = 1000;
  const maxDelay = 10000;

  while (Date.now() - start < pollTimeout) {
    const results = await client.getResults(taskId);
    if (results.length > 0 && results[0].date) {
      return results[0];
    }

    // Exponential backoff with jitter
    const jitter = Math.random() * 1000 - 500;
    await sleep(Math.max(100, delay + jitter));
    delay = Math.min(delay * 2, maxDelay);
  }

  return null;
}

async function scanSingleUrl(
  discovered: DiscoveredUrl,
  client: WebserviceClient,
  options: ScanOptions,
): Promise<{ page?: PageResult; error?: ScanError }> {
  let taskId: string | null = null;
  let retried = false;

  try {
    const task = await client.createTask({
      name: `pally-agent: ${discovered.url}`,
      url: discovered.url,
      standard: options.standard,
      ignore: [...options.ignore],
      timeout: options.timeout,
      wait: options.wait,
      hideElements: options.hideElements || undefined,
      headers: Object.keys(options.headers).length > 0 ? options.headers : undefined,
    });
    taskId = task.id;

    await client.runTask(taskId);

    // Poll with retry
    let result = await pollForResults(client, taskId, options.pollTimeout);

    if (!result) {
      // Retry once
      retried = true;
      await client.runTask(taskId);
      result = await pollForResults(client, taskId, options.pollTimeout);
    }

    if (!result) {
      return {
        error: {
          url: discovered.url,
          code: 'TIMEOUT',
          message: `Scan timed out after ${options.pollTimeout}ms (retried: true)`,
          retried: true,
        },
        page: {
          url: discovered.url,
          discoveryMethod: discovered.discoveryMethod,
          issueCount: 0,
          issues: [],
          error: {
            url: discovered.url,
            code: 'TIMEOUT',
            message: `Scan timed out after ${options.pollTimeout}ms (retried: true)`,
            retried: true,
          },
        },
      };
    }

    const issues = mapIssues(result);
    return {
      page: {
        url: discovered.url,
        discoveryMethod: discovered.discoveryMethod,
        issueCount: issues.length,
        issues,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: {
        url: discovered.url,
        code: 'WEBSERVICE_ERROR',
        message,
        retried,
      },
      page: {
        url: discovered.url,
        discoveryMethod: discovered.discoveryMethod,
        issueCount: 0,
        issues: [],
        error: {
          url: discovered.url,
          code: 'WEBSERVICE_ERROR',
          message,
          retried,
        },
      },
    };
  } finally {
    if (taskId) {
      try {
        await client.deleteTask(taskId);
      } catch {
        // Best effort cleanup
      }
    }
  }
}

export async function scanUrls(
  urls: readonly DiscoveredUrl[],
  client: WebserviceClient,
  options: ScanOptions,
): Promise<ScanResults> {
  const pages: PageResult[] = [];
  const errors: ScanError[] = [];
  const total = urls.length;
  let completed = 0;

  const emit = (progress: ScanProgress) => {
    options.onProgress?.(progress);
  };

  // Process with concurrency limit
  const queue = [...urls];
  const active: Promise<void>[] = [];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const discovered = queue.shift()!;
      completed++;

      emit({
        type: 'scan:start',
        url: discovered.url,
        current: completed,
        total,
        timestamp: new Date().toISOString(),
      });

      const result = await scanSingleUrl(discovered, client, options);

      if (result.page) {
        pages.push(result.page);
      }
      if (result.error) {
        errors.push(result.error);
        emit({
          type: 'scan:error',
          url: discovered.url,
          current: completed,
          total,
          timestamp: new Date().toISOString(),
          error: result.error.message,
        });
      } else {
        emit({
          type: 'scan:complete',
          url: discovered.url,
          current: completed,
          total,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Launch workers up to concurrency limit
  for (let i = 0; i < Math.min(options.concurrency, urls.length); i++) {
    active.push(processNext());
  }

  await Promise.all(active);

  return { pages, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/scanner/scanner.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/scanner/scanner.ts tests/scanner/scanner.test.ts
git commit -m "feat: add scanner with concurrency, polling, progress, and error handling"
```

---

## Task 9: JSON Reporter

**Files:**
- Create: `src/reporter/json-reporter.ts`
- Create: `tests/reporter/json-reporter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/reporter/json-reporter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateJsonReport } from '../../src/reporter/json-reporter.js';
import type { PageResult, ScanError } from '../../src/types.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('generateJsonReport', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = join(tmpdir(), `pally-json-test-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  const pages: PageResult[] = [
    {
      url: 'https://example.com/',
      discoveryMethod: 'sitemap',
      issueCount: 2,
      issues: [
        { code: 'WCAG2AA.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img src="x">' },
        { code: 'WCAG2AA.H44', type: 'warning', message: 'Missing label', selector: 'input', context: '<input>' },
      ],
    },
    {
      url: 'https://example.com/about',
      discoveryMethod: 'sitemap',
      issueCount: 0,
      issues: [],
    },
  ];

  const errors: ScanError[] = [];

  it('generates a valid JSON report with summary', async () => {
    const report = await generateJsonReport({
      siteUrl: 'https://example.com',
      pages,
      errors,
      outputDir,
    });

    expect(report.summary.pagesScanned).toBe(2);
    expect(report.summary.totalIssues).toBe(2);
    expect(report.summary.byLevel.error).toBe(1);
    expect(report.summary.byLevel.warning).toBe(1);
    expect(report.summary.byLevel.notice).toBe(0);
    expect(report.pages).toHaveLength(2);
  });

  it('writes report to outputDir with timestamped name', async () => {
    const report = await generateJsonReport({
      siteUrl: 'https://example.com',
      pages,
      errors,
      outputDir,
    });

    expect(existsSync(report.reportPath)).toBe(true);
    expect(report.reportPath).toMatch(/pally-report-.*\.json$/);

    const content = JSON.parse(readFileSync(report.reportPath, 'utf-8'));
    expect(content.summary.totalIssues).toBe(2);
  });

  it('does not overwrite existing report files', async () => {
    const report1 = await generateJsonReport({
      siteUrl: 'https://example.com',
      pages,
      errors,
      outputDir,
    });

    // Small delay to get different timestamp
    await new Promise((r) => setTimeout(r, 10));

    const report2 = await generateJsonReport({
      siteUrl: 'https://example.com',
      pages,
      errors,
      outputDir,
    });

    expect(report1.reportPath).not.toBe(report2.reportPath);
    expect(existsSync(report1.reportPath)).toBe(true);
    expect(existsSync(report2.reportPath)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/reporter/json-reporter.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/reporter/json-reporter.ts**

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PageResult, ScanError, ScanReport } from '../types.js';

interface JsonReportInput {
  readonly siteUrl: string;
  readonly pages: readonly PageResult[];
  readonly errors: readonly ScanError[];
  readonly outputDir: string;
}

function generateTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}/, '');
}

function buildUniqueFilename(outputDir: string, timestamp: string): string {
  let filename = `pally-report-${timestamp}.json`;
  let fullPath = join(outputDir, filename);
  let counter = 1;

  while (existsSync(fullPath)) {
    filename = `pally-report-${timestamp}-${counter}.json`;
    fullPath = join(outputDir, filename);
    counter++;
  }

  return fullPath;
}

export async function generateJsonReport(input: JsonReportInput): Promise<ScanReport> {
  const { siteUrl, pages, errors, outputDir } = input;

  const byLevel = { error: 0, warning: 0, notice: 0 };
  for (const page of pages) {
    for (const issue of page.issues) {
      if (issue.type in byLevel) {
        byLevel[issue.type]++;
      }
    }
  }

  const report: ScanReport = {
    summary: {
      url: siteUrl,
      pagesScanned: pages.length,
      pagesFailed: errors.length,
      totalIssues: pages.reduce((sum, p) => sum + p.issueCount, 0),
      byLevel,
    },
    pages: [...pages],
    errors: [...errors],
    reportPath: '', // Will be set after writing
  };

  await mkdir(outputDir, { recursive: true });

  const timestamp = generateTimestamp();
  const reportPath = buildUniqueFilename(outputDir, timestamp);

  const reportWithPath: ScanReport = { ...report, reportPath };

  await writeFile(reportPath, JSON.stringify(reportWithPath, null, 2), 'utf-8');

  return reportWithPath;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/reporter/json-reporter.test.ts
```

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/reporter/json-reporter.ts tests/reporter/json-reporter.test.ts
git commit -m "feat: add JSON reporter with timestamped output and no-overwrite"
```

---

## Task 10: HTML Reporter

**Files:**
- Create: `src/reporter/report.hbs`
- Create: `src/reporter/html-reporter.ts`
- Create: `tests/reporter/html-reporter.test.ts`

- [ ] **Step 1: Write the Handlebars template**

Create `src/reporter/report.hbs`:

```handlebars
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pally Agent Report — {{summary.url}}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 1200px; margin: 0 auto; padding: 20px; color: #1a1a1a; background: #f8f9fa; }
  h1 { margin-bottom: 8px; }
  .meta { color: #666; margin-bottom: 24px; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .summary-card { background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .summary-card .value { font-size: 2em; font-weight: bold; }
  .summary-card .label { color: #666; font-size: 0.9em; }
  .error .value { color: #dc3545; }
  .warning .value { color: #ffc107; }
  .notice .value { color: #0d6efd; }
  .page-section { background: white; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .page-header { padding: 16px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; }
  .page-header:hover { background: #f8f9fa; }
  .page-header .url { font-weight: 600; word-break: break-all; }
  .page-header .badge { padding: 2px 8px; border-radius: 12px; font-size: 0.85em; font-weight: 600; }
  .badge-error { background: #f8d7da; color: #842029; }
  .badge-warning { background: #fff3cd; color: #664d03; }
  .badge-notice { background: #cfe2ff; color: #084298; }
  .badge-clean { background: #d1e7dd; color: #0f5132; }
  .page-body { padding: 16px; display: none; }
  .page-body.open { display: block; }
  .issue { padding: 12px; border-left: 4px solid #ddd; margin-bottom: 12px; background: #fafafa; border-radius: 0 4px 4px 0; }
  .issue.issue-error { border-left-color: #dc3545; }
  .issue.issue-warning { border-left-color: #ffc107; }
  .issue.issue-notice { border-left-color: #0d6efd; }
  .issue-code { font-family: monospace; font-size: 0.85em; color: #666; }
  .issue-message { margin: 4px 0; }
  .issue-selector { font-family: monospace; font-size: 0.85em; color: #495057; }
  .issue-context { font-family: monospace; font-size: 0.85em; background: #f1f3f5; padding: 8px; border-radius: 4px; margin-top: 8px; overflow-x: auto; white-space: pre-wrap; }
  .controls { margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
  .controls button { padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer; font-size: 0.9em; }
  .controls button:hover { background: #e9ecef; }
  .controls button.active { background: #0d6efd; color: white; border-color: #0d6efd; }
  .failed-page { padding: 16px; background: #fff5f5; border-left: 4px solid #dc3545; margin-bottom: 12px; border-radius: 0 4px 4px 0; }
</style>
</head>
<body>
<h1>Accessibility Report</h1>
<p class="meta">{{summary.url}} — {{summary.pagesScanned}} pages scanned</p>

<div class="summary">
  <div class="summary-card"><div class="value">{{summary.pagesScanned}}</div><div class="label">Pages Scanned</div></div>
  <div class="summary-card"><div class="value">{{summary.totalIssues}}</div><div class="label">Total Issues</div></div>
  <div class="summary-card error"><div class="value">{{summary.byLevel.error}}</div><div class="label">Errors</div></div>
  <div class="summary-card warning"><div class="value">{{summary.byLevel.warning}}</div><div class="label">Warnings</div></div>
  <div class="summary-card notice"><div class="value">{{summary.byLevel.notice}}</div><div class="label">Notices</div></div>
  <div class="summary-card"><div class="value">{{summary.pagesFailed}}</div><div class="label">Failed</div></div>
</div>

<div class="controls">
  <button onclick="filterBy('all')" class="active" id="btn-all">All</button>
  <button onclick="filterBy('error')" id="btn-error">Errors</button>
  <button onclick="filterBy('warning')" id="btn-warning">Warnings</button>
  <button onclick="filterBy('notice')" id="btn-notice">Notices</button>
  <button onclick="expandAll()">Expand All</button>
  <button onclick="collapseAll()">Collapse All</button>
</div>

{{#each pages}}
<div class="page-section" data-has-errors="{{#if (issuesByType this.issues 'error')}}true{{/if}}" data-has-warnings="{{#if (issuesByType this.issues 'warning')}}true{{/if}}" data-has-notices="{{#if (issuesByType this.issues 'notice')}}true{{/if}}">
  <div class="page-header" onclick="toggleSection(this)">
    <span class="url">{{this.url}}</span>
    <span>
      {{#if this.error}}
        <span class="badge badge-error">FAILED</span>
      {{else if (eq this.issueCount 0)}}
        <span class="badge badge-clean">Clean</span>
      {{else}}
        <span class="badge badge-error">{{countByType this.issues 'error'}}E</span>
        <span class="badge badge-warning">{{countByType this.issues 'warning'}}W</span>
        <span class="badge badge-notice">{{countByType this.issues 'notice'}}N</span>
      {{/if}}
    </span>
  </div>
  <div class="page-body">
    {{#if this.error}}
    <div class="failed-page">
      <strong>Scan failed:</strong> {{this.error.message}} (code: {{this.error.code}}, retried: {{this.error.retried}})
    </div>
    {{/if}}
    {{#each this.issues}}
    <div class="issue issue-{{this.type}}" data-type="{{this.type}}">
      <div class="issue-code">{{this.code}}</div>
      <div class="issue-message">{{this.message}}</div>
      <div class="issue-selector">{{this.selector}}</div>
      <div class="issue-context">{{this.context}}</div>
    </div>
    {{/each}}
    {{#if (eq this.issueCount 0)}}
      {{#unless this.error}}<p>No accessibility issues found.</p>{{/unless}}
    {{/if}}
  </div>
</div>
{{/each}}

<script>
function toggleSection(header) {
  header.nextElementSibling.classList.toggle('open');
}
function expandAll() {
  document.querySelectorAll('.page-body').forEach(el => el.classList.add('open'));
}
function collapseAll() {
  document.querySelectorAll('.page-body').forEach(el => el.classList.remove('open'));
}
function filterBy(type) {
  document.querySelectorAll('.controls button').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + type).classList.add('active');
  document.querySelectorAll('.issue').forEach(el => {
    el.style.display = (type === 'all' || el.dataset.type === type) ? '' : 'none';
  });
}
</script>
</body>
</html>
```

- [ ] **Step 2: Write failing tests**

Create `tests/reporter/html-reporter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateHtmlReport } from '../../src/reporter/html-reporter.js';
import type { PageResult, ScanError } from '../../src/types.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('generateHtmlReport', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = join(tmpdir(), `pally-html-test-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  const pages: PageResult[] = [
    {
      url: 'https://example.com/',
      discoveryMethod: 'sitemap',
      issueCount: 1,
      issues: [
        { code: 'WCAG2AA.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
      ],
    },
  ];

  const errors: ScanError[] = [];

  it('generates a self-contained HTML file with no external references', async () => {
    const reportPath = await generateHtmlReport({
      siteUrl: 'https://example.com',
      pages,
      errors,
      outputDir,
    });

    expect(existsSync(reportPath)).toBe(true);
    const html = readFileSync(reportPath, 'utf-8');

    // No external script or stylesheet references
    expect(html).not.toMatch(/<script\s+src=/);
    expect(html).not.toMatch(/<link\s+.*href=.*\.css/);

    // Contains summary with page count
    expect(html).toMatch(/\d+\s+pages?\s+scanned/);
    // Contains page sections
    expect(html).toContain('https://example.com/');
    expect(html).toContain('page-section');
  });

  it('includes summary card with page count', async () => {
    const reportPath = await generateHtmlReport({
      siteUrl: 'https://example.com',
      pages,
      errors,
      outputDir,
    });

    const html = readFileSync(reportPath, 'utf-8');
    expect(html).toContain('summary-card');
    expect(html).toContain('Pages Scanned');
  });

  it('has collapsible page sections', async () => {
    const reportPath = await generateHtmlReport({
      siteUrl: 'https://example.com',
      pages,
      errors,
      outputDir,
    });

    const html = readFileSync(reportPath, 'utf-8');
    expect(html).toContain('page-header');
    expect(html).toContain('page-body');
    expect(html).toContain('toggleSection');
  });

  it('does not overwrite existing report files', async () => {
    const path1 = await generateHtmlReport({
      siteUrl: 'https://example.com',
      pages,
      errors,
      outputDir,
    });

    await new Promise((r) => setTimeout(r, 10));

    const path2 = await generateHtmlReport({
      siteUrl: 'https://example.com',
      pages,
      errors,
      outputDir,
    });

    expect(path1).not.toBe(path2);
    expect(existsSync(path1)).toBe(true);
    expect(existsSync(path2)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/reporter/html-reporter.test.ts
```

Expected: FAIL

- [ ] **Step 4: Implement src/reporter/html-reporter.ts**

```typescript
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import type { PageResult, ScanError, ScanSummary } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface HtmlReportInput {
  readonly siteUrl: string;
  readonly pages: readonly PageResult[];
  readonly errors: readonly ScanError[];
  readonly outputDir: string;
}

function generateTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}/, '');
}

function buildUniqueFilename(outputDir: string, timestamp: string): string {
  let filename = `pally-report-${timestamp}.html`;
  let fullPath = join(outputDir, filename);
  let counter = 1;

  while (existsSync(fullPath)) {
    filename = `pally-report-${timestamp}-${counter}.html`;
    fullPath = join(outputDir, filename);
    counter++;
  }

  return fullPath;
}

export async function generateHtmlReport(input: HtmlReportInput): Promise<string> {
  const { siteUrl, pages, errors, outputDir } = input;

  const byLevel = { error: 0, warning: 0, notice: 0 };
  for (const page of pages) {
    for (const issue of page.issues) {
      if (issue.type in byLevel) {
        byLevel[issue.type]++;
      }
    }
  }

  const summary: ScanSummary = {
    url: siteUrl,
    pagesScanned: pages.length,
    pagesFailed: errors.length,
    totalIssues: pages.reduce((sum, p) => sum + p.issueCount, 0),
    byLevel,
  };

  // Register helpers
  Handlebars.registerHelper('eq', (a, b) => a === b);
  Handlebars.registerHelper('issuesByType', (issues: readonly { type: string }[], type: string) =>
    issues.some((i) => i.type === type),
  );
  Handlebars.registerHelper('countByType', (issues: readonly { type: string }[], type: string) =>
    issues.filter((i) => i.type === type).length,
  );

  const templateSource = await readFile(join(__dirname, 'report.hbs'), 'utf-8');
  const template = Handlebars.compile(templateSource);

  const html = template({ summary, pages, errors });

  await mkdir(outputDir, { recursive: true });
  const timestamp = generateTimestamp();
  const reportPath = buildUniqueFilename(outputDir, timestamp);
  await writeFile(reportPath, html, 'utf-8');

  return reportPath;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/reporter/html-reporter.test.ts
```

Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/reporter/report.hbs src/reporter/html-reporter.ts tests/reporter/html-reporter.test.ts
git commit -m "feat: add HTML reporter with self-contained template"
```

---

## Task 11: Framework Detector

**Files:**
- Create: `src/source-mapper/framework-detector.ts`
- Create: `tests/source-mapper/framework-detector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/source-mapper/framework-detector.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectFramework, type Framework } from '../../src/source-mapper/framework-detector.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('detectFramework', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `pally-fw-test-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('detects Next.js App Router', async () => {
    writeFileSync(join(repoDir, 'next.config.js'), 'module.exports = {}');
    mkdirSync(join(repoDir, 'app'), { recursive: true });
    writeFileSync(join(repoDir, 'app', 'page.tsx'), '');
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));

    const fw = await detectFramework(repoDir);
    expect(fw).toBe('nextjs-app');
  });

  it('detects Next.js Pages Router', async () => {
    writeFileSync(join(repoDir, 'next.config.js'), 'module.exports = {}');
    mkdirSync(join(repoDir, 'pages'), { recursive: true });
    writeFileSync(join(repoDir, 'pages', 'index.tsx'), '');
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));

    const fw = await detectFramework(repoDir);
    expect(fw).toBe('nextjs-pages');
  });

  it('detects Nuxt', async () => {
    writeFileSync(join(repoDir, 'nuxt.config.ts'), '');
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ dependencies: { nuxt: '3' } }));

    const fw = await detectFramework(repoDir);
    expect(fw).toBe('nuxt');
  });

  it('detects SvelteKit', async () => {
    writeFileSync(join(repoDir, 'svelte.config.js'), '');
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ devDependencies: { '@sveltejs/kit': '1' } }));

    const fw = await detectFramework(repoDir);
    expect(fw).toBe('sveltekit');
  });

  it('falls back to plain-html when no framework detected', async () => {
    writeFileSync(join(repoDir, 'index.html'), '<html></html>');

    const fw = await detectFramework(repoDir);
    expect(fw).toBe('plain-html');
  });

  it('returns unknown when nothing matches', async () => {
    const fw = await detectFramework(repoDir);
    expect(fw).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/source-mapper/framework-detector.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/source-mapper/framework-detector.ts**

```typescript
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Framework =
  | 'nextjs-app'
  | 'nextjs-pages'
  | 'nuxt'
  | 'sveltekit'
  | 'angular'
  | 'plain-html'
  | 'unknown';

function fileExists(path: string): boolean {
  return existsSync(path);
}

async function readPackageJson(
  repoPath: string,
): Promise<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }> {
  const pkgPath = join(repoPath, 'package.json');
  if (!fileExists(pkgPath)) return {};
  try {
    const content = await readFile(pkgPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function hasDep(
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  name: string,
): boolean {
  return name in (pkg.dependencies ?? {}) || name in (pkg.devDependencies ?? {});
}

export async function detectFramework(repoPath: string): Promise<Framework> {
  const pkg = await readPackageJson(repoPath);

  // Next.js
  const hasNextConfig =
    fileExists(join(repoPath, 'next.config.js')) ||
    fileExists(join(repoPath, 'next.config.mjs')) ||
    fileExists(join(repoPath, 'next.config.ts'));

  if (hasNextConfig || hasDep(pkg, 'next')) {
    // Distinguish App Router vs Pages Router
    if (fileExists(join(repoPath, 'app')) && fileExists(join(repoPath, 'app', 'page.tsx')) ||
        fileExists(join(repoPath, 'app', 'page.js')) ||
        fileExists(join(repoPath, 'app', 'page.jsx')) ||
        fileExists(join(repoPath, 'src', 'app', 'page.tsx'))) {
      return 'nextjs-app';
    }
    if (fileExists(join(repoPath, 'pages'))) {
      return 'nextjs-pages';
    }
    return 'nextjs-app'; // Default to app router for newer projects
  }

  // Nuxt
  if (
    fileExists(join(repoPath, 'nuxt.config.ts')) ||
    fileExists(join(repoPath, 'nuxt.config.js')) ||
    hasDep(pkg, 'nuxt')
  ) {
    return 'nuxt';
  }

  // SvelteKit
  if (
    fileExists(join(repoPath, 'svelte.config.js')) ||
    fileExists(join(repoPath, 'svelte.config.ts')) ||
    hasDep(pkg, '@sveltejs/kit')
  ) {
    return 'sveltekit';
  }

  // Angular
  if (fileExists(join(repoPath, 'angular.json')) || hasDep(pkg, '@angular/core')) {
    return 'angular';
  }

  // Plain HTML
  if (fileExists(join(repoPath, 'index.html'))) {
    return 'plain-html';
  }

  return 'unknown';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/source-mapper/framework-detector.test.ts
```

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/source-mapper/framework-detector.ts tests/source-mapper/framework-detector.test.ts
git commit -m "feat: add framework detector for Next.js, Nuxt, SvelteKit, Angular, HTML"
```

---

## Task 12: Routing Strategies

**Files:**
- Create: `src/source-mapper/routing-strategies.ts`
- Create: `tests/source-mapper/routing-strategies.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/source-mapper/routing-strategies.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveUrlToFile } from '../../src/source-mapper/routing-strategies.js';
import type { Framework } from '../../src/source-mapper/framework-detector.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('resolveUrlToFile', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `pally-route-test-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('maps /about to app/about/page.tsx for nextjs-app', async () => {
    mkdirSync(join(repoDir, 'app', 'about'), { recursive: true });
    writeFileSync(join(repoDir, 'app', 'about', 'page.tsx'), '');

    const result = await resolveUrlToFile('/about', 'nextjs-app', repoDir);
    expect(result).toBe(join(repoDir, 'app', 'about', 'page.tsx'));
  });

  it('maps / to app/page.tsx for nextjs-app', async () => {
    mkdirSync(join(repoDir, 'app'), { recursive: true });
    writeFileSync(join(repoDir, 'app', 'page.tsx'), '');

    const result = await resolveUrlToFile('/', 'nextjs-app', repoDir);
    expect(result).toBe(join(repoDir, 'app', 'page.tsx'));
  });

  it('maps /about to pages/about.tsx for nextjs-pages', async () => {
    mkdirSync(join(repoDir, 'pages'), { recursive: true });
    writeFileSync(join(repoDir, 'pages', 'about.tsx'), '');

    const result = await resolveUrlToFile('/about', 'nextjs-pages', repoDir);
    expect(result).toBe(join(repoDir, 'pages', 'about.tsx'));
  });

  it('maps /about to pages/about.vue for nuxt', async () => {
    mkdirSync(join(repoDir, 'pages'), { recursive: true });
    writeFileSync(join(repoDir, 'pages', 'about.vue'), '');

    const result = await resolveUrlToFile('/about', 'nuxt', repoDir);
    expect(result).toBe(join(repoDir, 'pages', 'about.vue'));
  });

  it('maps /about to src/routes/about/+page.svelte for sveltekit', async () => {
    mkdirSync(join(repoDir, 'src', 'routes', 'about'), { recursive: true });
    writeFileSync(join(repoDir, 'src', 'routes', 'about', '+page.svelte'), '');

    const result = await resolveUrlToFile('/about', 'sveltekit', repoDir);
    expect(result).toBe(join(repoDir, 'src', 'routes', 'about', '+page.svelte'));
  });

  it('maps /about to about.html for plain-html', async () => {
    writeFileSync(join(repoDir, 'about.html'), '');

    const result = await resolveUrlToFile('/about', 'plain-html', repoDir);
    expect(result).toBe(join(repoDir, 'about.html'));
  });

  it('tries about/index.html as fallback for plain-html', async () => {
    mkdirSync(join(repoDir, 'about'), { recursive: true });
    writeFileSync(join(repoDir, 'about', 'index.html'), '');

    const result = await resolveUrlToFile('/about', 'plain-html', repoDir);
    expect(result).toBe(join(repoDir, 'about', 'index.html'));
  });

  it('handles dynamic segments [param] in nextjs-app', async () => {
    mkdirSync(join(repoDir, 'app', 'blog', '[id]'), { recursive: true });
    writeFileSync(join(repoDir, 'app', 'blog', '[id]', 'page.tsx'), '');

    const result = await resolveUrlToFile('/blog/123', 'nextjs-app', repoDir);
    expect(result).toBe(join(repoDir, 'app', 'blog', '[id]', 'page.tsx'));
  });

  it('returns null when no file matches', async () => {
    const result = await resolveUrlToFile('/nonexistent', 'nextjs-app', repoDir);
    expect(result).toBeNull();
  });

  it('returns null for unknown framework', async () => {
    const result = await resolveUrlToFile('/about', 'unknown', repoDir);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/source-mapper/routing-strategies.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/source-mapper/routing-strategies.ts**

```typescript
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Framework } from './framework-detector.js';

const PAGE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

function findFileWithExtensions(basePath: string, extensions: string[]): string | null {
  for (const ext of extensions) {
    const full = basePath + ext;
    if (existsSync(full)) return full;
  }
  return null;
}

function findDynamicSegment(dirPath: string, segment: string): string | null {
  if (!existsSync(dirPath)) return null;

  const entries = readdirSync(dirPath, { withFileTypes: true });

  // First try exact match
  const exact = entries.find((e) => e.isDirectory() && e.name === segment);
  if (exact) return join(dirPath, exact.name);

  // Then try [param] dynamic segment
  const dynamic = entries.find((e) => e.isDirectory() && e.name.startsWith('[') && e.name.endsWith(']'));
  if (dynamic) return join(dirPath, dynamic.name);

  // Then try [...slug] catch-all
  const catchAll = entries.find(
    (e) => e.isDirectory() && e.name.startsWith('[...') && e.name.endsWith(']'),
  );
  if (catchAll) return join(dirPath, catchAll.name);

  return null;
}

function resolveNextjsAppRouter(urlPath: string, repoPath: string): string | null {
  const segments = urlPath.split('/').filter(Boolean);
  let dir = join(repoPath, 'app');

  // Also check src/app
  if (!existsSync(dir)) {
    dir = join(repoPath, 'src', 'app');
  }

  // Traverse segments, handling route groups transparently
  for (const segment of segments) {
    const next = findDynamicSegment(dir, segment);
    if (!next) return null;
    dir = next;
  }

  // Look for page file
  return findFileWithExtensions(join(dir, 'page'), PAGE_EXTENSIONS);
}

function resolveNextjsPagesRouter(urlPath: string, repoPath: string): string | null {
  const segments = urlPath.split('/').filter(Boolean);
  const pagesDir = join(repoPath, 'pages');

  if (segments.length === 0) {
    return findFileWithExtensions(join(pagesDir, 'index'), PAGE_EXTENSIONS);
  }

  // Try direct file: pages/about.tsx
  const directPath = join(pagesDir, ...segments);
  const directFile = findFileWithExtensions(directPath, PAGE_EXTENSIONS);
  if (directFile) return directFile;

  // Try index file: pages/about/index.tsx
  const indexFile = findFileWithExtensions(join(directPath, 'index'), PAGE_EXTENSIONS);
  if (indexFile) return indexFile;

  // Try dynamic segments
  let dir = pagesDir;
  for (const segment of segments) {
    const next = findDynamicSegment(dir, segment);
    if (!next) return null;
    dir = next;
  }
  return findFileWithExtensions(join(dir, 'index'), PAGE_EXTENSIONS) ??
    findFileWithExtensions(dir, PAGE_EXTENSIONS);
}

function resolveNuxt(urlPath: string, repoPath: string): string | null {
  const segments = urlPath.split('/').filter(Boolean);
  const pagesDir = join(repoPath, 'pages');

  if (segments.length === 0) {
    const index = join(pagesDir, 'index.vue');
    return existsSync(index) ? index : null;
  }

  const filePath = join(pagesDir, ...segments) + '.vue';
  if (existsSync(filePath)) return filePath;

  const indexPath = join(pagesDir, ...segments, 'index.vue');
  if (existsSync(indexPath)) return indexPath;

  return null;
}

function resolveSvelteKit(urlPath: string, repoPath: string): string | null {
  const segments = urlPath.split('/').filter(Boolean);
  const routesDir = join(repoPath, 'src', 'routes');

  const targetDir = segments.length === 0 ? routesDir : join(routesDir, ...segments);
  const pagePath = join(targetDir, '+page.svelte');

  return existsSync(pagePath) ? pagePath : null;
}

function resolvePlainHtml(urlPath: string, repoPath: string): string | null {
  const segments = urlPath.split('/').filter(Boolean);

  if (segments.length === 0) {
    const index = join(repoPath, 'index.html');
    return existsSync(index) ? index : null;
  }

  const filePath = join(repoPath, ...segments) + '.html';
  if (existsSync(filePath)) return filePath;

  const indexPath = join(repoPath, ...segments, 'index.html');
  if (existsSync(indexPath)) return indexPath;

  return null;
}

export async function resolveUrlToFile(
  urlPath: string,
  framework: Framework,
  repoPath: string,
): Promise<string | null> {
  switch (framework) {
    case 'nextjs-app':
      return resolveNextjsAppRouter(urlPath, repoPath);
    case 'nextjs-pages':
      return resolveNextjsPagesRouter(urlPath, repoPath);
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/source-mapper/routing-strategies.test.ts
```

Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/source-mapper/routing-strategies.ts tests/source-mapper/routing-strategies.test.ts
git commit -m "feat: add URL-to-file routing strategies for all supported frameworks"
```

---

## Task 13: Element Matcher

**Files:**
- Create: `src/source-mapper/element-matcher.ts`
- Create: `tests/source-mapper/element-matcher.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/source-mapper/element-matcher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { matchSelectorToSource } from '../../src/source-mapper/element-matcher.js';

describe('matchSelectorToSource', () => {
  const tsxSource = `
import React from 'react';

export default function About() {
  return (
    <div>
      <h1>About Us</h1>
      <img src="/photo.jpg" />
      <input type="text" />
      <img src="/logo.png" alt="Logo" />
    </div>
  );
}`;

  it('matches img selector to line with <img> tag', () => {
    const result = matchSelectorToSource('img', tsxSource);
    expect(result.confidence).toBe('high');
    expect(result.line).toBeDefined();
  });

  it('returns low confidence when multiple candidates exist', () => {
    // Two <img> tags in the source
    const result = matchSelectorToSource('img:nth-child(2)', tsxSource);
    // Should find img elements but with lower confidence due to nth-child
    expect(['high', 'low']).toContain(result.confidence);
  });

  it('matches input selector', () => {
    const result = matchSelectorToSource('input', tsxSource);
    expect(result.confidence).not.toBe('none');
    expect(result.line).toBeDefined();
  });

  it('returns none confidence for unmatched selector', () => {
    const result = matchSelectorToSource('footer > nav > a', tsxSource);
    expect(result.confidence).toBe('none');
  });

  it('extracts element type from complex selector', () => {
    const result = matchSelectorToSource('div > h1', tsxSource);
    expect(result.confidence).not.toBe('none');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/source-mapper/element-matcher.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/source-mapper/element-matcher.ts**

```typescript
export interface MatchResult {
  readonly line?: number;
  readonly confidence: 'high' | 'low' | 'none';
}

function extractElementType(selector: string): string | null {
  // Get the last element type from a CSS selector
  // e.g. "div > ul > li > a" → "a"
  // e.g. "img" → "img"
  // e.g. ".class" → null
  const parts = selector.split(/[\s>+~]+/).map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;

  // Strip pseudo-classes, nth-child, classes, ids, attributes
  const elementType = last.replace(/[:.#\[][^\s]*/g, '').trim();
  return elementType || null;
}

function findElementInSource(
  elementType: string,
  source: string,
): { lines: number[]; confidence: 'high' | 'low' } {
  const lines = source.split('\n');
  const matches: number[] = [];

  // Match both HTML tags and JSX self-closing tags
  const pattern = new RegExp(`<${elementType}[\\s/>]`, 'i');

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      matches.push(i + 1); // 1-indexed
    }
  }

  if (matches.length === 1) {
    return { lines: matches, confidence: 'high' };
  }

  return { lines: matches, confidence: matches.length > 0 ? 'low' : 'none' };
}

export function matchSelectorToSource(selector: string, source: string): MatchResult {
  const elementType = extractElementType(selector);
  if (!elementType) {
    return { confidence: 'none' };
  }

  const result = findElementInSource(elementType, source);

  if (result.lines.length === 0) {
    return { confidence: 'none' };
  }

  if (result.lines.length === 1) {
    return { line: result.lines[0], confidence: 'high' };
  }

  // Multiple matches — return first with low confidence
  return { line: result.lines[0], confidence: 'low' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/source-mapper/element-matcher.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/source-mapper/element-matcher.ts tests/source-mapper/element-matcher.test.ts
git commit -m "feat: add CSS selector to source line matcher (best-effort)"
```

---

## Task 14: Source Mapper Orchestrator

**Files:**
- Create: `src/source-mapper/source-mapper.ts`
- Create: `tests/source-mapper/source-mapper.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/source-mapper/source-mapper.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mapIssuesToSource } from '../../src/source-mapper/source-mapper.js';
import type { PageResult } from '../../src/types.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('mapIssuesToSource', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `pally-map-test-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    // Set up a Next.js App Router project
    writeFileSync(join(repoDir, 'next.config.js'), 'module.exports = {}');
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));
    mkdirSync(join(repoDir, 'app', 'about'), { recursive: true });
    writeFileSync(
      join(repoDir, 'app', 'about', 'page.tsx'),
      '<div>\n  <img src="/photo.jpg" />\n  <h1>About</h1>\n</div>',
    );
    mkdirSync(join(repoDir, 'app'), { recursive: true });
    writeFileSync(join(repoDir, 'app', 'page.tsx'), '<div><h1>Home</h1></div>');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('maps page issues to source file with line numbers', async () => {
    const pages: PageResult[] = [
      {
        url: 'https://example.com/about',
        discoveryMethod: 'sitemap',
        issueCount: 1,
        issues: [
          { code: 'WCAG2AA.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
        ],
      },
    ];

    const result = await mapIssuesToSource(pages, repoDir, {});
    expect(result[0].sourceMap).toBeDefined();
    expect(result[0].sourceMap!.file).toContain('page.tsx');
    expect(result[0].sourceMap!.confidence).not.toBe('none');
  });

  it('uses sourceMap overrides', async () => {
    const overridePath = join(repoDir, 'custom', 'template.tsx');
    mkdirSync(join(repoDir, 'custom'), { recursive: true });
    writeFileSync(overridePath, '<div><img src="/x.jpg" /></div>');

    const pages: PageResult[] = [
      {
        url: 'https://example.com/about',
        discoveryMethod: 'sitemap',
        issueCount: 1,
        issues: [
          { code: 'WCAG2AA.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
        ],
      },
    ];

    const result = await mapIssuesToSource(pages, repoDir, { '/about': 'custom/template.tsx' });
    expect(result[0].sourceMap!.file).toContain('custom/template.tsx');
  });

  it('returns pages without sourceMap when no file found', async () => {
    const pages: PageResult[] = [
      {
        url: 'https://example.com/nonexistent',
        discoveryMethod: 'crawl',
        issueCount: 1,
        issues: [
          { code: 'WCAG2AA.H37', type: 'error', message: 'Missing alt', selector: 'img', context: '<img>' },
        ],
      },
    ];

    const result = await mapIssuesToSource(pages, repoDir, {});
    expect(result[0].sourceMap).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/source-mapper/source-mapper.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/source-mapper/source-mapper.ts**

```typescript
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PageResult, SourceMapping } from '../types.js';
import { detectFramework } from './framework-detector.js';
import { resolveUrlToFile } from './routing-strategies.js';
import { matchSelectorToSource } from './element-matcher.js';

function extractUrlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function matchOverride(
  urlPath: string,
  sourceMap: Readonly<Record<string, string>>,
): string | null {
  // Check exact match first
  if (sourceMap[urlPath]) return sourceMap[urlPath];

  // Check glob-like patterns (simple * matching)
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
): Promise<PageResult[]> {
  const framework = await detectFramework(repoPath);

  return Promise.all(
    pages.map(async (page): Promise<PageResult> => {
      const urlPath = extractUrlPath(page.url);

      // Try override first
      const overrideFile = matchOverride(urlPath, sourceMapOverrides);
      let filePath: string | null = null;

      if (overrideFile) {
        const fullPath = join(repoPath, overrideFile);
        filePath = existsSync(fullPath) ? fullPath : null;
      } else {
        filePath = await resolveUrlToFile(urlPath, framework, repoPath);
      }

      if (!filePath) {
        return page;
      }

      // Try to match the first issue's selector to get a line number
      let sourceMapping: SourceMapping = {
        file: filePath,
        confidence: 'none',
      };

      if (page.issues.length > 0) {
        try {
          const source = await readFile(filePath, 'utf-8');
          const match = matchSelectorToSource(page.issues[0].selector, source);
          sourceMapping = {
            file: filePath,
            line: match.line,
            confidence: match.confidence,
          };
        } catch {
          // File read failed — still report the file
        }
      } else {
        sourceMapping = { file: filePath, confidence: 'high' };
      }

      return { ...page, sourceMap: sourceMapping };
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/source-mapper/source-mapper.test.ts
```

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/source-mapper/source-mapper.ts tests/source-mapper/source-mapper.test.ts
git commit -m "feat: add source mapper orchestrator (detect + route + match)"
```

---

## Task 15: Fix Rules and Proposer

**Files:**
- Create: `src/fixer/fix-rules.ts`
- Create: `src/fixer/fix-proposer.ts`
- Create: `tests/fixer/fix-rules.test.ts`
- Create: `tests/fixer/fix-proposer.test.ts`

- [ ] **Step 1: Write failing tests for fix rules**

Create `tests/fixer/fix-rules.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getFixForIssue } from '../../src/fixer/fix-rules.js';

describe('getFixForIssue', () => {
  it('proposes alt="" for img missing alt', () => {
    const fix = getFixForIssue({
      code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
      type: 'error',
      message: 'Img element missing an alt attribute',
      selector: 'img',
      context: '<img src="/photo.jpg">',
    });
    expect(fix).not.toBeNull();
    expect(fix!.newText).toContain('alt=""');
  });

  it('proposes aria-label for input missing label', () => {
    const fix = getFixForIssue({
      code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H44.NonExistent',
      type: 'error',
      message: 'Input element does not have a label',
      selector: 'input',
      context: '<input type="text" name="email">',
    });
    expect(fix).not.toBeNull();
    expect(fix!.newText).toContain('aria-label');
  });

  it('proposes lang attribute for html missing lang', () => {
    const fix = getFixForIssue({
      code: 'WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2',
      type: 'error',
      message: 'The html element should have a lang attribute',
      selector: 'html',
      context: '<html>',
    });
    expect(fix).not.toBeNull();
    expect(fix!.newText).toContain('lang="en"');
  });

  it('returns null for unfixable issues', () => {
    const fix = getFixForIssue({
      code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1.H42',
      type: 'warning',
      message: 'Heading markup should be used',
      selector: 'p',
      context: '<p class="title">Big text</p>',
    });
    expect(fix).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/fixer/fix-rules.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/fixer/fix-rules.ts**

```typescript
import type { AccessibilityIssue } from '../types.js';

interface FixSuggestion {
  readonly description: string;
  readonly oldText: string;
  readonly newText: string;
}

type FixRule = (issue: AccessibilityIssue) => FixSuggestion | null;

const imgMissingAlt: FixRule = (issue) => {
  if (!issue.code.includes('H37') && !issue.message.toLowerCase().includes('alt')) return null;
  if (!issue.context.includes('<img')) return null;

  const oldText = issue.context;
  // Insert alt="" before the closing > or />
  const newText = oldText.replace(/<img(\s)/, '<img alt=""$1');

  if (newText === oldText) {
    // Try self-closing
    return {
      description: 'Add alt="" attribute to image (mark as decorative or add descriptive text)',
      oldText,
      newText: oldText.replace(/<img/, '<img alt=""'),
    };
  }

  return {
    description: 'Add alt="" attribute to image (mark as decorative or add descriptive text)',
    oldText,
    newText,
  };
};

const inputMissingLabel: FixRule = (issue) => {
  if (!issue.code.includes('H44') && !issue.message.toLowerCase().includes('label')) return null;
  if (!issue.context.includes('<input')) return null;

  // Extract name or type for a reasonable aria-label
  const nameMatch = issue.context.match(/name="([^"]*)"/);
  const label = nameMatch ? nameMatch[1] : 'input field';

  return {
    description: `Add aria-label="${label}" to input element`,
    oldText: issue.context,
    newText: issue.context.replace(/<input/, `<input aria-label="${label}"`),
  };
};

const htmlMissingLang: FixRule = (issue) => {
  if (!issue.code.includes('H57') && !issue.code.includes('3_1_1')) return null;
  if (!issue.context.includes('<html')) return null;

  return {
    description: 'Add lang="en" attribute to <html> element',
    oldText: issue.context,
    newText: issue.context.replace(/<html/, '<html lang="en"'),
  };
};

const FIX_RULES: readonly FixRule[] = [imgMissingAlt, inputMissingLabel, htmlMissingLang];

export function getFixForIssue(issue: AccessibilityIssue): FixSuggestion | null {
  for (const rule of FIX_RULES) {
    const fix = rule(issue);
    if (fix) return fix;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/fixer/fix-rules.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 5: Write failing tests for fix proposer**

Create `tests/fixer/fix-proposer.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { proposeFixesFromReport } from '../../src/fixer/fix-proposer.js';
import type { ScanReport } from '../../src/types.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('proposeFixesFromReport', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `pally-fix-test-${Date.now()}`);
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'next.config.js'), '');
    writeFileSync(join(repoDir, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));
    mkdirSync(join(repoDir, 'app', 'about'), { recursive: true });
    writeFileSync(
      join(repoDir, 'app', 'about', 'page.tsx'),
      '<div>\n  <img src="/photo.jpg">\n  <h1>About</h1>\n</div>',
    );
    mkdirSync(join(repoDir, 'app'), { recursive: true });
    writeFileSync(join(repoDir, 'app', 'page.tsx'), '<div><h1>Home</h1></div>');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('proposes fixes for img missing alt', async () => {
    const report: ScanReport = {
      summary: { url: 'https://example.com', pagesScanned: 1, pagesFailed: 0, totalIssues: 1, byLevel: { error: 1, warning: 0, notice: 0 } },
      pages: [
        {
          url: 'https://example.com/about',
          discoveryMethod: 'sitemap',
          issueCount: 1,
          issues: [
            {
              code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
              type: 'error',
              message: 'Img element missing an alt attribute',
              selector: 'img',
              context: '<img src="/photo.jpg">',
            },
          ],
        },
      ],
      errors: [],
      reportPath: '/tmp/report.json',
    };

    const result = await proposeFixesFromReport(report, repoDir, {});
    expect(result.fixable).toBeGreaterThanOrEqual(1);
    expect(result.fixes.length).toBeGreaterThanOrEqual(1);
    expect(result.fixes[0].newText).toContain('alt=""');
  });

  it('counts unfixable issues', async () => {
    const report: ScanReport = {
      summary: { url: 'https://example.com', pagesScanned: 1, pagesFailed: 0, totalIssues: 1, byLevel: { error: 0, warning: 1, notice: 0 } },
      pages: [
        {
          url: 'https://example.com/about',
          discoveryMethod: 'sitemap',
          issueCount: 1,
          issues: [
            {
              code: 'WCAG2AA.SomeUnknownRule',
              type: 'warning',
              message: 'Some unknown issue',
              selector: 'div',
              context: '<div>text</div>',
            },
          ],
        },
      ],
      errors: [],
      reportPath: '/tmp/report.json',
    };

    const result = await proposeFixesFromReport(report, repoDir, {});
    expect(result.unfixable).toBe(1);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
npx vitest run tests/fixer/fix-proposer.test.ts
```

Expected: FAIL

- [ ] **Step 7: Implement src/fixer/fix-proposer.ts**

```typescript
import { readFile } from 'node:fs/promises';
import type { ScanReport, FixProposal } from '../types.js';
import { mapIssuesToSource } from '../source-mapper/source-mapper.js';
import { getFixForIssue } from './fix-rules.js';
import { matchSelectorToSource } from '../source-mapper/element-matcher.js';

interface FixProposalResult {
  readonly fixable: number;
  readonly unfixable: number;
  readonly fixes: readonly FixProposal[];
}

export async function proposeFixesFromReport(
  report: ScanReport,
  repoPath: string,
  sourceMapOverrides: Readonly<Record<string, string>>,
): Promise<FixProposalResult> {
  // Map pages to source files
  const mappedPages = await mapIssuesToSource(report.pages, repoPath, sourceMapOverrides);

  const fixes: FixProposal[] = [];
  let unfixable = 0;

  for (const page of mappedPages) {
    for (const issue of page.issues) {
      const fixSuggestion = getFixForIssue(issue);

      if (!fixSuggestion) {
        unfixable++;
        continue;
      }

      if (!page.sourceMap?.file) {
        unfixable++;
        continue;
      }

      // Find line number for this specific issue
      let line = page.sourceMap.line ?? 0;
      try {
        const source = await readFile(page.sourceMap.file, 'utf-8');
        const match = matchSelectorToSource(issue.selector, source);
        if (match.line) {
          line = match.line;
        }
      } catch {
        // Use the page-level line number
      }

      fixes.push({
        file: page.sourceMap.file,
        line,
        issue: issue.code,
        description: fixSuggestion.description,
        oldText: fixSuggestion.oldText,
        newText: fixSuggestion.newText,
        confidence: page.sourceMap.confidence === 'high' ? 'high' : 'low',
      });
    }
  }

  return {
    fixable: fixes.length,
    unfixable,
    fixes,
  };
}
```

- [ ] **Step 8: Run all fixer tests**

```bash
npx vitest run tests/fixer/
```

Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/fixer/fix-rules.ts src/fixer/fix-proposer.ts tests/fixer/fix-rules.test.ts tests/fixer/fix-proposer.test.ts
git commit -m "feat: add fix rules and fix proposer for common a11y issues"
```

---

## Task 16: Fix Applier

**Files:**
- Create: `src/fixer/fix-applier.ts`
- Create: `tests/fixer/fix-applier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/fixer/fix-applier.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyFix } from '../../src/fixer/fix-applier.js';
import type { FixProposal } from '../../src/types.js';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('applyFix', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `pally-apply-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('applies a fix and returns a diff', async () => {
    const filePath = join(tempDir, 'page.tsx');
    writeFileSync(filePath, '<div>\n  <img src="/photo.jpg">\n</div>');

    const fix: FixProposal = {
      file: filePath,
      line: 2,
      issue: 'WCAG2AA.H37',
      description: 'Add alt=""',
      oldText: '<img src="/photo.jpg">',
      newText: '<img alt="" src="/photo.jpg">',
      confidence: 'high',
    };

    const result = await applyFix(fix);
    expect(result.applied).toBe(true);
    expect(result.diff).toContain('-');
    expect(result.diff).toContain('+');

    const updated = readFileSync(filePath, 'utf-8');
    expect(updated).toContain('alt=""');
  });

  it('returns applied=false when old text not found', async () => {
    const filePath = join(tempDir, 'page.tsx');
    writeFileSync(filePath, '<div><h1>No match</h1></div>');

    const fix: FixProposal = {
      file: filePath,
      line: 1,
      issue: 'WCAG2AA.H37',
      description: 'Add alt=""',
      oldText: '<img src="/photo.jpg">',
      newText: '<img alt="" src="/photo.jpg">',
      confidence: 'high',
    };

    const result = await applyFix(fix);
    expect(result.applied).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/fixer/fix-applier.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/fixer/fix-applier.ts**

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import type { FixProposal, FixResult } from '../types.js';

function createUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const diff: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      diff.push(`@@ -${i + 1} +${i + 1} @@`);
      if (i < oldLines.length && oldLines[i] !== undefined) {
        diff.push(`-${oldLines[i]}`);
      }
      if (i < newLines.length && newLines[i] !== undefined) {
        diff.push(`+${newLines[i]}`);
      }
    }
  }

  return diff.join('\n');
}

export async function applyFix(fix: FixProposal): Promise<FixResult> {
  try {
    const content = await readFile(fix.file, 'utf-8');

    if (!content.includes(fix.oldText)) {
      return {
        applied: false,
        file: fix.file,
        diff: '',
      };
    }

    // Replace only the first occurrence
    const newContent = content.replace(fix.oldText, fix.newText);
    const diff = createUnifiedDiff(fix.file, content, newContent);

    await writeFile(fix.file, newContent, 'utf-8');

    return {
      applied: true,
      file: fix.file,
      diff,
    };
  } catch (err) {
    return {
      applied: false,
      file: fix.file,
      diff: '',
    };
  }
}

export function generateDiffPreview(fix: FixProposal): string {
  return [
    `--- a/${fix.file}`,
    `+++ b/${fix.file}`,
    `@@ -${fix.line} +${fix.line} @@`,
    `-${fix.oldText}`,
    `+${fix.newText}`,
  ].join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/fixer/fix-applier.test.ts
```

Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/fixer/fix-applier.ts tests/fixer/fix-applier.test.ts
git commit -m "feat: add fix applier with diff generation"
```

---

## Task 17: CLI Entry Point

**Files:**
- Create: `src/cli.ts`
- Create: `tests/cli.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/cli.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CLI', () => {
  // These are integration-style tests that verify the CLI parses args correctly
  // We test the CLI's argument parsing by importing and testing the program

  it('exports a commander program', async () => {
    const { program } = await import('../src/cli.js');
    expect(program).toBeDefined();
    expect(program.name()).toBe('pally-agent');
  });

  it('has scan and fix commands', async () => {
    const { program } = await import('../src/cli.js');
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain('scan');
    expect(commands).toContain('fix');
  });

  it('scan command accepts expected options', async () => {
    const { program } = await import('../src/cli.js');
    const scan = program.commands.find((c) => c.name() === 'scan');
    expect(scan).toBeDefined();

    const optionNames = scan!.options.map((o) => o.long);
    expect(optionNames).toContain('--standard');
    expect(optionNames).toContain('--concurrency');
    expect(optionNames).toContain('--repo');
    expect(optionNames).toContain('--output');
    expect(optionNames).toContain('--format');
    expect(optionNames).toContain('--also-crawl');
    expect(optionNames).toContain('--config');
  });

  it('fix command requires --repo', async () => {
    const { program } = await import('../src/cli.js');
    const fix = program.commands.find((c) => c.name() === 'fix');
    expect(fix).toBeDefined();

    const optionNames = fix!.options.map((o) => o.long);
    expect(optionNames).toContain('--repo');
    expect(optionNames).toContain('--from-report');
  });
});

// Note: Interactive fix flow (AC#15) is tested by extracting the prompt loop
// into a testable function that accepts an injectable `ask` function.
// These tests should be added during implementation when the exact
// readline abstraction is finalized. The key scenarios to test:
// - 's' shows diff and re-prompts for the same file
// - 'n' skips the file and moves to the next
// - 'a' aborts all remaining files
// - 'y' applies all fixes in the file
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/cli.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/cli.ts**

```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig } from './config.js';
import { discoverUrls } from './discovery/discover.js';
import { WebserviceClient } from './scanner/webservice-client.js';
import { scanUrls } from './scanner/scanner.js';
import { generateJsonReport } from './reporter/json-reporter.js';
import { generateHtmlReport } from './reporter/html-reporter.js';
import { mapIssuesToSource } from './source-mapper/source-mapper.js';
import { proposeFixesFromReport } from './fixer/fix-proposer.js';
import { applyFix, generateDiffPreview } from './fixer/fix-applier.js';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { ScanReport, FixProposal } from './types.js';

export const program = new Command();

program
  .name('pally-agent')
  .description('Accessibility testing agent using pa11y webservice')
  .version('0.1.0');

program
  .command('scan')
  .description('Scan a website for accessibility issues')
  .argument('<url>', 'Website URL to scan')
  .option('--standard <level>', 'WCAG standard (WCAG2A, WCAG2AA, WCAG2AAA)')
  .option('--concurrency <n>', 'Max parallel scans', parseInt)
  .option('--repo <path>', 'Path to source code repository')
  .option('--output <dir>', 'Output directory for reports')
  .option('--format <formats>', 'Report formats (json,html)', 'json,html')
  .option('--also-crawl', 'Crawl in addition to sitemap')
  .option('--config <path>', 'Path to config file')
  .action(async (url: string, opts: Record<string, unknown>) => {
    try {
      const config = await loadConfig({
        configPath: opts.config as string | undefined,
        repoPath: opts.repo as string | undefined,
      });

      const mergedConfig = {
        ...config,
        ...(opts.standard ? { standard: opts.standard } : {}),
        ...(opts.concurrency ? { concurrency: opts.concurrency } : {}),
        ...(opts.output ? { outputDir: opts.output } : {}),
        ...(opts.alsoCrawl ? { alsoCrawl: true } : {}),
      };

      console.log(`Discovering pages on ${url}...`);
      const urls = await discoverUrls(url, {
        maxPages: mergedConfig.maxPages,
        crawlDepth: mergedConfig.crawlDepth,
        alsoCrawl: mergedConfig.alsoCrawl,
      });
      console.log(`Found ${urls.length} pages to scan.`);

      const client = new WebserviceClient(
        mergedConfig.webserviceUrl,
        mergedConfig.webserviceHeaders as Record<string, string>,
      );

      const scanResults = await scanUrls(urls, client, {
        standard: mergedConfig.standard,
        concurrency: mergedConfig.concurrency,
        timeout: mergedConfig.timeout,
        pollTimeout: mergedConfig.pollTimeout,
        ignore: [...mergedConfig.ignore],
        hideElements: mergedConfig.hideElements,
        headers: mergedConfig.headers as Record<string, string>,
        wait: mergedConfig.wait,
        onProgress: (p) => {
          console.log(`[${p.current}/${p.total}] ${p.type}: ${p.url}`);
        },
      });

      // Map to source if repo provided
      let pages = [...scanResults.pages];
      if (opts.repo) {
        pages = await mapIssuesToSource(
          pages,
          opts.repo as string,
          mergedConfig.sourceMap as Record<string, string>,
        );
      }

      const formats = (opts.format as string).split(',');
      const outputDir = mergedConfig.outputDir;

      if (formats.includes('json')) {
        const report = await generateJsonReport({
          siteUrl: url,
          pages,
          errors: scanResults.errors,
          outputDir,
        });
        console.log(`JSON report: ${report.reportPath}`);
      }

      if (formats.includes('html')) {
        const htmlPath = await generateHtmlReport({
          siteUrl: url,
          pages,
          errors: scanResults.errors,
          outputDir,
        });
        console.log(`HTML report: ${htmlPath}`);
      }

      // Summary
      const totalIssues = pages.reduce((sum, p) => sum + p.issueCount, 0);
      console.log(`\nScan complete: ${pages.length} pages, ${totalIssues} issues, ${scanResults.errors.length} failures`);

      // Exit codes (3 = fatal is only from the catch block)
      if (scanResults.errors.length > 0) {
        process.exit(2); // Partial or full page-level failure
      } else if (totalIssues > 0) {
        process.exit(1); // Issues found
      }
      process.exit(0);
    } catch (err) {
      console.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
      process.exit(3);
    }
  });

program
  .command('fix')
  .description('Propose and apply accessibility fixes')
  .argument('[url]', 'Website URL to scan (omit if using --from-report)')
  .option('--repo <path>', 'Path to source code repository (required)')
  .option('--from-report <path>', 'Use existing JSON report instead of scanning')
  .option('--config <path>', 'Path to config file')
  .option('--standard <level>', 'WCAG standard')
  .action(async (url: string | undefined, opts: Record<string, unknown>) => {
    try {
      if (!opts.repo) {
        console.error('Error: --repo is required for the fix command');
        process.exit(3);
      }

      const config = await loadConfig({
        configPath: opts.config as string | undefined,
        repoPath: opts.repo as string | undefined,
      });

      let report: ScanReport;

      if (opts.fromReport) {
        // Load from existing report
        const content = await readFile(opts.fromReport as string, 'utf-8');
        report = JSON.parse(content) as ScanReport;
      } else {
        if (!url) {
          console.error('Error: URL is required when not using --from-report');
          process.exit(3);
        }

        // Scan first
        console.log(`Scanning ${url}...`);
        const urls = await discoverUrls(url, {
          maxPages: config.maxPages,
          crawlDepth: config.crawlDepth,
          alsoCrawl: config.alsoCrawl,
        });

        const client = new WebserviceClient(config.webserviceUrl, config.webserviceHeaders as Record<string, string>);
        const scanResults = await scanUrls(urls, client, {
          standard: config.standard,
          concurrency: config.concurrency,
          timeout: config.timeout,
          pollTimeout: config.pollTimeout,
          ignore: [...config.ignore],
          hideElements: config.hideElements,
          headers: config.headers as Record<string, string>,
          wait: config.wait,
          onProgress: (p) => {
            console.log(`[${p.current}/${p.total}] ${p.type}: ${p.url}`);
          },
        });

        report = {
          summary: {
            url,
            pagesScanned: scanResults.pages.length,
            pagesFailed: scanResults.errors.length,
            totalIssues: scanResults.pages.reduce((s, p) => s + p.issueCount, 0),
            byLevel: { error: 0, warning: 0, notice: 0 },
          },
          pages: [...scanResults.pages],
          errors: [...scanResults.errors],
          reportPath: '',
        };
      }

      // Propose fixes
      const proposals = await proposeFixesFromReport(
        report,
        opts.repo as string,
        config.sourceMap as Record<string, string>,
      );

      console.log(`\nFound ${proposals.fixable} auto-fixable issues, ${proposals.unfixable} unfixable.`);

      if (proposals.fixes.length === 0) {
        console.log('No fixes to apply.');
        return;
      }

      // Group fixes by file
      const byFile = new Map<string, FixProposal[]>();
      for (const fix of proposals.fixes) {
        const existing = byFile.get(fix.file) ?? [];
        byFile.set(fix.file, [...existing, fix]);
      }

      // Interactive prompt
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> =>
        new Promise((resolve) => rl.question(q, resolve));

      for (const [file, fixes] of byFile) {
        const prompt = `Apply ${fixes.length} fix(es) to ${file}? [y]es / [n]o / [s]how diff / [a]bort all: `;
        let answer = await ask(prompt);

        while (answer.toLowerCase() === 's') {
          for (const fix of fixes) {
            console.log(generateDiffPreview(fix));
            console.log('---');
          }
          answer = await ask(prompt);
        }

        if (answer.toLowerCase() === 'a') {
          console.log('Aborted.');
          rl.close();
          return;
        }

        if (answer.toLowerCase() === 'y') {
          for (const fix of fixes) {
            const result = await applyFix(fix);
            if (result.applied) {
              console.log(`  Applied: ${fix.description}`);
            } else {
              console.log(`  Skipped (not found): ${fix.description}`);
            }
          }
        } else {
          console.log(`  Skipped ${file}`);
        }
      }

      rl.close();
    } catch (err) {
      console.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
      process.exit(3);
    }
  });

// Only run if this is the main module
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  program.parse();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/cli.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: add CLI with scan and fix commands"
```

---

## Task 18: MCP Server

**Files:**
- Create: `src/mcp.ts`
- Create: `tests/mcp.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/mcp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('MCP Server', () => {
  it('exports createServer function', async () => {
    const { createServer } = await import('../src/mcp.js');
    expect(typeof createServer).toBe('function');
  });

  it('creates a server with expected tool names', async () => {
    const { createServer } = await import('../src/mcp.js');
    const server = createServer();
    expect(server).toBeDefined();
    // The server object should be an MCP Server instance
    // We verify tool registration through the server's internal state
    expect(server.toolNames).toContain('pally_scan');
    expect(server.toolNames).toContain('pally_get_issues');
    expect(server.toolNames).toContain('pally_propose_fixes');
    expect(server.toolNames).toContain('pally_apply_fix');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/mcp.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement src/mcp.ts**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { discoverUrls } from './discovery/discover.js';
import { WebserviceClient } from './scanner/webservice-client.js';
import { scanUrls } from './scanner/scanner.js';
import { generateJsonReport } from './reporter/json-reporter.js';
import { proposeFixesFromReport } from './fixer/fix-proposer.js';
import { applyFix } from './fixer/fix-applier.js';
import { readFile } from 'node:fs/promises';
import type { ScanReport, PageResult } from './types.js';

export function createServer(): McpServer & { toolNames: string[] } {
  const server = new McpServer({
    name: 'pally-agent',
    version: '0.1.0',
  });

  const toolNames: string[] = [];

  // pally_scan
  toolNames.push('pally_scan');
  server.tool(
    'pally_scan',
    'Scan a website for accessibility issues',
    {
      url: z.string().describe('Website URL to scan'),
      standard: z.enum(['WCAG2A', 'WCAG2AA', 'WCAG2AAA']).optional().describe('WCAG standard (default: WCAG2AA)'),
      concurrency: z.number().optional().describe('Max parallel scans (default: 5)'),
      maxPages: z.number().optional().describe('Max pages to scan (default: 100)'),
      alsoCrawl: z.boolean().optional().describe('Crawl in addition to sitemap (default: false)'),
      ignore: z.array(z.string()).optional().describe('Rule codes to ignore'),
      headers: z.record(z.string()).optional().describe('HTTP headers for target site'),
      wait: z.number().optional().describe('Wait time for SPAs in ms (default: 0)'),
    },
    async (params, extra) => {
      const config = await loadConfig();

      const mergedConfig = {
        ...config,
        ...(params.standard ? { standard: params.standard } : {}),
        ...(params.concurrency ? { concurrency: params.concurrency } : {}),
        ...(params.maxPages ? { maxPages: params.maxPages } : {}),
        ...(params.alsoCrawl !== undefined ? { alsoCrawl: params.alsoCrawl } : {}),
      };

      const urls = await discoverUrls(params.url, {
        maxPages: mergedConfig.maxPages,
        crawlDepth: mergedConfig.crawlDepth,
        alsoCrawl: mergedConfig.alsoCrawl,
      });

      const client = new WebserviceClient(
        mergedConfig.webserviceUrl,
        mergedConfig.webserviceHeaders as Record<string, string>,
      );

      // Wire progress notifications if progressToken is provided
      const progressToken = extra?.sendNotification ? (extra as any)?._meta?.progressToken : undefined;
      const onProgress = progressToken && extra?.sendNotification
        ? (p: import('./types.js').ScanProgress) => {
            extra.sendNotification?.({
              method: 'notifications/progress',
              params: { progressToken, progress: p.current, total: p.total },
            });
          }
        : undefined;

      const results = await scanUrls(urls, client, {
        standard: mergedConfig.standard,
        concurrency: mergedConfig.concurrency,
        timeout: mergedConfig.timeout,
        pollTimeout: mergedConfig.pollTimeout,
        ignore: params.ignore ?? [...mergedConfig.ignore],
        hideElements: mergedConfig.hideElements,
        headers: params.headers ?? (mergedConfig.headers as Record<string, string>),
        wait: params.wait ?? mergedConfig.wait,
        onProgress,
      });

      const report = await generateJsonReport({
        siteUrl: params.url,
        pages: [...results.pages],
        errors: results.errors,
        outputDir: mergedConfig.outputDir,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }],
      };
    },
  );

  // pally_get_issues
  toolNames.push('pally_get_issues');
  server.tool(
    'pally_get_issues',
    'Get issues filtered by URL pattern, severity, or rule code',
    {
      reportPath: z.string().describe('Path to a JSON report'),
      urlPattern: z.string().optional().describe('Glob pattern to filter URLs'),
      severity: z.enum(['error', 'warning', 'notice']).optional().describe('Filter by severity'),
      ruleCode: z.string().optional().describe('Filter by WCAG rule code'),
    },
    async (params) => {
      const content = await readFile(params.reportPath, 'utf-8');
      const report = JSON.parse(content) as ScanReport;

      let filtered: PageResult[] = [...report.pages];

      if (params.urlPattern) {
        const pattern = params.urlPattern.replace(/\*/g, '.*');
        const regex = new RegExp(pattern);
        filtered = filtered.filter((p) => regex.test(p.url));
      }

      if (params.severity) {
        filtered = filtered.map((p) => ({
          ...p,
          issues: p.issues.filter((i) => i.type === params.severity),
          issueCount: p.issues.filter((i) => i.type === params.severity).length,
        })).filter((p) => p.issueCount > 0);
      }

      if (params.ruleCode) {
        filtered = filtered.map((p) => ({
          ...p,
          issues: p.issues.filter((i) => i.code.includes(params.ruleCode!)),
          issueCount: p.issues.filter((i) => i.code.includes(params.ruleCode!)).length,
        })).filter((p) => p.issueCount > 0);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }],
      };
    },
  );

  // pally_propose_fixes
  toolNames.push('pally_propose_fixes');
  server.tool(
    'pally_propose_fixes',
    'Generate code fix proposals for issues in a repo',
    {
      reportPath: z.string().describe('Path to a JSON report'),
      repoPath: z.string().describe('Path to source code repo'),
    },
    async (params) => {
      const content = await readFile(params.reportPath, 'utf-8');
      const report = JSON.parse(content) as ScanReport;
      const config = await loadConfig({ repoPath: params.repoPath });

      const proposals = await proposeFixesFromReport(
        report,
        params.repoPath,
        config.sourceMap as Record<string, string>,
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(proposals, null, 2) }],
      };
    },
  );

  // pally_apply_fix
  toolNames.push('pally_apply_fix');
  server.tool(
    'pally_apply_fix',
    'Apply a specific proposed fix to a source file',
    {
      file: z.string().describe('Absolute file path'),
      line: z.number().describe('Line number'),
      oldText: z.string().describe('Text to replace'),
      newText: z.string().describe('Replacement text'),
    },
    async (params) => {
      const result = await applyFix({
        file: params.file,
        line: params.line,
        issue: '',
        description: '',
        oldText: params.oldText,
        newText: params.newText,
        confidence: 'high',
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return Object.assign(server, { toolNames });
}

// Main entry point
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/mcp.test.ts
```

Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp.ts tests/mcp.test.ts
git commit -m "feat: add MCP server with pally_scan, pally_get_issues, pally_propose_fixes, pally_apply_fix"
```

---

## Task 19: Full Build and Coverage Verification

**Files:** None new — verification only

- [ ] **Step 1: Run full build**

```bash
npx tsc
```

Expected: No errors

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 3: Check coverage**

```bash
npx vitest run --coverage
```

Expected: 80%+ across statements, branches, functions, lines

- [ ] **Step 4: Fix any coverage gaps**

If coverage is below 80%, identify untested paths and add tests. Common gaps:
- Error paths in scanner
- Edge cases in config loading
- CLI argument validation

- [ ] **Step 5: Commit any coverage fixes**

```bash
git add -A
git commit -m "test: close coverage gaps to meet 80% threshold"
```

---

## Task 20: Final Integration Verification

**Files:** None new — verification only

- [ ] **Step 1: Verify CLI help output**

```bash
npx tsx src/cli.ts --help
npx tsx src/cli.ts scan --help
npx tsx src/cli.ts fix --help
```

Expected: Help text with all documented options

- [ ] **Step 2: Verify TypeScript strict mode compliance**

```bash
npx tsc --noEmit --strict
```

Expected: No errors

- [ ] **Step 3: Final commit with build artifacts excluded**

Verify `.gitignore`:

```bash
echo "node_modules/\ndist/\n*.tgz\n.pally-reports/" > .gitignore
git add .gitignore
git commit -m "chore: add .gitignore"
```

- [ ] **Step 4: Verify all acceptance criteria are covered**

Cross-reference the 20 acceptance criteria in the spec against the test files. Each should map to at least one test. Document any gaps.

---

## Dependency Graph

Tasks can be parallelized as follows:

```
Task 1 (scaffolding)
  ├── Task 2 (config) ─────────────────────────────┐
  ├── Task 3 (robots) ──┐                          │
  ├── Task 4 (sitemap) ──├── Task 6 (discover) ────┤
  ├── Task 5 (crawler) ──┘                          │
  ├── Task 7 (webservice client) ── Task 8 (scanner)│
  ├── Task 11 (framework detector) ─┐               │
  ├── Task 12 (routing strategies) ──├── Task 14 ───┤
  └── Task 13 (element matcher) ─────┘  (source     │
                                        mapper)     │
                                          │         │
  Task 9 (json reporter) ─────────────────┤         │
  Task 10 (html reporter) ────────────────┤         │
                                          │         │
  Task 15 (fix rules + proposer) ─── Task 16 ──────┤
                                     (fix applier)  │
                                                    │
  Task 17 (CLI) ────────────────────────────────────┤
  Task 18 (MCP) ────────────────────────────────────┤
                                                    │
  Task 19 (build + coverage) ───────────────────────┤
  Task 20 (final verification) ─────────────────────┘
```

**Wave 1** (parallel after Task 1): Tasks 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 15
**Wave 2** (depends on Wave 1): Tasks 6, 8, 14, 16
**Wave 3** (depends on Wave 2): Tasks 17, 18
**Wave 4** (depends on Wave 3): Tasks 19, 20
