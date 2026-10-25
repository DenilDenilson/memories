import sharp from 'sharp';
import convert from 'heic-convert';
import { randomUUID } from 'node:crypto';
import { putFile, deleteFile } from './storage';
import { photoFilename, photoKeys } from './filenames';

export async function processPhoto(
  file: File,
  memoryId: string,
  date: string,
  title: string,
  id: string = randomUUID(),
) {
  if (file.size === 0 || file.size > 30 * 1024 * 1024)
    throw new Error('Cada foto debe pesar entre 1 byte y 30 MB.');
  const original = Buffer.from(await file.arrayBuffer());
  const brands = original.subarray(8, 40).toString();
  const isHeic =
    original.subarray(4, 8).toString() === 'ftyp' &&
    !/avif|avis/.test(brands) &&
    /heic|heix|hevc|hevx|mif1/.test(brands);
  let input = original;
  if (isHeic)
    input = Buffer.from(
      await convert({ buffer: original, format: 'JPEG', quality: 0.95 }),
    );
  const image = sharp(input, { limitInputPixels: 80_000_000, animated: false });
  const metadata = await image.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    !['jpeg', 'png', 'webp', 'heif', 'avif'].includes(metadata.format || '')
  ) {
    throw new Error('Formato no compatible. Usa JPEG, PNG, WebP, AVIF o HEIC.');
  }
  const extension = isHeic
    ? 'heic'
    : metadata.format === 'heif'
      ? 'avif'
      : metadata.format === 'jpeg'
        ? 'jpg'
        : metadata.format!;
  const filename = photoFilename(date, title, id, extension);
  const keys = photoKeys(date, filename);
  // Sharp elimina EXIF (incluido GPS). Los originales se guardan sin modificar.
  const preview = await image
    .clone()
    .rotate()
    .resize({
      width: 1800,
      height: 1800,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
  const thumb = await image
    .clone()
    .rotate()
    .resize(360, 360, { fit: 'cover' })
    .jpeg({ quality: 78 })
    .toBuffer();
  const mime = isHeic
    ? 'image/heic'
    : `image/${metadata.format === 'heif' ? 'avif' : metadata.format}`;
  const written: string[] = [];
  try {
    await putFile(keys.originalKey, original, mime);
    written.push(keys.originalKey);
    await putFile(keys.previewKey, preview, 'image/jpeg');
    written.push(keys.previewKey);
    await putFile(keys.thumbKey, thumb, 'image/jpeg');
    written.push(keys.thumbKey);
  } catch (error) {
    await Promise.all(
      written.map((key) => deleteFile(key).catch(console.error)),
    );
    throw error;
  }
  return {
    id,
    memoryId,
    filename,
    ...keys,
    mime,
    size: file.size,
    width: metadata.width,
    height: metadata.height,
  };
}
