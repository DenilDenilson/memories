import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'denil-e2e-'));
const salt = 'e2e-test-only';
const hash = `scrypt:${salt}:${scryptSync('e2e-admin-password', salt, 64).toString('hex')}`;
const server = spawn(
  process.execPath,
  [
    process.env.E2E_TARGET === 'vercel'
      ? 'scripts/e2e-vercel-server.mjs'
      : 'dist/server/entry.mjs',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATA_DIR: dir,
      TURSO_DATABASE_URL: pathToFileURL(join(dir, 'e2e.sqlite')).href,
      TURSO_AUTH_TOKEN: '',
      ADMIN_PASSWORD_HASH: hash,
      ADMIN_PASSWORD:
        process.env.E2E_TARGET === 'vercel' ? 'e2e-admin-password' : '',
      S3_BUCKET: '',
      COOKIE_SECURE: 'false',
      APP_ORIGIN: 'http://localhost:4322',
      HOST: '0.0.0.0',
      PORT: '4322',
    },
  },
);
function stop() {
  server.kill('SIGTERM');
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => {
  rmSync(dir, { recursive: true, force: true });
  process.exit(code || 0);
});
