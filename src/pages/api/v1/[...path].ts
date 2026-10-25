import type { APIRoute } from 'astro';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z, ZodError } from 'zod';
import { db } from '../../../lib/db';
import {
  groups,
  sessions,
  memories,
  audiences,
  photos,
  uploads,
} from '../../../lib/schema';
import {
  allowAttempt,
  authenticate,
  adminConfigured,
  digest,
  hashSecret,
  issueSession,
  verifySecret,
} from '../../../lib/auth';
import {
  getMemory,
  listMemories,
  memorySchema,
  dateSchema,
} from '../../../lib/memories';
import { processPhoto } from '../../../lib/images';
import {
  deletePhotoFiles,
  getFile,
  presignDownload,
  putFile,
  usesS3,
} from '../../../lib/storage';
import {
  createUpload,
  completeUpload,
  cleanupUploads,
  type ProcessedPhoto,
} from '../../../lib/uploads';
import { photoFilename } from '../../../lib/filenames';

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
async function limitedBody(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit)
    fail(413, 'La subida supera el tamaño permitido.');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      fail(413, 'La subida supera el tamaño permitido.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function json(request: Request) {
  try {
    return JSON.parse(
      Buffer.from(await limitedBody(request, 64 * 1024)).toString(),
    );
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return fail(400, 'JSON inválido.');
  }
}

export const ALL: APIRoute = async (context) => {
  const { request, params, locals, cookies, url } = context;
  const [resource, id, action, extra] = (params.path || '').split('/');
  const method = request.method;
  const access = locals.access;
  const admin = () => {
    if (access.role !== 'admin')
      fail(403, 'Solo el administrador puede realizar esta acción.');
  };
  const ok = (value: unknown, status = 200) => Response.json(value, { status });
  try {
    if (extra) fail(404, 'Ruta no encontrada.');
    if (resource === 'session' && method === 'POST') {
      let ip = 'local';
      try {
        ip = context.clientAddress;
      } catch {
        /* SSR sin socket */
      }
      if (!(await allowAttempt(ip)))
        fail(429, 'Demasiados intentos. Espera 15 minutos.');
      const input = z
        .object({
          secret: z.string().min(1).max(256),
          mode: z.enum(['admin', 'group']),
        })
        .parse(await json(request));
      if (input.mode === 'admin' && !adminConfigured())
        fail(
          503,
          'Configura ADMIN_PASSWORD con tu contraseña o ADMIN_PASSWORD_HASH con un hash scrypt válido; después redespliega la aplicación.',
        );
      const identity = await authenticate(input.secret, input.mode);
      if (!identity) fail(401, 'La contraseña o el código no son correctos.');
      const previous = cookies.get('dm_session')?.value;
      if (previous)
        await db
          .delete(sessions)
          .where(eq(sessions.hash, digest(previous)))
          .run();
      const token = await issueSession(identity);
      cookies.set('dm_session', token, {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE === 'true',
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 86400,
      });
      return ok({ access: identity });
    }
    if (resource === 'session' && method === 'DELETE') {
      const token = cookies.get('dm_session')?.value;
      if (token)
        await db
          .delete(sessions)
          .where(eq(sessions.hash, digest(token)))
          .run();
      cookies.delete('dm_session', { path: '/' });
      return ok({ success: true });
    }
    if (resource === 'session' && method === 'GET') return ok({ access });
    if (resource === 'groups') {
      admin();
      const allGroups = await db.select().from(groups).all();
      if (method === 'GET')
        return ok({ groups: allGroups.map(({ id, name }) => ({ id, name })) });
      if (method === 'POST' && !id) {
        const input = z
          .object({
            name: z.string().trim().min(1).max(40),
            code: z.string().min(8).max(128).optional(),
          })
          .parse(await json(request));
        if (allGroups.length >= 30) fail(400, 'Máximo 30 grupos.');
        if (allGroups.some((g) => g.name === input.name))
          fail(409, 'Ya existe un grupo con ese nombre.');
        const code = input.code || randomBytes(12).toString('base64url');
        if (allGroups.some((g) => verifySecret(code, g.codeHash)))
          fail(409, 'Este código ya pertenece a otro grupo.');
        const group = {
          id: randomUUID(),
          name: input.name,
          codeHash: hashSecret(code),
        };
        await db.insert(groups).values(group).run();
        return ok({ id: group.id, name: group.name, code }, 201);
      }
      if (id && !allGroups.some((g) => g.id === id))
        fail(404, 'Grupo no encontrado.');
      if (method === 'POST' && action === 'rotate') {
        const code = randomBytes(12).toString('base64url');
        await db.transaction(async (tx) => {
          await tx
            .update(groups)
            .set({ codeHash: hashSecret(code) })
            .where(eq(groups.id, id))
            .run();
          await tx.delete(sessions).where(eq(sessions.groupId, id)).run();
        });
        return ok({ code });
      }
      if (method === 'DELETE' && id) {
        await db.delete(groups).where(eq(groups.id, id)).run();
        return ok({ success: true });
      }
    }
    if (resource === 'tokens') {
      admin();
      if (method === 'GET')
        return ok({
          tokens: await db
            .select({
              id: sessions.hash,
              label: sessions.label,
              expiresAt: sessions.expiresAt,
            })
            .from(sessions)
            .where(eq(sessions.kind, 'token'))
            .all(),
        });
      if (method === 'POST') {
        const { label } = z
          .object({ label: z.string().trim().min(1).max(80) })
          .parse(await json(request));
        return ok(
          {
            token: await issueSession(access, 'token', label),
            expiresInDays: 90,
          },
          201,
        );
      }
      if (method === 'DELETE' && id) {
        await db
          .delete(sessions)
          .where(and(eq(sessions.hash, id), eq(sessions.kind, 'token')))
          .run();
        return ok({ success: true });
      }
    }
    if (resource === 'uploads') {
      admin();
      if (method === 'POST' && id === 'cleanup')
        return ok({ removed: await cleanupUploads() });
      if (method === 'POST' && !id) {
        const input = z
          .object({
            date: dateSchema,
            title: z.string().trim().min(1).max(120),
            size: z
              .number()
              .int()
              .min(1)
              .max(30 * 1024 * 1024),
          })
          .parse(await json(request));
        return ok(await createUpload(input.date, input.title, input.size), 201);
      }
      const upload = await db
        .select()
        .from(uploads)
        .where(eq(uploads.id, id))
        .get();
      if (!upload || upload.expiresAt <= Date.now() || upload.state === 'used')
        fail(404, 'Subida no disponible.');
      if (method === 'PUT' && action === 'file' && !usesS3) {
        if (upload.state !== 'pending') fail(409, 'La foto ya fue procesada.');
        const bytes = Buffer.from(await limitedBody(request, 30 * 1024 * 1024));
        if (bytes.length !== upload.size)
          fail(400, 'El tamaño de la foto no coincide con el declarado.');
        await putFile(upload.uploadKey, bytes, 'application/octet-stream');
        return ok({ success: true });
      }
      if (method === 'POST' && action === 'complete') {
        try {
          const photo = await completeUpload(id);
          return ok({ id, filename: photo.filename });
        } catch (error) {
          console.error('Procesamiento de subida:', error);
          fail(
            400,
            'No se pudo preparar la foto. Comprueba el formato, el tamaño y la configuración de R2.',
          );
        }
      }
    }
    if (resource === 'memories') {
      if (method === 'GET') {
        if (id) {
          const memory = await getMemory(id, access);
          if (!memory) fail(404, 'Recuerdo no encontrado.');
          return ok({ memory });
        }
        const from = dateSchema.parse(url.searchParams.get('from'));
        const to = dateSchema.parse(url.searchParams.get('to'));
        if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 366)
          fail(400, 'El intervalo máximo es de 366 días.');
        return ok({ memories: await listMemories(access, from, to) });
      }
      admin();
      const existing = id ? await getMemory(id, access) : null;
      if (id && !existing) fail(404, 'Recuerdo no encontrado.');
      if (method === 'DELETE' && id) {
        const stored = await db
          .select()
          .from(photos)
          .where(eq(photos.memoryId, id))
          .all();
        for (const photo of stored) await deletePhotoFiles(photo);
        await db.delete(memories).where(eq(memories.id, id)).run();
        return ok({ success: true });
      }
      if ((method === 'POST' && !id) || (method === 'PUT' && id)) {
        let raw: unknown;
        let uploadIds: string[] = [];
        let files: File[] = [];
        const isJson = request.headers
          .get('content-type')
          ?.startsWith('application/json');
        if (isJson) {
          const input = z
            .object({
              metadata: memorySchema,
              uploadIds: z.array(z.string().uuid()).max(30).default([]),
            })
            .parse(await json(request));
          raw = input.metadata;
          uploadIds = [...new Set(input.uploadIds)];
          if (uploadIds.length !== input.uploadIds.length)
            fail(400, 'No repitas las fotos en una publicación.');
        } else {
          if (process.env.VERCEL)
            fail(
              400,
              'En Vercel usa /uploads y envía metadata y uploadIds como JSON.',
            );
          if (
            !request.headers
              .get('content-type')
              ?.startsWith('multipart/form-data;')
          )
            fail(
              400,
              'Usa JSON con metadata y uploadIds, o multipart en desarrollo local.',
            );
          const body = await limitedBody(request, 100 * 1024 * 1024);
          let form: FormData;
          try {
            form = await new Request(url, {
              method: 'POST',
              headers: { 'content-type': request.headers.get('content-type')! },
              body: new Uint8Array(body),
            }).formData();
            raw = JSON.parse(String(form.get('metadata')));
          } catch {
            return fail(
              400,
              'Formulario inválido: falta metadata en formato JSON.',
            );
          }
          files = form
            .getAll('photos')
            .filter((f): f is File => typeof f !== 'string' && f.size > 0);
        }
        const input = memorySchema.parse(raw);
        const validGroups = new Set(
          (await db.select({ id: groups.id }).from(groups).all()).map(
            (g) => g.id,
          ),
        );
        if (input.groupIds.some((g) => !validGroups.has(g)))
          fail(400, 'Uno de los grupos no existe.');
        if (
          files.length + uploadIds.length + (existing?.photos.length || 0) >
          30
        )
          fail(400, 'Máximo 30 fotos por recuerdo.');
        if (!id && !files.length && !uploadIds.length)
          fail(400, 'Añade al menos una foto.');
        const tickets = uploadIds.length
          ? await db
              .select()
              .from(uploads)
              .where(inArray(uploads.id, uploadIds))
              .all()
          : [];
        if (
          tickets.length !== uploadIds.length ||
          tickets.some(
            (t) =>
              t.state !== 'ready' || t.expiresAt <= Date.now() || !t.payload,
          )
        )
          fail(
            400,
            'Una foto no está preparada, ya fue utilizada o ha caducado.',
          );
        if (
          tickets.some(
            (ticket) =>
              ticket.date !== input.date || ticket.title !== input.title,
          )
        ) {
          fail(
            400,
            'Las fotos preparadas deben tener la misma fecha y título que el recuerdo.',
          );
        }
        const memoryId = id || randomUUID();
        const processed: ProcessedPhoto[] = [];
        try {
          for (const file of files) {
            try {
              processed.push(
                await processPhoto(file, memoryId, input.date, input.title),
              );
            } catch (error) {
              console.error('Conversión de foto:', error);
              fail(
                400,
                'No se pudo procesar una foto. Usa JPEG, PNG, WebP, AVIF o HEIC de hasta 30 MB.',
              );
            }
          }
          await db.transaction(async (tx) => {
            const values = {
              title: input.title,
              date: input.date,
              description: input.description,
              tags: JSON.stringify([...new Set(input.tags)]),
              public: input.public,
            };
            if (id)
              await tx
                .update(memories)
                .set(values)
                .where(eq(memories.id, id))
                .run();
            else
              await tx
                .insert(memories)
                .values({
                  ...values,
                  id: memoryId,
                  createdAt: new Date().toISOString(),
                })
                .run();
            await tx
              .delete(audiences)
              .where(eq(audiences.memoryId, memoryId))
              .run();
            for (const groupId of new Set(input.groupIds))
              await tx.insert(audiences).values({ memoryId, groupId }).run();
            for (const ticket of tickets) {
              const claimed = await tx
                .update(uploads)
                .set({ state: 'used', payload: null })
                .where(
                  and(eq(uploads.id, ticket.id), eq(uploads.state, 'ready')),
                )
                .returning();
              if (!claimed.length)
                fail(409, 'Esta foto ya pertenece a otro recuerdo.');
              const photo = JSON.parse(ticket.payload!) as ProcessedPhoto;
              await tx
                .insert(photos)
                .values({ ...photo, memoryId })
                .run();
            }
            for (const photo of processed)
              await tx.insert(photos).values(photo).run();
          });
        } catch (error) {
          for (const photo of processed)
            await deletePhotoFiles(photo).catch(console.error);
          throw error;
        }
        return ok(
          { memory: await getMemory(memoryId, access) },
          id ? 200 : 201,
        );
      }
    }
    if (resource === 'photos' && id) {
      const photo = await db
        .select()
        .from(photos)
        .where(eq(photos.id, id))
        .get();
      const memory = photo ? await getMemory(photo.memoryId, access) : null;
      if (!photo || !memory) fail(404, 'Foto no encontrada.');
      if (method === 'DELETE') {
        admin();
        if (memory.photos.length <= 1)
          fail(
            400,
            'Conserva al menos una foto o elimina el recuerdo completo.',
          );
        await deletePhotoFiles(photo);
        await db.delete(photos).where(eq(photos.id, id)).run();
        return ok({ success: true });
      }
      if (
        method === 'GET' &&
        ['thumb', 'preview', 'original'].includes(action)
      ) {
        if (action === 'original') admin();
        const filename = photoFilename(
          memory.date,
          memory.title,
          photo.id,
          photo.filename.split('.').pop()!,
        );
        const key =
          action === 'original'
            ? photo.originalKey
            : action === 'preview'
              ? photo.previewKey
              : photo.thumbKey;
        const redirect = await presignDownload(
          key,
          action === 'original' ? filename : undefined,
        );
        if (redirect)
          return new Response(null, {
            status: 302,
            headers: { Location: redirect },
          });
        const body = await getFile(key);
        return new Response(new Uint8Array(body), {
          headers: {
            'Content-Type': action === 'original' ? photo.mime : 'image/jpeg',
            'Content-Length': String(body.length),
            ...(action === 'original'
              ? { 'Content-Disposition': `attachment; filename="${filename}"` }
              : {}),
          },
        });
      }
    }
    return fail(404, 'Ruta no encontrada.');
  } catch (error) {
    if (error instanceof HttpError)
      return ok({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return ok(
        { error: 'Revisa los campos enviados.', details: error.flatten() },
        400,
      );
    console.error(error);
    return ok(
      { error: 'No se pudo completar la operación. Inténtalo de nuevo.' },
      500,
    );
  }
};
