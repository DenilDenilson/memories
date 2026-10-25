import 'dotenv/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as schema from './schema';

export const dataDir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dataDir, { recursive: true });
export const sqlite = new Database(resolve(dataDir, 'memories.sqlite'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

// Migración inicial versionada. Añadir nuevas versiones sin modificar las aplicadas.
const migrations = [
  `CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, code_hash TEXT NOT NULL);
  CREATE TABLE memories (id TEXT PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', public INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL);
  CREATE INDEX memories_date ON memories(date);
  CREATE TABLE audiences (memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE, PRIMARY KEY(memory_id, group_id));
  CREATE TABLE photos (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL);
  CREATE INDEX photos_memory ON photos(memory_id);
  CREATE TABLE sessions (hash TEXT PRIMARY KEY, role TEXT NOT NULL, group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '');
  CREATE TABLE attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);`,
];
const version = sqlite.pragma('user_version', { simple: true }) as number;
for (let i = version; i < migrations.length; i++) {
  sqlite.transaction(() => {
    sqlite.exec(migrations[i]);
    sqlite.pragma(`user_version = ${i + 1}`);
  })();
}
export const db = drizzle(sqlite, { schema });
