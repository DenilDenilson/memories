import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { db, client, ensureDatabase } from '../src/lib/db';
import {
  groups,
  memories,
  audiences,
  photos,
  sessions,
  uploads,
} from '../src/lib/schema';
import {
  hashSecret,
  verifySecret,
  issueSession,
  resolveAccess,
  authenticate,
  adminConfigured,
  allowAttempt,
} from '../src/lib/auth';
import { getMemory, listMemories } from '../src/lib/memories';
import { processPhoto } from '../src/lib/images';
import { getFile, putFile, deletePhotoFiles } from '../src/lib/storage';
import {
  createUpload,
  completeUpload,
  cleanupUploads,
} from '../src/lib/uploads';
import { photoFilename } from '../src/lib/filenames';

await client.execute(
  'CREATE TABLE "syt-sessions" (id TEXT PRIMARY KEY, value TEXT)',
);
await client.execute(
  "INSERT INTO \"syt-sessions\" VALUES ('existing', 'preserve-me')",
);
await client.execute('PRAGMA user_version = 77');
await ensureDatabase();
afterAll(() => client.close());
afterEach(() => vi.unstubAllEnvs());
const friend = randomUUID();
const family = randomUUID();
const code = 'friends-code-123';
await db
  .insert(groups)
  .values([
    { id: friend, name: 'Amigos', codeHash: hashSecret(code) },
    { id: family, name: 'Familia', codeHash: hashSecret('family-code-123') },
  ])
  .run();
const ids = {
  public: randomUUID(),
  friend: randomUUID(),
  family: randomUUID(),
  private: randomUUID(),
  both: randomUUID(),
};
for (const [name, id] of Object.entries(ids)) {
  await db
    .insert(memories)
    .values({
      id,
      title: name,
      date: '2026-10-05',
      public: name === 'public',
      createdAt: new Date().toISOString(),
    })
    .run();
}
await db
  .insert(audiences)
  .values([
    { memoryId: ids.friend, groupId: friend },
    { memoryId: ids.family, groupId: family },
    { memoryId: ids.both, groupId: friend },
    { memoryId: ids.both, groupId: family },
  ])
  .run();

describe('base compartida y permisos', () => {
  it('preserva tablas ajenas y su versión global de SQLite', async () => {
    expect(
      (await client.execute('SELECT value FROM "syt-sessions"')).rows[0].value,
    ).toBe('preserve-me');
    expect(
      (await client.execute('PRAGMA user_version')).rows[0].user_version,
    ).toBe(77);
    expect(
      (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'denil_%'",
        )
      ).rows.map((r) => r.name),
    ).toEqual(['syt-sessions']);
  });
  it('el público solo ve lo público incluso con un identificador conocido', async () => {
    expect(
      (await listMemories({ role: 'public' }, '2026-10-01', '2026-10-31')).map(
        (m) => m.id,
      ),
    ).toEqual([ids.public]);
    expect(await getMemory(ids.private, { role: 'public' })).toBeNull();
    expect(await getMemory(ids.friend, { role: 'public' })).toBeNull();
  });
  it('los grupos son independientes, combinables y también ven lo público', async () => {
    const results = await listMemories(
      { role: 'group', groupId: friend },
      '2026-10-01',
      '2026-10-31',
    );
    expect(new Set(results.map((m) => m.id))).toEqual(
      new Set([ids.public, ids.friend, ids.both]),
    );
    expect(
      await getMemory(ids.friend, { role: 'group', groupId: family }),
    ).toBeNull();
    expect(results.every((m) => m.groupIds === undefined)).toBe(true);
  });
  it('el administrador ve todo y el filtro por fecha se aplica', async () => {
    expect(
      await listMemories({ role: 'admin' }, '2026-10-01', '2026-10-31'),
    ).toHaveLength(5);
    expect(
      await listMemories({ role: 'admin' }, '2026-11-01', '2026-11-30'),
    ).toHaveLength(0);
  });
});
describe('códigos y sesiones', () => {
  it('acepta la contraseña directa exacta aunque quede un hash antiguo mal configurado', async () => {
    vi.stubEnv('ADMIN_PASSWORD', 'a-private-test.password-123');
    vi.stubEnv('ADMIN_PASSWORD_HASH', 'not-a-hash');
    expect(adminConfigured()).toBe(true);
    expect(await authenticate('a-private-test.password-123', 'admin')).toEqual({
      role: 'admin',
    });
    expect(await authenticate('wrong', 'admin')).toBeNull();
    expect(
      await authenticate('a-private-test.password-123 ', 'admin'),
    ).toBeNull();
  });
  it('mantiene el acceso con hash cuando no hay contraseña directa', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    vi.stubEnv('ADMIN_PASSWORD_HASH', hashSecret('hashed-test-password'));
    expect(adminConfigured()).toBe(true);
    expect(await authenticate('hashed-test-password', 'admin')).toEqual({
      role: 'admin',
    });
    expect(await authenticate('wrong', 'admin')).toBeNull();
  });
  it('detecta una contraseña escrita por error en la variable de hash', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    vi.stubEnv('ADMIN_PASSWORD_HASH', 'not-a-hash');
    expect(adminConfigured()).toBe(false);
    expect(await authenticate('not-a-hash', 'admin')).toBeNull();
  });
  it('almacena hashes con sal y rechaza valores incorrectos o hashes inválidos', () => {
    const hash = hashSecret('a-password');
    expect(hash).not.toContain('a-password');
    expect(hashSecret('a-password')).not.toBe(hash);
    expect(verifySecret('a-password', hash)).toBe(true);
    expect(verifySecret('incorrect', hash)).toBe(false);
    expect(verifySecret('a-password', 'scrypt:bad:nope')).toBe(false);
  });
  it('autentica el grupo y separa tokens API de cookies de sesión', async () => {
    expect(await authenticate(code, 'group')).toMatchObject({
      role: 'group',
      groupId: friend,
    });
    expect(await authenticate('wrong', 'group')).toBeNull();
    const token = await issueSession({ role: 'admin' }, 'token', 'test');
    expect(await resolveAccess(token)).toEqual({ role: 'public' });
    expect(await resolveAccess(token, 'token')).toEqual({ role: 'admin' });
  });
  it('invalida sesiones al revocarlas y rechaza sesiones caducadas', async () => {
    const token = await issueSession({ role: 'group', groupId: friend });
    expect((await resolveAccess(token)).role).toBe('group');
    await db
      .update(sessions)
      .set({ expiresAt: 0 })
      .where(eq(sessions.groupId, friend))
      .run();
    expect((await resolveAccess(token)).role).toBe('public');
    const next = await issueSession({ role: 'group', groupId: friend });
    await db.delete(sessions).where(eq(sessions.groupId, friend)).run();
    expect((await resolveAccess(next)).role).toBe('public');
  });
  it('limita intentos persistentes de acceso de forma atómica', async () => {
    for (let i = 0; i < 10; i++)
      expect(await allowAttempt('test-ip')).toBe(true);
    expect(await allowAttempt('test-ip')).toBe(false);
    expect(await allowAttempt('another-ip')).toBe(true);
  });
});
describe('nombres, imágenes y almacenamiento privado', () => {
  it('usa nombres ordenables por fecha y slugs seguros, sin depender del nombre original', () => {
    expect(
      photoFilename(
        '2026-10-25',
        'Día personal / París',
        'abc12345-6789-0000-0000-000000000000',
        'png',
      ),
    ).toBe('20261025-dia-personal-paris-abc123456789.png');
    expect(photoFilename('2026-10-26', '💚', 'abc123456789', 'jpg')).toBe(
      '20261026-personal-abc123456789.jpg',
    );
  });
  it('convierte HEIC real y mantiene el archivo original intacto', async () => {
    const bytes = await readFile(
      new URL('./fixtures/sample.heic', import.meta.url),
    );
    const photo = await processPhoto(
      new File([new Uint8Array(bytes)], 'iphone.HEIC'),
      ids.private,
      '2026-10-25',
      'Personal',
    );
    expect(photo.mime).toBe('image/heic');
    expect(photo.filename).toMatch(/^20261025-personal-[a-f0-9]{12}\.heic$/);
    expect(await getFile(photo.originalKey)).toEqual(bytes);
    const metadata = await sharp(await getFile(photo.previewKey)).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(64);
    await deletePhotoFiles(photo);
  });
  it('crea variantes sin EXIF y oculta la descarga al visitante', async () => {
    const original = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#78916a' },
    })
      .jpeg()
      .withMetadata()
      .toBuffer();
    const photo = await processPhoto(
      new File([new Uint8Array(original)], 'original.jpg'),
      ids.public,
      '2026-10-05',
      'Public',
    );
    await db.insert(photos).values(photo).run();
    expect(await getFile(photo.originalKey)).toEqual(original);
    expect(
      (await sharp(await getFile(photo.previewKey)).metadata()).exif,
    ).toBeUndefined();
    expect((await sharp(await getFile(photo.thumbKey)).metadata()).width).toBe(
      360,
    );
    expect(
      (await getMemory(ids.public, { role: 'public' }))!.photos[0],
    ).not.toHaveProperty('originalUrl');
    expect(
      (await getMemory(ids.public, { role: 'admin' }))!.photos[0].originalUrl,
    ).toContain('/original');
    await deletePhotoFiles(photo);
    await expect(getFile(photo.originalKey)).rejects.toThrow();
  });
  it('rechaza archivos falsos, vacíos y claves fuera del espacio de esta aplicación', async () => {
    await expect(
      processPhoto(
        new File(['not an image'], 'fake.jpg'),
        ids.public,
        '2026-10-05',
        'test',
      ),
    ).rejects.toThrow();
    await expect(
      processPhoto(new File([], 'empty.jpg'), ids.public, '2026-10-05', 'test'),
    ).rejects.toThrow();
    await expect(getFile('other-app/photo.jpg')).rejects.toThrow('Clave');
    await expect(getFile('denil-memories/../../secret')).rejects.toThrow(
      'Clave',
    );
  });
});
it('no confunde AVIF con HEIC y no sobrescribe fotos con un nombre existente', async () => {
  const bytes = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#82996c' },
  })
    .avif()
    .toBuffer();
  const id = randomUUID();
  const photo = await processPhoto(
    new File([new Uint8Array(bytes)], 'image.avif'),
    ids.private,
    '2026-10-25',
    'Personal',
    id,
  );
  expect(photo.filename).toMatch(/\.avif$/);
  expect(photo.mime).toBe('image/avif');
  await expect(
    processPhoto(
      new File([new Uint8Array(bytes)], 'image.avif'),
      ids.private,
      '2026-10-25',
      'Personal',
      id,
    ),
  ).rejects.toThrow();
  expect(await getFile(photo.originalKey)).toEqual(bytes);
  await deletePhotoFiles(photo);
});
describe('subidas directas', () => {
  it('limpiar autorizaciones utilizadas no elimina fotos publicadas', async () => {
    const bytes = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#779966' },
    })
      .png()
      .toBuffer();
    const ticket = await createUpload('2026-10-25', 'Personal', bytes.length);
    const row = (await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, ticket.id))
      .get())!;
    await putFile(row.uploadKey, bytes, 'application/octet-stream');
    const photo = await completeUpload(ticket.id);
    await db
      .insert(photos)
      .values({ ...photo, memoryId: ids.private })
      .run();
    await db
      .update(uploads)
      .set({ state: 'used', payload: null, expiresAt: 0 })
      .where(eq(uploads.id, ticket.id))
      .run();
    await cleanupUploads();
    expect(await getFile(photo.originalKey)).toEqual(bytes);
    await deletePhotoFiles(photo);
  });
  it('prepara una foto una sola vez y limpia subidas abandonadas', async () => {
    const bytes = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#779966' },
    })
      .png()
      .toBuffer();
    const ticket = await createUpload('2026-10-25', 'Personal', bytes.length);
    expect(ticket.uploadUrl).toBe(`/api/v1/uploads/${ticket.id}/file`);
    const row = (await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, ticket.id))
      .get())!;
    await putFile(row.uploadKey, bytes, 'application/octet-stream');
    const photo = await completeUpload(ticket.id);
    expect(photo.filename).toMatch(/^20261025-personal-[a-f0-9]{12}\.png$/);
    expect((await completeUpload(ticket.id)).id).toBe(photo.id);
    await db
      .update(uploads)
      .set({ expiresAt: 0 })
      .where(eq(uploads.id, ticket.id))
      .run();
    expect(await cleanupUploads()).toBe(1);
    await expect(getFile(photo.originalKey)).rejects.toThrow();
  });
});
