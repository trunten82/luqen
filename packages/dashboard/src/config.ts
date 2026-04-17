import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';

const ConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(5000),
  complianceUrl: z.string().url().default('http://localhost:4000'),
  webserviceUrl: z.string().url().optional(),
  reportsDir: z.string().default('./reports'),
  dbPath: z.string().default('./dashboard.db'),
  sessionSecret: z.string().min(32),
  maxConcurrentScans: z.number().int().min(1).default(2),
  complianceClientId: z.string().default(''),
  complianceClientSecret: z.string().default(''),
  brandingUrl: z.string().url().default('http://localhost:4100'),
  brandingClientId: z.string().default(''),
  brandingClientSecret: z.string().default(''),
  llmUrl: z.string().url().optional(),
  llmClientId: z.string().default(''),
  llmClientSecret: z.string().default(''),
  pluginsDir: z.string().default('./plugins'),
  pluginsConfigFile: z.string().optional(),
  catalogueUrl: z.string().url().optional(),
  catalogueCacheTtl: z.number().int().min(0).default(3600),
  redisUrl: z.string().url().optional(),
  maxPages: z.number().int().min(1).max(1000).default(50),
  runner: z.enum(['htmlcs', 'axe']).optional(),
  webserviceUrls: z.array(z.string().url()).optional(),
  jwtPublicKey: z.string().optional(),
}).strict();

export interface DashboardConfig {
  readonly port: number;
  readonly complianceUrl: string;
  /** When set, uses pa11y webservice HTTP API. When omitted, uses direct pa11y library. */
  readonly webserviceUrl?: string;
  readonly reportsDir: string;
  readonly dbPath: string;
  readonly sessionSecret: string;
  readonly maxConcurrentScans: number;
  readonly complianceClientId: string;
  readonly complianceClientSecret: string;
  readonly brandingUrl: string;
  readonly brandingClientId: string;
  readonly brandingClientSecret: string;
  /** URL to the @luqen/llm service. Enables LLM management admin page when set. */
  readonly llmUrl?: string;
  readonly llmClientId: string;
  readonly llmClientSecret: string;
  readonly pluginsDir: string;
  readonly pluginsConfigFile?: string;
  /** URL to fetch the remote plugin catalogue. Defaults to GitHub raw URL. */
  readonly catalogueUrl?: string;
  /** Cache TTL for the remote catalogue in seconds. Default: 3600 (1 hour). */
  readonly catalogueCacheTtl: number;
  /** Optional Redis URL — enables scan queue and SSE pub/sub when set. */
  readonly redisUrl?: string;
  /** Maximum pages to scan in full-site mode. Default: 50. */
  readonly maxPages: number;
  /** Pa11y test runner: 'htmlcs' (default) or 'axe'. Requires the runner installed on the webservice. */
  readonly runner?: 'htmlcs' | 'axe';
  /** Additional pa11y webservice URLs for horizontal scaling (comma-separated via env). */
  readonly webserviceUrls?: readonly string[];
  /**
   * PEM-encoded RS256 public key. Required when MCP endpoint is enabled
   * (Phase 28+). Loaded from DASHBOARD_JWT_PUBLIC_KEY env var; literal
   * "\n" sequences are converted to real newlines for single-line env form.
   */
  readonly jwtPublicKey?: string;
}

const DEFAULTS: DashboardConfig = {
  port: 5000,
  complianceUrl: 'http://localhost:4000',
  reportsDir: './reports',
  dbPath: './dashboard.db',
  sessionSecret: '',
  maxConcurrentScans: 2,
  complianceClientId: '',
  complianceClientSecret: '',
  brandingUrl: 'http://localhost:4100',
  brandingClientId: '',
  brandingClientSecret: '',
  llmClientId: '',
  llmClientSecret: '',
  pluginsDir: './plugins',
  catalogueCacheTtl: 3600,
  maxPages: 50,
};

function loadConfigFile(configPath: string): Partial<DashboardConfig> {
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Validate known fields — strip unknown fields silently for forward compat
    const result = ConfigSchema.partial().safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Invalid config:\n${issues}`);
    }
    return result.data as Partial<DashboardConfig>;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid config')) throw err;
    throw new Error(`Failed to parse config file at ${configPath}: ${String(err)}`);
  }
}

function applyEnvOverrides(config: DashboardConfig): DashboardConfig {
  return {
    port: process.env['DASHBOARD_PORT'] !== undefined
      ? parseInt(process.env['DASHBOARD_PORT'], 10)
      : config.port,
    complianceUrl: process.env['DASHBOARD_COMPLIANCE_URL'] ?? config.complianceUrl,
    webserviceUrl: process.env['DASHBOARD_WEBSERVICE_URL'] ?? config.webserviceUrl,
    reportsDir: process.env['DASHBOARD_REPORTS_DIR'] ?? config.reportsDir,
    dbPath: process.env['DASHBOARD_DB_PATH'] ?? config.dbPath,
    sessionSecret: process.env['DASHBOARD_SESSION_SECRET'] ?? config.sessionSecret,
    maxConcurrentScans: process.env['DASHBOARD_MAX_CONCURRENT_SCANS'] !== undefined
      ? parseInt(process.env['DASHBOARD_MAX_CONCURRENT_SCANS'], 10)
      : config.maxConcurrentScans,
    complianceClientId: process.env['DASHBOARD_COMPLIANCE_CLIENT_ID'] ?? config.complianceClientId,
    complianceClientSecret: process.env['DASHBOARD_COMPLIANCE_CLIENT_SECRET'] ?? config.complianceClientSecret,
    brandingUrl: process.env['DASHBOARD_BRANDING_URL'] ?? config.brandingUrl,
    brandingClientId: process.env['DASHBOARD_BRANDING_CLIENT_ID'] ?? config.brandingClientId,
    brandingClientSecret: process.env['DASHBOARD_BRANDING_CLIENT_SECRET'] ?? config.brandingClientSecret,
    llmUrl: process.env['DASHBOARD_LLM_URL'] ?? config.llmUrl,
    llmClientId: process.env['DASHBOARD_LLM_CLIENT_ID'] ?? config.llmClientId,
    llmClientSecret: process.env['DASHBOARD_LLM_CLIENT_SECRET'] ?? config.llmClientSecret,
    pluginsDir: process.env['DASHBOARD_PLUGINS_DIR'] ?? config.pluginsDir,
    pluginsConfigFile: process.env['DASHBOARD_PLUGINS_CONFIG'] ?? config.pluginsConfigFile,
    catalogueUrl: process.env['DASHBOARD_CATALOGUE_URL'] ?? config.catalogueUrl,
    catalogueCacheTtl: process.env['DASHBOARD_CATALOGUE_CACHE_TTL'] !== undefined
      ? parseInt(process.env['DASHBOARD_CATALOGUE_CACHE_TTL'], 10)
      : config.catalogueCacheTtl,
    redisUrl: process.env['DASHBOARD_REDIS_URL'] ?? config.redisUrl,
    maxPages: process.env['DASHBOARD_MAX_PAGES'] !== undefined
      ? parseInt(process.env['DASHBOARD_MAX_PAGES'], 10)
      : config.maxPages,
    ...(process.env['DASHBOARD_SCANNER_RUNNER'] !== undefined &&
        (process.env['DASHBOARD_SCANNER_RUNNER'] === 'htmlcs' || process.env['DASHBOARD_SCANNER_RUNNER'] === 'axe')
      ? { runner: process.env['DASHBOARD_SCANNER_RUNNER'] as 'htmlcs' | 'axe' }
      : config.runner !== undefined ? { runner: config.runner } : {}),
    webserviceUrls: process.env['DASHBOARD_WEBSERVICE_URLS'] !== undefined
      ? process.env['DASHBOARD_WEBSERVICE_URLS'].split(',').map((u) => u.trim()).filter(Boolean)
      : config.webserviceUrls,
    jwtPublicKey: process.env['DASHBOARD_JWT_PUBLIC_KEY'] !== undefined
      ? process.env['DASHBOARD_JWT_PUBLIC_KEY'].replace(/\\n/g, '\n')
      : config.jwtPublicKey,
  };
}

export function validateConfig(config: DashboardConfig): void {
  if (config.sessionSecret.length < 32) {
    throw new Error('sessionSecret must be at least 32 bytes. Set DASHBOARD_SESSION_SECRET environment variable.');
  }

  if (isNaN(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid port: ${config.port}. Must be between 1 and 65535.`);
  }

  if (isNaN(config.maxConcurrentScans) || config.maxConcurrentScans < 1) {
    throw new Error(`Invalid maxConcurrentScans: ${config.maxConcurrentScans}. Must be at least 1.`);
  }

  if (isNaN(config.maxPages) || config.maxPages < 1 || config.maxPages > 1000) {
    throw new Error(`Invalid maxPages: ${config.maxPages}. Must be between 1 and 1000.`);
  }

  try {
    new URL(config.complianceUrl);
  } catch {
    throw new Error(`Invalid complianceUrl: "${config.complianceUrl}". Must be a valid URL.`);
  }

  // Ensure reportsDir exists and is writable
  const resolvedReportsDir = resolve(config.reportsDir);
  if (!existsSync(resolvedReportsDir)) {
    try {
      mkdirSync(resolvedReportsDir, { recursive: true });
    } catch (err) {
      throw new Error(`Cannot create reportsDir at ${resolvedReportsDir}: ${String(err)}`);
    }
  }

  // Ensure pluginsDir exists
  const resolvedPluginsDir = resolve(config.pluginsDir);
  if (!existsSync(resolvedPluginsDir)) {
    try {
      mkdirSync(resolvedPluginsDir, { recursive: true });
    } catch (err) {
      throw new Error(`Cannot create pluginsDir at ${resolvedPluginsDir}: ${String(err)}`);
    }
  }

  // Ensure dbPath parent directory exists
  const dbParentDir = dirname(resolve(config.dbPath));
  if (!existsSync(dbParentDir)) {
    throw new Error(`dbPath parent directory does not exist: ${dbParentDir}`);
  }
}

export function loadConfig(configPath = 'dashboard.config.json'): DashboardConfig {
  const resolvedConfigPath = resolve(configPath);
  const configDir = dirname(resolvedConfigPath);
  const fileConfig = loadConfigFile(resolvedConfigPath);
  const merged: DashboardConfig = { ...DEFAULTS, ...fileConfig };
  const withEnv = applyEnvOverrides(merged);

  // Resolve dbPath, reportsDir, and pluginsDir to absolute paths relative to
  // the config file's directory.  This guarantees every process (systemd
  // service, CLI invocation, nohup background) opens the same DB file even
  // when their working directories differ.
  return {
    ...withEnv,
    dbPath: resolve(configDir, withEnv.dbPath),
    reportsDir: resolve(configDir, withEnv.reportsDir),
    pluginsDir: resolve(configDir, withEnv.pluginsDir),
  };
}
