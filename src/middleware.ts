import { defineMiddleware } from 'astro:middleware';
import { resolveAccess } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  const bearer = context.request.headers
    .get('authorization')
    ?.match(/^Bearer (.+)$/)?.[1];
  context.locals.access = bearer
    ? resolveAccess(bearer, 'token')
    : resolveAccess(context.cookies.get('dm_session')?.value);
  if (
    context.url.pathname.startsWith('/api/') &&
    !['GET', 'HEAD', 'OPTIONS'].includes(context.request.method) &&
    !bearer
  ) {
    if (context.request.headers.get('origin') !== context.url.origin) {
      return Response.json(
        { error: 'Origen de solicitud no permitido.' },
        { status: 403 },
      );
    }
  }
  const response = await next();
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
});
