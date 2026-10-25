import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { db, sqlite } from '../src/lib/db';
import {
  groups,
  memories,
  audiences,
  photos,
  sessions,
} from '../src/lib/schema';
import {
  hashSecret,
  verifySecret,
  issueSession,
  resolveAccess,
  authenticate,
  allowAttempt,
} from '../src/lib/auth';
import { getMemory, listMemories } from '../src/lib/memories';
import { processPhoto } from '../src/lib/images';
import { getFile, deletePhotoFiles } from '../src/lib/storage';

afterAll(() => sqlite.close());
const friend = randomUUID();
const family = randomUUID();
const code = 'friends-code-123';
db.insert(groups)
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
  db.insert(memories)
    .values({
      id,
      title: name,
      date: '2026-10-05',
      public: name === 'public',
      createdAt: new Date().toISOString(),
    })
    .run();
}
db.insert(audiences)
  .values([
    { memoryId: ids.friend, groupId: friend },
    { memoryId: ids.family, groupId: family },
    { memoryId: ids.both, groupId: friend },
    { memoryId: ids.both, groupId: family },
  ])
  .run();

describe('permisos integrados con SQLite', () => {
  it('el público solo ve lo público incluso con un identificador conocido', () => {
    expect(
      listMemories({ role: 'public' }, '2026-10-01', '2026-10-31').map(
        (m) => m.id,
      ),
    ).toEqual([ids.public]);
    expect(getMemory(ids.private, { role: 'public' })).toBeNull();
    expect(getMemory(ids.friend, { role: 'public' })).toBeNull();
  });
  it('los grupos son independientes, combinables y también ven lo público', () => {
    const results = listMemories(
      { role: 'group', groupId: friend },
      '2026-10-01',
      '2026-10-31',
    );
    expect(new Set(results.map((m) => m.id))).toEqual(
      new Set([ids.public, ids.friend, ids.both]),
    );
    expect(
      getMemory(ids.friend, { role: 'group', groupId: family }),
    ).toBeNull();
    expect(results.every((m) => m.groupIds === undefined)).toBe(true);
  });
  it('el administrador ve todo y el filtro por fecha se aplica', () => {
    expect(
      listMemories({ role: 'admin' }, '2026-10-01', '2026-10-31'),
    ).toHaveLength(5);
    expect(
      listMemories({ role: 'admin' }, '2026-11-01', '2026-11-30'),
    ).toHaveLength(0);
  });
});
describe('códigos y sesiones', () => {
  it('almacena hashes con sal y rechaza valores incorrectos o hashes inválidos', () => {
    const hash = hashSecret('a-password');
    expect(hash).not.toContain('a-password');
    expect(hashSecret('a-password')).not.toBe(hash);
    expect(verifySecret('a-password', hash)).toBe(true);
    expect(verifySecret('incorrect', hash)).toBe(false);
    expect(verifySecret('a-password', 'scrypt:bad:nope')).toBe(false);
  });
  it('autentica el grupo y separa tokens API de cookies de sesión', () => {
    expect(authenticate(code, 'group')).toMatchObject({
      role: 'group',
      groupId: friend,
    });
    expect(authenticate('wrong', 'group')).toBeNull();
    const token = issueSession({ role: 'admin' }, 'token', 'test');
    expect(resolveAccess(token)).toEqual({ role: 'public' });
    expect(resolveAccess(token, 'token')).toEqual({ role: 'admin' });
  });
  it('invalida sesiones al revocarlas y rechaza sesiones caducadas', () => {
    const token = issueSession({ role: 'group', groupId: friend });
    expect(resolveAccess(token).role).toBe('group');
    db.update(sessions)
      .set({ expiresAt: 0 })
      .where(eq(sessions.groupId, friend))
      .run();
    expect(resolveAccess(token).role).toBe('public');
    const next = issueSession({ role: 'group', groupId: friend });
    db.delete(sessions).where(eq(sessions.groupId, friend)).run();
    expect(resolveAccess(next).role).toBe('public');
  });
  it('limita intentos persistentes de acceso', () => {
    for (let i = 0; i < 10; i++) expect(allowAttempt('test-ip')).toBe(true);
    expect(allowAttempt('test-ip')).toBe(false);
    expect(allowAttempt('another-ip')).toBe(true);
  });
});
describe('imágenes y almacenamiento privado', () => {
  it('conserva el original exacto, crea variantes sin EXIF y oculta la descarga al visitante', async () => {
    const original = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#78916a' },
    })
      .jpeg()
      .withMetadata()
      .toBuffer();
    const photo = await processPhoto(
      new File([new Uint8Array(original)], 'original.jpg', {
        type: 'image/jpeg',
      }),
      ids.public,
    );
    db.insert(photos).values(photo).run();
    expect(await getFile(`${photo.id}/original`)).toEqual(original);
    const metadata = await sharp(
      await getFile(`${photo.id}/preview`),
    ).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(
      (await sharp(await getFile(`${photo.id}/thumb`)).metadata()).width,
    ).toBe(360);
    expect(
      getMemory(ids.public, { role: 'public' })!.photos[0],
    ).not.toHaveProperty('originalUrl');
    expect(
      getMemory(ids.public, { role: 'admin' })!.photos[0].originalUrl,
    ).toContain('/original');
    await deletePhotoFiles(photo.id);
    await expect(getFile(`${photo.id}/original`)).rejects.toThrow();
  });
  it('rechaza archivos falsos y vacíos', async () => {
    await expect(
      processPhoto(new File(['not an image'], 'fake.jpg'), ids.public),
    ).rejects.toThrow();
    await expect(
      processPhoto(new File([], 'empty.jpg'), ids.public),
    ).rejects.toThrow();
  });
});
