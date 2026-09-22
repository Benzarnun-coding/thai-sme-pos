/**
 * What Meta requires of a Live app beyond OAuth: a Data Deletion Request
 * callback and a Deauthorize callback, both delivered as a `signed_request`
 * (base64url signature . base64url JSON payload, HMAC-SHA256 with the app
 * secret), plus a public page where a user can check the status of their
 * request by confirmation code.
 *
 * Erasing a platform user means: every grant they gave loses its token, every
 * connection attached through those grants loses its secrets and the person's
 * name/avatar, and a record of the request is kept (without the token).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/client.js';

export interface SignedPayload { user_id: string; algorithm?: string; issued_at?: number; [k: string]: unknown }

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Null when the signature does not match the app secret (or the shape is wrong). */
export function parseSignedRequest(signedRequest: string, appSecret: string): SignedPayload | null {
  const [sig, payload] = String(signedRequest).split('.', 2);
  if (!sig || !payload) return null;
  const expected = createHmac('sha256', appSecret).update(payload).digest();
  const given = b64url(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(b64url(payload).toString('utf8')) as SignedPayload;
    if (data.algorithm && data.algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
    return typeof data.user_id === 'string' && data.user_id ? data : null;
  } catch { return null; }
}

/** Sign a payload the way Meta does — for tests and for the demo. */
export function signRequest(payload: SignedPayload, appSecret: string): string {
  const body = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issued_at: Math.floor(Date.now() / 1000), ...payload })).toString('base64url');
  const sig = createHmac('sha256', appSecret).update(body).digest('base64url');
  return `${sig}.${body}`;
}

export async function eraseUserData(db: Db, channel: string, externalUserId: string, kind: 'deletion' | 'deauthorize') {
  const grants = await db.query<{ id: string; store_id: string }>('select id, store_id from oauth_grant where channel=$1 and external_user_id=$2', [channel, externalUserId]);
  const grantIds = grants.map((g) => g.id);
  let connections = 0;
  if (grantIds.length) {
    const rows = await db.query<{ id: string; store_id: string }>(
      `update connection set status='disconnected', token_enc=null, refresh_enc=null, grant_id=null, scopes=null, token_expires_at=null,
              connected_by=null, avatar_url=null, last_error=$2
        where grant_id = any($1) returning id, store_id`, [grantIds, kind === 'deletion' ? 'ผู้ใช้ขอลบข้อมูล (Meta)' : 'ผู้ใช้ถอนสิทธิ์แอป (Meta)']);
    connections = rows.length;
    await db.query(`update oauth_grant set token_enc=null, refresh_enc=null, granted_by=null, granted_scopes=null where id = any($1)`, [grantIds]);
    for (const g of grants) {
      await db.query(`insert into audit_log(store_id, actor, actor_type, action, target, after) values ($1,'meta','automation',$2,$3,$4)`,
        [g.store_id, `connection.${kind}`, `${channel}:${externalUserId}`, JSON.stringify({ grant: g.id, connections })]);
    }
  }
  const code = randomBytes(6).toString('hex');
  await db.query(
    `insert into deletion_request(code, channel, external_user_id, kind, status, details, completed_at) values ($1,$2,$3,$4,'done',$5,now())`,
    [code, channel, externalUserId, kind, JSON.stringify({ grants: grantIds.length, connections })]);
  return { code, grants: grantIds.length, connections };
}

export async function deletionStatus(db: Db, code: string) {
  const rows = await db.query<{ code: string; kind: string; status: string; details: { grants: number; connections: number } | null; requested_at: string; completed_at: string | null }>(
    'select code, kind, status, details, requested_at::text, completed_at::text from deletion_request where code=$1', [code]);
  return rows[0] ?? null;
}
