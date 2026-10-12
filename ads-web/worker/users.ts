// The people who use the dashboard and their roles. Logging in is still decided by Cloudflare Access; this is
// what they may change once in. When a Cloudflare API token is set, the Access policy's email list is kept
// equal to this table plus the owners, so adding someone here also lets them log in (see access.ts).

import { ROLES, type Role } from './roles.ts';

export interface User { email: string; role: Role; note: string; added_by: string; added_at: string; updated_at: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(e: unknown): string {
  const s = String(e ?? '').trim().toLowerCase();
  if (!EMAIL.test(s)) throw new Error('อีเมลไม่ถูกต้อง');
  return s;
}

export function parseRole(r: unknown): Role {
  const s = String(r ?? '');
  if (!ROLES.includes(s as Role)) throw new Error('บทบาทไม่ถูกต้อง');
  return s as Role;
}

export async function loadUsers(db: D1Database): Promise<User[]> {
  const { results } = await db.prepare('SELECT * FROM users ORDER BY role, email').all<User>();
  return results;
}

export async function roleMap(db: D1Database): Promise<Map<string, Role>> {
  const { results } = await db.prepare('SELECT email, role FROM users').all<{ email: string; role: Role }>();
  return new Map(results.map((r) => [r.email, r.role]));
}

export async function saveUser(db: D1Database, u: { email: string; role: Role; note: string }, by: string): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO users (email, role, note, added_by, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET role = excluded.role, note = excluded.note, updated_at = excluded.updated_at`)
    .bind(u.email, u.role, u.note.slice(0, 200), by, now, now).run();
}

export async function deleteUser(db: D1Database, email: string): Promise<boolean> {
  const r = await db.prepare('DELETE FROM users WHERE email = ?').bind(email).run();
  return (r.meta.changes ?? 0) > 0;
}

/** Owners from the Worker var (always owners, can't be edited away) */
export function ownerEmails(env: { OWNER_EMAILS?: string }): string[] {
  return (env.OWNER_EMAILS ?? '').split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}
