import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { LuqenConfig } from './types.js';

const CONFIG_FILENAME = '.luqen.json';
const VALID_STANDARDS = new Set(['WCAG2A', 'WCAG2AA', 'WCAG2AAA']);

export const DEFAULT_CONFIG: LuqenConfig = {
  webserviceUrl: 'http://localhost:3000',
  webserviceUrls: [],
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
  outputDir: './luqen-reports',
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

function validate(config: LuqenConfig): void {
  if (!VALID_STANDARDS.has(config.standard)) {
    throw new Error(`Invalid standard "${config.standard}". Must be one of: ${[...VALID_STANDARDS].join(', ')}`);
  }
  if (config.concurrency < 1) throw new Error('concurrency must be >= 1');
  if (config.timeout < 1) throw new Error('timeout must be >= 1');
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LuqenConfig> {
  const cwd = options.cwd ?? process.cwd();
  const configPath =
    options.configPath ??
    process.env.LUQEN_CONFIG ??
    findConfigFile(cwd) ??
    (options.repoPath ? findConfigFile(options.repoPath) : undefined);

  let fileConfig: Record<string, unknown> = {};
  if (configPath && existsSync(configPath)) {
    fileConfig = await readJsonFile(configPath);
  }

  const merged: LuqenConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    webserviceHeaders: {
      ...DEFAULT_CONFIG.webserviceHeaders,
      ...(fileConfig.webserviceHeaders as Record<string, string> | undefined),
    },
  } as LuqenConfig;

  const envUrl = process.env.LUQEN_WEBSERVICE_URL;
  const envAuth = process.env.LUQEN_WEBSERVICE_AUTH;
  const envComplianceUrl = process.env.LUQEN_COMPLIANCE_URL;
  const envRunner = process.env.LUQEN_RUNNER;

  const withEnv: LuqenConfig = {
    ...merged,
    ...(envUrl ? { webserviceUrl: envUrl } : {}),
    ...(envAuth ? { webserviceHeaders: { ...merged.webserviceHeaders, Authorization: envAuth } } : {}),
    ...(envComplianceUrl ? { complianceUrl: envComplianceUrl } : {}),
    ...(envRunner !== undefined && (envRunner === 'htmlcs' || envRunner === 'axe')
      ? { runner: envRunner as 'htmlcs' | 'axe' }
      : {}),
  };

  validate(withEnv);
  return withEnv;
}
