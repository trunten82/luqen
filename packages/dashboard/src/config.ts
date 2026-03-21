import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export interface DashboardConfig {
  readonly port: number;
  readonly complianceUrl: string;
  readonly webserviceUrl: string;
  readonly reportsDir: string;
  readonly dbPath: string;
  readonly sessionSecret: string;
  readonly maxConcurrentScans: number;
  readonly complianceClientId: string;
  readonly complianceClientSecret: string;
  readonly pluginsDir: string;
  readonly pluginsConfigFile?: string;
  /** Optional Redis URL — enables scan queue and SSE pub/sub when set. */
  readonly redisUrl?: string;
  /** Maximum pages to scan in full-site mode. Default: 50. */
  readonly maxPages: number;
}

const DEFAULTS: DashboardConfig = {
  port: 5000,
  complianceUrl: 'http://localhost:4000',
  webserviceUrl: 'http://localhost:3000',
  reportsDir: './reports',
  dbPath: './dashboard.db',
  sessionSecret: '',
  maxConcurrentScans: 2,
  complianceClientId: '',
  complianceClientSecret: '',
  pluginsDir: './plugins',
  maxPages: 50,
};

function loadConfigFile(configPath: string): Partial<DashboardConfig> {
  if (!existsSync(configPath)) {
    return {};
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Partial<DashboardConfig>;
  } catch (err) {
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
    pluginsDir: process.env['DASHBOARD_PLUGINS_DIR'] ?? config.pluginsDir,
    pluginsConfigFile: process.env['DASHBOARD_PLUGINS_CONFIG'] ?? config.pluginsConfigFile,
    redisUrl: process.env['DASHBOARD_REDIS_URL'] ?? config.redisUrl,
    maxPages: process.env['DASHBOARD_MAX_PAGES'] !== undefined
      ? parseInt(process.env['DASHBOARD_MAX_PAGES'], 10)
      : config.maxPages,
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
  const fileConfig = loadConfigFile(resolve(configPath));
  const merged: DashboardConfig = { ...DEFAULTS, ...fileConfig };
  return applyEnvOverrides(merged);
}
