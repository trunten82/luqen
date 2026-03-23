import pg from 'pg';

// ---------------------------------------------------------------------------
// Connection configuration
// ---------------------------------------------------------------------------

export interface PostgresConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  readonly ssl: boolean;
  readonly poolSize: number;
}

// ---------------------------------------------------------------------------
// Pool creation
// ---------------------------------------------------------------------------

export function createPool(options: PostgresConnectionOptions): pg.Pool {
  return new pg.Pool({
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.username,
    password: options.password,
    ssl: options.ssl ? { rejectUnauthorized: false } : false,
    max: options.poolSize,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
