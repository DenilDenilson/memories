import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createDatabaseClient() {
  let url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    if (process.env.VERCEL)
      throw new Error('Configura TURSO_DATABASE_URL en Vercel.');
    const directory = resolve(process.env.DATA_DIR || './data');
    mkdirSync(directory, { recursive: true });
    url = pathToFileURL(resolve(directory, 'denil-memories.sqlite')).href;
  }
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
}

/** @param {import('@libsql/client').Client} client */
export async function migrateDatabase(client) {
  // Nunca usar PRAGMA user_version ni nombres genéricos en una base compartida.
  await client.execute(
    'CREATE TABLE IF NOT EXISTS denil_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const current = await client.execute(
    'SELECT MAX(version) AS version FROM denil_migrations',
  );
  if (Number(current.rows[0]?.version || 0) >= 1) return;
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS denil_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, code_hash TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS denil_memories (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', public INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS denil_memories_date ON denil_memories(date)`,
      `CREATE TABLE IF NOT EXISTS denil_audiences (memory_id TEXT NOT NULL REFERENCES denil_memories(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES denil_groups(id) ON DELETE CASCADE, PRIMARY KEY(memory_id, group_id))`,
      `CREATE TABLE IF NOT EXISTS denil_photos (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES denil_memories(id) ON DELETE CASCADE,
      filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
      original_key TEXT NOT NULL, preview_key TEXT NOT NULL, thumb_key TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS denil_photos_memory ON denil_photos(memory_id)`,
      `CREATE TABLE IF NOT EXISTS denil_sessions (hash TEXT PRIMARY KEY, role TEXT NOT NULL,
      group_id TEXT REFERENCES denil_groups(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '')`,
      `CREATE TABLE IF NOT EXISTS denil_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS denil_uploads (id TEXT PRIMARY KEY, upload_key TEXT NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL,
      size INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', payload TEXT, expires_at INTEGER NOT NULL)`,
      {
        sql: 'INSERT OR IGNORE INTO denil_migrations(version, applied_at) VALUES (1, ?)',
        args: [new Date().toISOString()],
      },
    ],
    'write',
  );
}
