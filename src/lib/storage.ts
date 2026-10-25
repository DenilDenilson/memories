import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { dataDir } from './db';

const bucket = process.env.S3_BUCKET;
export const usesS3 = Boolean(bucket);
if (process.env.VERCEL && !bucket)
  throw new Error('Configura un bucket R2 privado antes de desplegar.');
const s3 = bucket
  ? new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || undefined,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
    })
  : undefined;
function validateKey(key: string) {
  if (!/^denil-memories\/[a-zA-Z0-9/._-]+$/.test(key) || key.includes('..'))
    throw new Error('Clave de archivo inválida');
}
function localPath(key: string) {
  validateKey(key);
  return resolve(dataDir, 'photos', key);
}
export async function putFile(key: string, body: Buffer, mime: string) {
  validateKey(key);
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: mime,
        IfNoneMatch: '*',
      }),
    );
  } else {
    const path = localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { flag: 'wx' });
  }
}
export async function getFile(key: string): Promise<Buffer> {
  validateKey(key);
  if (s3) {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!result.Body) throw new Error('Archivo no disponible');
    return Buffer.from(await result.Body.transformToByteArray());
  }
  return readFile(localPath(key));
}
export async function deleteFile(key: string) {
  validateKey(key);
  if (s3) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  else
    await unlink(localPath(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
}
export async function deletePhotoFiles(photo: {
  originalKey: string;
  previewKey: string;
  thumbKey: string;
}) {
  await Promise.all(
    [photo.originalKey, photo.previewKey, photo.thumbKey].map(deleteFile),
  );
}
export async function presignUpload(key: string, size: number) {
  validateKey(key);
  if (!s3) return null;
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: 'application/octet-stream',
      ContentLength: size,
      IfNoneMatch: '*',
    }),
    { expiresIn: 600 },
  );
}
export async function verifyUploadSize(key: string, expected: number) {
  validateKey(key);
  if (s3) {
    const result = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (result.ContentLength !== expected)
      throw new Error(
        'El tamaño de la foto no coincide con la subida autorizada.',
      );
  } else if ((await readFile(localPath(key))).length !== expected)
    throw new Error('El tamaño de la foto no coincide.');
}
export async function presignDownload(key: string, filename?: string) {
  validateKey(key);
  if (!s3) return null;
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseCacheControl: 'private, no-store',
      ...(filename
        ? { ResponseContentDisposition: `attachment; filename="${filename}"` }
        : {}),
    }),
    { expiresIn: 60 },
  );
}
