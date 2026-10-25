import type { APIRoute } from 'astro';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z, ZodError } from 'zod';
import { db } from '../../../lib/db';
import {
  groups,
  sessions,
  memories,
  audiences,
  photos,
} from '../../../lib/schema';
import {
  allowAttempt,
  authenticate,
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
import { deletePhotoFiles, getFile } from '../../../lib/storage';

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
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
      Buffer.from(await limitedBody(request, 32 * 1024)).toString(),
    );
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return fail(400, 'JSON inválido.');
  }
}

export const ALL: APIRoute = async (context) => {
  const { request, params, locals, cookies, url } = context;
  const parts = (params.path || '').split('/');
  const [resource, id, action] = parts;
  const method = request.method;
  const access = locals.access;
  const admin = () => {
    if (access.role !== 'admin')
      fail(403, 'Solo el administrador puede realizar esta acción.');
  };
  const ok = (value: unknown, status = 200) => Response.json(value, { status });
  try {
    if (resource === 'session' && method === 'POST') {
      let ip = 'local';
      try {
        ip = context.clientAddress;
      } catch {
        /* SSR sin socket */
      }
      if (!allowAttempt(ip))
        fail(429, 'Demasiados intentos. Espera 15 minutos.');
      const input = z
        .object({
          secret: z.string().min(1).max(256),
          mode: z.enum(['admin', 'group']),
        })
        .parse(await json(request));
      if (input.mode === 'admin' && !process.env.ADMIN_PASSWORD_HASH)
        fail(
          503,
          'Configura ADMIN_PASSWORD_HASH para habilitar la administración.',
        );
      const identity = authenticate(input.secret, input.mode);
      if (!identity)
        return fail(401, 'La contraseña o el código no son correctos.');
      const previous = cookies.get('dm_session')?.value;
      if (previous)
        db.delete(sessions)
          .where(eq(sessions.hash, digest(previous)))
          .run();
      const token = issueSession(identity);
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
        db.delete(sessions)
          .where(eq(sessions.hash, digest(token)))
          .run();
      cookies.delete('dm_session', { path: '/' });
      return ok({ success: true });
    }
    if (resource === 'session' && method === 'GET') return ok({ access });
    if (resource === 'groups') {
      admin();
      if (method === 'GET')
        return ok({
          groups: db
            .select({ id: groups.id, name: groups.name })
            .from(groups)
            .all(),
        });
      if (method === 'POST' && !id) {
        const input = z
          .object({
            name: z.string().trim().min(1).max(40),
            code: z.string().min(8).max(128).optional(),
          })
          .parse(await json(request));
        if (db.select().from(groups).all().length >= 30)
          fail(400, 'Máximo 30 grupos.');
        if (db.select().from(groups).where(eq(groups.name, input.name)).get())
          fail(409, 'Ya existe un grupo con ese nombre.');
        const code = input.code || randomBytes(12).toString('base64url');
        if (
          db
            .select()
            .from(groups)
            .all()
            .some((g) => verifySecret(code, g.codeHash))
        )
          fail(409, 'Este código ya pertenece a otro grupo.');
        const group = {
          id: randomUUID(),
          name: input.name,
          codeHash: hashSecret(code),
        };
        db.insert(groups).values(group).run();
        return ok({ id: group.id, name: group.name, code }, 201);
      }
      if (id && !db.select().from(groups).where(eq(groups.id, id)).get())
        fail(404, 'Grupo no encontrado.');
      if (method === 'POST' && action === 'rotate') {
        const code = randomBytes(12).toString('base64url');
        db.transaction((tx) => {
          tx.update(groups)
            .set({ codeHash: hashSecret(code) })
            .where(eq(groups.id, id))
            .run();
          tx.delete(sessions).where(eq(sessions.groupId, id)).run();
        });
        return ok({ code });
      }
      if (method === 'DELETE' && id) {
        db.delete(groups).where(eq(groups.id, id)).run();
        return ok({ success: true });
      }
    }
    if (resource === 'tokens') {
      admin();
      if (method === 'GET')
        return ok({
          tokens: db
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
          { token: issueSession(access, 'token', label), expiresInDays: 90 },
          201,
        );
      }
      if (method === 'DELETE' && id) {
        db.delete(sessions)
          .where(and(eq(sessions.hash, id), eq(sessions.kind, 'token')))
          .run();
        return ok({ success: true });
      }
    }
    if (resource === 'memories') {
      if (method === 'GET') {
        if (id) {
          const memory = getMemory(id, access);
          if (!memory) fail(404, 'Recuerdo no encontrado.');
          return ok({ memory });
        }
        const from = dateSchema.parse(url.searchParams.get('from'));
        const to = dateSchema.parse(url.searchParams.get('to'));
        if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 366)
          fail(400, 'El intervalo máximo es de 366 días.');
        return ok({ memories: listMemories(access, from, to) });
      }
      admin();
      if (method === 'DELETE' && id) {
        const memory = getMemory(id, access);
        if (!memory) fail(404, 'Recuerdo no encontrado.');
        // Primero eliminar archivos: si falla, se conserva la referencia para reintentar.
        for (const photo of memory!.photos) await deletePhotoFiles(photo.id);
        db.delete(memories).where(eq(memories.id, id)).run();
        return ok({ success: true });
      }
      if ((method === 'POST' && !id) || (method === 'PUT' && id)) {
        if (id && !getMemory(id, access)) fail(404, 'Recuerdo no encontrado.');
        if (
          !request.headers
            .get('content-type')
            ?.startsWith('multipart/form-data;')
        ) {
          fail(
            400,
            'Usa multipart/form-data con los campos metadata y photos.',
          );
        }
        const body = await limitedBody(request, 100 * 1024 * 1024);
        let form: FormData;
        try {
          form = await new Request(url, {
            method: 'POST',
            headers: { 'content-type': request.headers.get('content-type')! },
            body: new Uint8Array(body),
          }).formData();
        } catch {
          return fail(400, 'Formulario multipart inválido.');
        }
        let raw;
        try {
          raw = JSON.parse(String(form.get('metadata')));
        } catch {
          return fail(400, 'Falta metadata en formato JSON.');
        }
        const input = memorySchema.parse(raw);
        const validGroups = new Set(
          db
            .select({ id: groups.id })
            .from(groups)
            .all()
            .map((g) => g.id),
        );
        if (input.groupIds.some((g) => !validGroups.has(g)))
          fail(400, 'Uno de los grupos no existe.');
        const files = form
          .getAll('photos')
          .filter((f): f is File => typeof f !== 'string' && f.size > 0);
        const existingCount = id ? getMemory(id, access)!.photos.length : 0;
        if (files.length + existingCount > 30)
          fail(400, 'Máximo 30 fotos por recuerdo.');
        if (!id && !files.length) fail(400, 'Añade al menos una foto.');
        const memoryId = id || randomUUID();
        const processed: Awaited<ReturnType<typeof processPhoto>>[] = [];
        try {
          for (const file of files) {
            try {
              processed.push(await processPhoto(file, memoryId));
            } catch (error) {
              console.error('Conversión de foto:', error);
              fail(
                400,
                'No se pudo procesar una foto. Usa JPEG, PNG, WebP, AVIF o HEIC de hasta 30 MB.',
              );
            }
          }
          db.transaction((tx) => {
            const values = {
              title: input.title,
              date: input.date,
              description: input.description,
              tags: JSON.stringify([...new Set(input.tags)]),
              public: input.public,
            };
            if (id)
              tx.update(memories).set(values).where(eq(memories.id, id)).run();
            else
              tx.insert(memories)
                .values({
                  ...values,
                  id: memoryId,
                  createdAt: new Date().toISOString(),
                })
                .run();
            tx.delete(audiences).where(eq(audiences.memoryId, memoryId)).run();
            for (const groupId of new Set(input.groupIds))
              tx.insert(audiences).values({ memoryId, groupId }).run();
            for (const photo of processed)
              tx.insert(photos).values(photo).run();
          });
        } catch (error) {
          for (const photo of processed)
            await deletePhotoFiles(photo.id).catch(console.error);
          throw error;
        }
        return ok({ memory: getMemory(memoryId, access) }, id ? 200 : 201);
      }
    }
    if (resource === 'photos' && id) {
      const photo = db.select().from(photos).where(eq(photos.id, id)).get();
      if (!photo || !getMemory(photo.memoryId, access))
        fail(404, 'Foto no encontrada.');
      if (method === 'DELETE') {
        admin();
        const count = db
          .select()
          .from(photos)
          .where(eq(photos.memoryId, photo!.memoryId))
          .all().length;
        if (count <= 1)
          fail(
            400,
            'Conserva al menos una foto o elimina el recuerdo completo.',
          );
        await deletePhotoFiles(id);
        db.delete(photos).where(eq(photos.id, id)).run();
        return ok({ success: true });
      }
      if (
        method === 'GET' &&
        ['thumb', 'preview', 'original'].includes(action)
      ) {
        if (action === 'original') admin();
        const body = await getFile(`${id}/${action}`);
        return new Response(new Uint8Array(body), {
          headers: {
            'Content-Type': action === 'original' ? photo!.mime : 'image/jpeg',
            'Content-Length': String(body.length),
            ...(action === 'original'
              ? {
                  'Content-Disposition': `attachment; filename="photo-${id}"; filename*=UTF-8''${encodeURIComponent(photo!.filename).replace(/'/g, '%27')}`,
                }
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
