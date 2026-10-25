import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';
import { resolve } from 'node:path';
import {
  createDatabaseClient,
  migrateDatabase,
} from '../../scripts/database.mjs';
import * as schema from './schema';

export const dataDir = resolve(process.env.DATA_DIR || './data');
export const client = createDatabaseClient();
export const db = drizzle(client, { schema });
let initialization: Promise<void> | undefined;
export function ensureDatabase() {
  initialization ??= migrateDatabase(client).catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}
