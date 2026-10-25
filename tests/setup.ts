import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'denil-tests-'));
process.env.DATA_DIR = directory;
process.env.TURSO_DATABASE_URL = pathToFileURL(
  join(directory, 'test.sqlite'),
).href;
process.env.TURSO_AUTH_TOKEN = '';
process.env.S3_BUCKET = '';
process.env.S3_ENDPOINT = '';
afterAll(() => rmSync(directory, { recursive: true, force: true }));
