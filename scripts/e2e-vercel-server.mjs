import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { startS3Server } from '../tests/helpers/s3-server.mjs';

const s3 = await startS3Server();
Object.assign(process.env, {
  VERCEL: '1',
  S3_ENDPOINT: s3.endpoint,
  S3_BUCKET: 'denil-tests',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'test-access-only',
  S3_SECRET_ACCESS_KEY: 'test-secret-only',
});
const { default: handler } =
  await import('../.vercel/output/functions/_render.func/dist/server/entry.mjs');
const root = resolve('.vercel/output/static');
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/_astro/') || path === '/favicon.svg') {
    const file = resolve(root, `.${path}`);
    if (!file.startsWith(`${root}/`)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(file);
      res.setHeader(
        'Content-Type',
        {
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
        }[extname(file)] || 'application/octet-stream',
      );
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }
  req.headers['x-forwarded-for'] = '127.0.0.1';
  if (Number(req.headers['content-length']) > 4.5 * 1024 * 1024) {
    res.writeHead(413);
    res.end('Límite del cuerpo de Vercel: usa subida directa');
    return;
  }
  try {
    await handler(req, res);
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end('Error del artefacto serverless');
  }
});
server.listen(Number(process.env.PORT), process.env.HOST);
process.on('SIGTERM', () => {
  server.close();
  s3.server.close();
  process.exit(0);
});
