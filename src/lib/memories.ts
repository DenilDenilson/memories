import { and, eq, gte, lte, or, inArray, asc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import { audiences, memories, photos } from './schema';
import type { Access } from './auth';
import { photoFilename } from './filenames';

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const date = new Date(`${s}T12:00:00Z`);
    return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
  }, 'Fecha inválida');
export const memorySchema = z.object({
  title: z.string().trim().min(1).max(120),
  date: dateSchema,
  description: z.string().trim().max(5000).default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  public: z.boolean().default(false),
  groupIds: z.array(z.string().uuid()).max(30).default([]),
});
export function visibility(access: Access) {
  if (access.role === 'admin') return undefined;
  if (access.role === 'group' && access.groupId) {
    const ids = db
      .select({ id: audiences.memoryId })
      .from(audiences)
      .where(eq(audiences.groupId, access.groupId));
    return or(eq(memories.public, true), inArray(memories.id, ids));
  }
  return eq(memories.public, true);
}
export async function listMemories(access: Access, from: string, to: string) {
  const rows = await db
    .select()
    .from(memories)
    .where(
      and(visibility(access), gte(memories.date, from), lte(memories.date, to)),
    )
    .orderBy(asc(memories.date), asc(memories.createdAt))
    .all();
  return Promise.all(rows.map((row) => hydrate(row, access)));
}
export async function getMemory(id: string, access: Access) {
  const row = await db
    .select()
    .from(memories)
    .where(and(eq(memories.id, id), visibility(access)))
    .get();
  return row ? hydrate(row, access) : null;
}
async function hydrate(row: typeof memories.$inferSelect, access: Access) {
  const items = await db
    .select()
    .from(photos)
    .where(eq(photos.memoryId, row.id))
    .all();
  return {
    ...row,
    tags: JSON.parse(row.tags) as string[],
    groupIds:
      access.role === 'admin'
        ? (
            await db
              .select()
              .from(audiences)
              .where(eq(audiences.memoryId, row.id))
              .all()
          ).map((a) => a.groupId)
        : undefined,
    photos: items.map((photo) => ({
      id: photo.id,
      width: photo.width,
      height: photo.height,
      thumbnailUrl: `/api/v1/photos/${photo.id}/thumb`,
      previewUrl: `/api/v1/photos/${photo.id}/preview`,
      ...(access.role === 'admin'
        ? {
            filename: photoFilename(
              row.date,
              row.title,
              photo.id,
              photo.filename.split('.').pop()!,
            ),
            size: photo.size,
            originalUrl: `/api/v1/photos/${photo.id}/original`,
          }
        : {}),
    })),
  };
}
export type Memory = NonNullable<Awaited<ReturnType<typeof getMemory>>>;
