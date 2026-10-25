import { randomUUID } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db } from './db';
import { uploads } from './schema';
import { processPhoto } from './images';
import {
  deleteFile,
  deletePhotoFiles,
  getFile,
  presignUpload,
  verifyUploadSize,
} from './storage';

export type ProcessedPhoto = Awaited<ReturnType<typeof processPhoto>>;
export async function createUpload(date: string, title: string, size: number) {
  await cleanupUploads();
  const id = randomUUID();
  const uploadKey = `denil-memories/staging/${id}`;
  const uploadUrl =
    (await presignUpload(uploadKey, size)) || `/api/v1/uploads/${id}/file`;
  await db
    .insert(uploads)
    .values({
      id,
      uploadKey,
      date,
      title,
      size,
      expiresAt: Date.now() + 3600000,
    })
    .run();
  return {
    id,
    uploadUrl,
    headers: {
      'Content-Type': 'application/octet-stream',
      'If-None-Match': '*',
    },
  };
}
export async function completeUpload(id: string) {
  const upload = await db
    .select()
    .from(uploads)
    .where(eq(uploads.id, id))
    .get();
  if (!upload || upload.expiresAt < Date.now() || upload.state === 'used')
    throw new Error(
      'La autorización de subida ha caducado. Vuelve a seleccionar la foto.',
    );
  if (upload.state === 'ready')
    return JSON.parse(upload.payload!) as ProcessedPhoto;
  const claim = await db
    .update(uploads)
    .set({ state: 'processing' })
    .where(and(eq(uploads.id, id), eq(uploads.state, 'pending')))
    .returning();
  if (!claim.length)
    throw new Error('Esta foto ya se está procesando. Espera un momento.');
  let photo: ProcessedPhoto | undefined;
  try {
    await verifyUploadSize(upload.uploadKey, upload.size);
    const bytes = await getFile(upload.uploadKey);
    photo = await processPhoto(
      new File([new Uint8Array(bytes)], 'upload', {
        type: 'application/octet-stream',
      }),
      '',
      upload.date,
      upload.title,
      id,
    );
    await db
      .update(uploads)
      .set({
        state: 'ready',
        payload: JSON.stringify(photo),
        expiresAt: Date.now() + 86400000,
      })
      .where(eq(uploads.id, id))
      .run();
    await deleteFile(upload.uploadKey).catch(console.error);
    return photo;
  } catch (error) {
    if (photo) await deletePhotoFiles(photo).catch(console.error);
    await db
      .update(uploads)
      .set({ state: 'pending' })
      .where(eq(uploads.id, id))
      .run();
    throw error;
  }
}
export async function cleanupUploads() {
  const expired = await db
    .select()
    .from(uploads)
    .where(lt(uploads.expiresAt, Date.now()))
    .limit(10)
    .all();
  for (const upload of expired) {
    if (upload.state === 'used') {
      await db
        .delete(uploads)
        .where(and(eq(uploads.id, upload.id), eq(uploads.state, 'used')))
        .run();
      continue;
    }
    // Reclamar antes de borrar evita competir con la publicación de un recuerdo.
    const claimed = await db
      .update(uploads)
      .set({ state: 'deleting' })
      .where(
        and(
          eq(uploads.id, upload.id),
          eq(uploads.state, upload.state),
          lt(uploads.expiresAt, Date.now()),
        ),
      )
      .returning();
    if (!claimed.length) continue;
    if (upload.payload)
      await deletePhotoFiles(JSON.parse(upload.payload) as ProcessedPhoto);
    await deleteFile(upload.uploadKey);
    await db
      .delete(uploads)
      .where(and(eq(uploads.id, upload.id), eq(uploads.state, 'deleting')))
      .run();
  }
  return expired.length;
}
