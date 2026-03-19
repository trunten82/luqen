import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
    if (existsSync(candidate)) return candidate;
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
    throw new Error(`Invalid standard "${config.standard}". Must be one of: ${[...VALID_STANDARDS].join(', ')}`);
  }
  if (config.concurrency < 1) throw new Error('concurrency must be >= 1');
  if (config.timeout < 1) throw new Error('timeout must be >= 1');
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<PallyConfig> {
  const cwd = options.cwd ?? process.cwd();
  const configPath =
    options.configPath ??
    process.env.PALLY_AGENT_CONFIG ??
    findConfigFile(cwd) ??
    (options.repoPath ? findConfigFile(options.repoPath) : undefined);

  let fileConfig: Record<string, unknown> = {};
  if (configPath && existsSync(configPath)) {
    fileConfig = await readJsonFile(configPath);
  }

  const merged: PallyConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    webserviceHeaders: {
      ...DEFAULT_CONFIG.webserviceHeaders,
      ...(fileConfig.webserviceHeaders as Record<string, string> | undefined),
    },
  } as PallyConfig;

  const envUrl = process.env.PALLY_WEBSERVICE_URL;
  const envAuth = process.env.PALLY_WEBSERVICE_AUTH;

  const withEnv: PallyConfig = {
    ...merged,
    ...(envUrl ? { webserviceUrl: envUrl } : {}),
    ...(envAuth ? { webserviceHeaders: { ...merged.webserviceHeaders, Authorization: envAuth } } : {}),
  };

  validate(withEnv);
  return withEnv;
}
