import { readFileSync } from 'node:fs';
import type { ComplianceConfig } from './types.js';

export const DEFAULT_CONFIG: Readonly<ComplianceConfig> = Object.freeze({
  port: 4000,
  host: '0.0.0.0',
  dbPath: './compliance.db',
  jwtKeyPair: Object.freeze({
    publicKeyPath: './keys/public.pem',
    privateKeyPath: './keys/private.pem',
  }),
  tokenExpiry: '1h',
  rateLimit: Object.freeze({ read: 100, write: 20, windowMs: 60000 }),
  cors: Object.freeze({
    origin: ['http://localhost:3000'] as readonly string[],
    credentials: true,
  }),
});

function readConfigFile(path: string): Partial<ComplianceConfig> {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Partial<ComplianceConfig>;
  } catch {
    return {};
  }
}

function applyEnvOverrides(config: ComplianceConfig): ComplianceConfig {
  const env = process.env;

  return {
    ...config,
    port: env.COMPLIANCE_PORT
      ? parseInt(env.COMPLIANCE_PORT, 10)
      : config.port,
    dbPath: env.COMPLIANCE_DB_PATH ?? config.dbPath,
    redisUrl: env.COMPLIANCE_REDIS_URL ?? config.redisUrl,
    host: env.COMPLIANCE_HOST ?? config.host,
    jwtKeyPair: {
      privateKeyPath: env.COMPLIANCE_JWT_PRIVATE_KEY
        ?? config.jwtKeyPair.privateKeyPath,
      publicKeyPath: env.COMPLIANCE_JWT_PUBLIC_KEY
        ?? config.jwtKeyPair.publicKeyPath,
    },
    cors: env.COMPLIANCE_CORS_ORIGIN
      ? {
          ...config.cors,
          origin: env.COMPLIANCE_CORS_ORIGIN.split(',').map(s => s.trim()),
        }
      : config.cors,
  };
}

export function loadConfig(
  configPath: string = 'compliance.config.json',
): ComplianceConfig {
  const fileConfig = readConfigFile(configPath);
  const merged: ComplianceConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    rateLimit: {
      ...DEFAULT_CONFIG.rateLimit,
      ...(fileConfig.rateLimit ?? {}),
    },
    cors: { ...DEFAULT_CONFIG.cors, ...(fileConfig.cors ?? {}) },
    jwtKeyPair: {
      ...DEFAULT_CONFIG.jwtKeyPair,
      ...(fileConfig.jwtKeyPair ?? {}),
    },
  };
  return applyEnvOverrides(merged);
}
