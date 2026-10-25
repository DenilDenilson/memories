import sharp from 'sharp';
import convert from 'heic-convert';
import { randomUUID } from 'node:crypto';
import { putFile, deletePhotoFiles } from './storage';

export async function processPhoto(file: File, memoryId: string) {
  if (file.size === 0 || file.size > 30 * 1024 * 1024)
    throw new Error('Cada foto debe pesar entre 1 byte y 30 MB.');
  const original = Buffer.from(await file.arrayBuffer());
  const isHeic =
    original.subarray(4, 8).toString() === 'ftyp' &&
    /heic|heix|hevc|hevx|mif1/.test(original.subarray(8, 40).toString());
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
  const id = randomUUID();
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
  try {
    await putFile(`${id}/original`, original, mime);
    await putFile(`${id}/preview`, preview, 'image/jpeg');
    await putFile(`${id}/thumb`, thumb, 'image/jpeg');
  } catch (error) {
    await deletePhotoFiles(id).catch(console.error);
    throw error;
  }
  return {
    id,
    memoryId,
    filename: file.name.replace(/[\r\n]/g, '').slice(0, 200),
    mime,
    size: file.size,
    width: metadata.width,
    height: metadata.height,
  };
}
