import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db, sqlite } from './db';
import { groups, sessions } from './schema';

export type Access = {
  role: 'public' | 'group' | 'admin';
  groupId?: string;
  name?: string;
};
export const publicAccess: Access = { role: 'public' };
export function hashSecret(value: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}
export function verifySecret(value: string, stored: string) {
  const [algorithm, salt, hash] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !/^[a-f0-9]{128}$/.test(hash || ''))
    return false;
  return timingSafeEqual(scryptSync(value, salt, 64), Buffer.from(hash, 'hex'));
}
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function issueSession(
  access: Access,
  kind: 'session' | 'token' = 'session',
  label = '',
) {
  if (access.role === 'public')
    throw new Error('No se puede abrir una sesión pública');
  const token = randomBytes(32).toString('base64url');
  db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
  db.insert(sessions)
    .values({
      hash: digest(token),
      role: access.role,
      groupId: access.groupId,
      expiresAt: Date.now() + (kind === 'token' ? 90 : 30) * 86400000,
      kind,
      label,
    })
    .run();
  return token;
}
export function resolveAccess(
  token?: string,
  kind: 'session' | 'token' = 'session',
): Access {
  if (!token || token.length > 200) return publicAccess;
  const session = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.hash, digest(token)), eq(sessions.kind, kind)))
    .get();
  if (!session || session.expiresAt <= Date.now()) return publicAccess;
  if (session.role === 'admin') return { role: 'admin' };
  const group = session.groupId
    ? db.select().from(groups).where(eq(groups.id, session.groupId)).get()
    : undefined;
  return group
    ? { role: 'group', groupId: group.id, name: group.name }
    : publicAccess;
}
export function authenticate(secret: string, mode: string): Access | null {
  if (mode === 'admin') {
    return verifySecret(secret, process.env.ADMIN_PASSWORD_HASH || '')
      ? { role: 'admin' }
      : null;
  }
  // Se verifican todos los grupos para no dar información sobre el código coincidente.
  let result: Access | null = null;
  for (const group of db.select().from(groups).all()) {
    if (verifySecret(secret, group.codeHash))
      result = { role: 'group', groupId: group.id, name: group.name };
  }
  return result;
}
export function allowAttempt(ip: string) {
  const key = digest(ip);
  const now = Date.now();
  sqlite.prepare('DELETE FROM attempts WHERE reset_at <= ?').run(now);
  sqlite
    .prepare(
      `INSERT INTO attempts(key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = count + 1`,
    )
    .run(key, now + 15 * 60000);
  const row = sqlite
    .prepare('SELECT count FROM attempts WHERE key = ?')
    .get(key) as { count: number };
  return row.count <= 10;
}
