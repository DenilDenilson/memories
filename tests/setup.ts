import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'denil-tests-'));
process.env.DATA_DIR = directory;
delete process.env.S3_BUCKET;
afterAll(() => rmSync(directory, { recursive: true, force: true }));
