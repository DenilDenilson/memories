export function photoFilename(
  date: string,
  title: string,
  id: string,
  extension: string,
) {
  const slug =
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 45)
      .replace(/-$/, '') || 'personal';
  const suffix = id.replace(/-/g, '').slice(0, 12);
  return `${date.replace(/-/g, '')}-${slug}-${suffix}.${extension}`;
}
export function photoKeys(date: string, filename: string) {
  const base = `denil-memories/${date.slice(0, 4)}/${date.slice(5, 7)}`;
  const name = filename.replace(/\.[^.]+$/, '');
  return {
    originalKey: `${base}/${filename}`,
    previewKey: `${base}/previews/${name}.jpg`,
    thumbKey: `${base}/thumbs/${name}.jpg`,
  };
}
