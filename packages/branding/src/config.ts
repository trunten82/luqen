import { readFileSync } from 'node:fs';

export interface BrandingConfig {
  readonly port: number;
  readonly host: string;
  readonly dbPath: string;
  readonly jwtKeyPair: {
    readonly publicKeyPath: string;
    readonly privateKeyPath: string;
  };
  readonly tokenExpiry: string;
  readonly rateLimit: {
    readonly read: number;
    readonly write: number;
    readonly windowMs: number;
  };
  readonly cors: {
    readonly origin: readonly string[];
    readonly credentials?: boolean;
  };
}

export const DEFAULT_CONFIG: Readonly<BrandingConfig> = Object.freeze({
  port: 4100,
  host: '0.0.0.0',
  dbPath: './branding.db',
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

function readConfigFile(path: string): Partial<BrandingConfig> {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Partial<BrandingConfig>;
  } catch {
    return {};
  }
}

function applyEnvOverrides(config: BrandingConfig): BrandingConfig {
  const env = process.env;

  return {
    ...config,
    port: env.BRANDING_PORT
      ? parseInt(env.BRANDING_PORT, 10)
      : config.port,
    dbPath: env.BRANDING_DB_PATH ?? config.dbPath,
    host: env.BRANDING_HOST ?? config.host,
    jwtKeyPair: {
      privateKeyPath: env.BRANDING_JWT_PRIVATE_KEY
        ?? config.jwtKeyPair.privateKeyPath,
      publicKeyPath: env.BRANDING_JWT_PUBLIC_KEY
        ?? config.jwtKeyPair.publicKeyPath,
    },
    cors: env.BRANDING_CORS_ORIGIN
      ? {
          ...config.cors,
          origin: env.BRANDING_CORS_ORIGIN.split(',').map(s => s.trim()),
        }
      : config.cors,
  };
}

export function loadConfig(
  configPath: string = 'branding.config.json',
): BrandingConfig {
  const fileConfig = readConfigFile(configPath);
  const merged: BrandingConfig = {
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
