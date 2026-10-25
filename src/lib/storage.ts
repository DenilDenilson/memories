import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { dataDir } from './db';

const bucket = process.env.S3_BUCKET;
const s3 = bucket
  ? new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
    })
  : undefined;
function localPath(key: string) {
  if (!/^[a-f0-9-]+\/(original|preview|thumb)$/.test(key))
    throw new Error('Clave de archivo inválida');
  return resolve(dataDir, 'photos', key);
}
export async function putFile(key: string, body: Buffer, mime: string) {
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: mime,
      }),
    );
  } else {
    const path = localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
}
export async function getFile(key: string): Promise<Buffer> {
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
  if (s3) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  else
    await unlink(localPath(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
}
export async function deletePhotoFiles(id: string) {
  await Promise.all(
    ['original', 'preview', 'thumb'].map((variant) =>
      deleteFile(`${id}/${variant}`),
    ),
  );
}
