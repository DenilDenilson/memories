import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';

/** Servidor S3 mínimo para pruebas aisladas; no valida firmas criptográficas. */
export async function startS3Server() {
  const objects = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', 'http://localhost:4322');
    response.setHeader('Access-Control-Allow-Methods', 'PUT,GET,HEAD,OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type,Content-Length,If-None-Match',
    );
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    const url = new URL(request.url, 'http://localhost');
    const key = decodeURIComponent(url.pathname);
    if (request.method === 'PUT') {
      if (request.headers['if-none-match'] === '*' && objects.has(key)) {
        response.writeHead(412);
        response.end();
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      objects.set(key, { body, type: String(request.headers['content-type']) });
      response.setHeader(
        'ETag',
        `"${createHash('md5').update(body).digest('hex')}"`,
      );
      response.end();
      return;
    }
    if (request.method === 'DELETE') {
      objects.delete(key);
      response.writeHead(204);
      response.end();
      return;
    }
    const object = objects.get(key);
    if (!object) {
      response.writeHead(404, { 'Content-Type': 'application/xml' });
      response.end('<Error><Code>NoSuchKey</Code></Error>');
      return;
    }
    response.setHeader('Content-Length', object.body.length);
    response.setHeader('Content-Type', object.type);
    if (url.searchParams.has('response-content-disposition'))
      response.setHeader(
        'Content-Disposition',
        url.searchParams.get('response-content-disposition'),
      );
    if (request.method === 'HEAD') response.end();
    else response.end(object.body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    objects,
    endpoint: `http://127.0.0.1:${typeof address === 'object' ? address.port : 0}`,
  };
}
