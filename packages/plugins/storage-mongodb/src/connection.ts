import { MongoClient, type Db } from 'mongodb';

export interface MongoConnectionOptions {
  readonly connectionUri: string;
  readonly database: string;
  readonly authSource?: string;
  readonly replicaSet?: string;
  readonly tls?: boolean;
}

export interface MongoConnection {
  readonly client: MongoClient;
  readonly db: Db;
}

export async function createMongoConnection(
  options: MongoConnectionOptions,
): Promise<MongoConnection> {
  const client = new MongoClient(options.connectionUri, {
    ...(options.authSource ? { authSource: options.authSource } : {}),
    ...(options.replicaSet ? { replicaSet: options.replicaSet } : {}),
    ...(options.tls !== undefined ? { tls: options.tls } : {}),
  });

  await client.connect();
  const db = client.db(options.database);

  return { client, db };
}
