import { afterAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { db, client, ensureDatabase } from '../src/lib/db';
import { uploads } from '../src/lib/schema';
import { startS3Server } from './helpers/s3-server.mjs';

const { server, objects, endpoint } = await startS3Server();
process.env.S3_ENDPOINT = endpoint;
process.env.S3_BUCKET = 'denil-tests';
process.env.S3_ACCESS_KEY_ID = 'test-access-only';
process.env.S3_SECRET_ACCESS_KEY = 'test-secret-only';
const storage = await import('../src/lib/storage');
const service = await import('../src/lib/uploads');
await ensureDatabase();
afterAll(async () => {
  client.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it('sube directamente a S3, procesa y firma una descarga de 60 segundos', async () => {
  const bytes = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#758b62' },
  })
    .png()
    .toBuffer();
  const ticket = await service.createUpload(
    '2026-10-25',
    'Personal',
    bytes.length,
  );
  const uploadUrl = new URL(ticket.uploadUrl);
  expect(uploadUrl.origin).toBe(process.env.S3_ENDPOINT);
  expect(uploadUrl.searchParams.get('X-Amz-Expires')).toBe('600');
  expect(uploadUrl.searchParams.has('X-Amz-Signature')).toBe(true);
  expect(
    (
      await fetch(ticket.uploadUrl, {
        method: 'PUT',
        headers: ticket.headers,
        body: new Uint8Array(bytes),
      })
    ).status,
  ).toBe(200);
  const photo = await service.completeUpload(ticket.id);
  expect(objects.size).toBe(3);
  expect(photo.originalKey).toMatch(
    /^denil-memories\/2026\/10\/20261025-personal-[a-f0-9]{12}\.png$/,
  );
  const url = (await storage.presignDownload(
    photo.originalKey,
    photo.filename,
  ))!;
  expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('60');
  const downloaded = await fetch(url);
  expect(downloaded.headers.get('content-disposition')).toBe(
    `attachment; filename="${photo.filename}"`,
  );
  expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
  await db
    .update(uploads)
    .set({ expiresAt: 0 })
    .where(eq(uploads.id, ticket.id))
    .run();
  expect(await service.cleanupUploads()).toBe(1);
  expect(objects.size).toBe(0);
});

it('rechaza una subida cuyo tamaño real no coincide con el autorizado', async () => {
  const ticket = await service.createUpload('2026-10-25', 'Personal', 100);
  await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.headers,
    body: new Uint8Array([1, 2, 3]),
  });
  await expect(service.completeUpload(ticket.id)).rejects.toThrow('tamaño');
  const row = await db
    .select()
    .from(uploads)
    .where(eq(uploads.id, ticket.id))
    .get();
  expect(row?.state).toBe('pending');
});
