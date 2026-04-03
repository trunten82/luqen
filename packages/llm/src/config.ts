import { readFileSync } from 'node:fs';
import type { LLMConfig } from './types.js';

export const DEFAULT_CONFIG: Readonly<LLMConfig> = Object.freeze({
  port: 4200,
  host: '0.0.0.0',
  dbPath: './llm.db',
  jwtKeyPair: Object.freeze({
    publicKeyPath: './keys/public.pem',
    privateKeyPath: './keys/private.pem',
  }),
  tokenExpiry: '1h',
  rateLimit: Object.freeze({ read: 100, write: 20, windowMs: 60000 }),
  cors: Object.freeze({
    origin: ['http://localhost:5000'] as readonly string[],
    credentials: true,
  }),
});

function readConfigFile(path: string): Partial<LLMConfig> {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Partial<LLMConfig>;
  } catch {
    return {};
  }
}

function applyEnvOverrides(config: LLMConfig): LLMConfig {
  const env = process.env;
  return {
    ...config,
    port: env.LLM_PORT ? parseInt(env.LLM_PORT, 10) : config.port,
    host: env.LLM_HOST ?? config.host,
    dbPath: env.LLM_DB_PATH ?? config.dbPath,
    jwtKeyPair: {
      privateKeyPath: env.LLM_JWT_PRIVATE_KEY ?? config.jwtKeyPair.privateKeyPath,
      publicKeyPath: env.LLM_JWT_PUBLIC_KEY ?? config.jwtKeyPair.publicKeyPath,
    },
    cors: env.LLM_CORS_ORIGIN
      ? { ...config.cors, origin: env.LLM_CORS_ORIGIN.split(',').map((s) => s.trim()) }
      : config.cors,
  };
}

export function loadConfig(configPath: string = 'llm.config.json'): LLMConfig {
  const fileConfig = readConfigFile(configPath);
  const merged: LLMConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    rateLimit: { ...DEFAULT_CONFIG.rateLimit, ...(fileConfig.rateLimit ?? {}) },
    cors: { ...DEFAULT_CONFIG.cors, ...(fileConfig.cors ?? {}) },
    jwtKeyPair: { ...DEFAULT_CONFIG.jwtKeyPair, ...(fileConfig.jwtKeyPair ?? {}) },
  };
  return applyEnvOverrides(merged);
}
