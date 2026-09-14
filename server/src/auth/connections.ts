/**
 * Storing what the owner connected.
 *
 * Rule: a decrypted token never leaves this module. Callers ask for a token by
 * connection and get it just-in-time; the API layer only ever sees masked data.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.js';
import { decryptToken, encryptToken, newState } from './crypto.js';
import type { Channel } from './providers.js';

export interface ConnectionRow {
  id: string;
  channel: string;
  external_account_id: string | null;
  display_name: string | null;
  capabilities: Record<string, boolean>;
  status: string;
  token_source: string;
  scopes: string[] | null;
  avatar_url: string | null;
  connected_by: string | null;
  connected_at: string | null;
  token_expires_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
}

/* ---------------- state (CSRF for the redirect round-trip) ---------------- */

export async function createState(db: Db, storeId: string, channel: Channel, redirectTo?: string): Promise<string> {
  const state = newState();
  await db.query('insert into oauth_state(state, store_id, channel, redirect_to) values ($1,$2,$3,$4)', [state, storeId, channel, redirectTo ?? null]);
  return state;
}

/** Single-use, 10 minute window. Returns null if unknown, reused, or stale. */
export async function consumeState(db: Db, state: string): Promise<{ store_id: string; channel: Channel; redirect_to: string | null } | null> {
  const rows = await db.query<{ store_id: string; channel: Channel; redirect_to: string | null; consumed_at: string | null; age_sec: number }>(
    `select store_id, channel, redirect_to, consumed_at, extract(epoch from (now() - created_at)) as age_sec
       from oauth_state where state = $1`, [state]);
  if (!rows.length) return null;
  const r = rows[0];
  if (r.consumed_at || Number(r.age_sec) > 600) return null;
  await db.query('update oauth_state set consumed_at = now() where state = $1', [state]);
  return { store_id: r.store_id, channel: r.channel, redirect_to: r.redirect_to };
}

/* ---------------- grants and connections ---------------- */

export async function saveGrant(db: Db, o: {
  storeId: string; channel: Channel; userToken: string; scopes: string[]; expiresInSec: number | null; grantedBy?: string;
}): Promise<string> {
  const id = randomUUID();
  const expiresAt = o.expiresInSec ? new Date(Date.now() + o.expiresInSec * 1000) : null;
  await db.query(
    `insert into oauth_grant(id, store_id, channel, granted_scopes, token_enc, expires_at, granted_by)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, o.storeId, o.channel, o.scopes, encryptToken(o.userToken), expiresAt, o.grantedBy ?? null]);
  return id;
}

export async function getGrantToken(db: Db, grantId: string): Promise<string | null> {
  const rows = await db.query<{ token_enc: string | null }>('select token_enc from oauth_grant where id = $1', [grantId]);
  return rows[0]?.token_enc ? decryptToken(rows[0].token_enc) : null;
}

export async function attachAccount(db: Db, o: {
  storeId: string; channel: Channel; grantId: string | null; externalId: string; displayName: string;
  token?: string; tokenExpiresAt?: Date | null; scopes?: string[]; avatarUrl?: string | null;
  capabilities: Record<string, boolean>; connectedBy?: string; source?: 'oauth' | 'demo' | 'env';
}): Promise<string> {
  const id = `${o.storeId}-${o.channel}-${o.externalId}`;
  await db.query(
    `insert into connection(id, store_id, channel, external_account_id, display_name, capabilities, status,
                            grant_id, token_enc, token_source, scopes, avatar_url, connected_by, connected_at, token_expires_at, last_error)
     values ($1,$2,$3,$4,$5,$6,'connected',$7,$8,$9,$10,$11,$12,now(),$13,null)
     on conflict (id) do update set
       display_name=excluded.display_name, capabilities=excluded.capabilities, status='connected',
       grant_id=excluded.grant_id, token_enc=excluded.token_enc, token_source=excluded.token_source,
       scopes=excluded.scopes, avatar_url=excluded.avatar_url, connected_by=excluded.connected_by,
       connected_at=now(), token_expires_at=excluded.token_expires_at, last_error=null`,
    [id, o.storeId, o.channel, o.externalId, o.displayName, JSON.stringify(o.capabilities), o.grantId,
     o.token ? encryptToken(o.token) : null, o.source ?? 'oauth', o.scopes ?? null, o.avatarUrl ?? null,
     o.connectedBy ?? null, o.tokenExpiresAt ?? null]);
  await db.query(
    `insert into audit_log(store_id, actor, actor_type, action, target, after) values ($1,$2,'human','connection.connect',$3,$4)`,
    [o.storeId, o.connectedBy ?? 'unknown', `${o.channel}:${o.externalId}`, JSON.stringify({ display_name: o.displayName, scopes: o.scopes })]);
  return id;
}

/**
 * Token for a connection, decrypted just in time. Falls back to the env var named
 * by token_ref so a System User token configured by hand keeps working.
 */
export async function getConnectionToken(db: Db, connectionId: string): Promise<string | null> {
  const rows = await db.query<{ token_enc: string | null; token_ref: string | null; grant_id: string | null }>(
    'select token_enc, token_ref, grant_id from connection where id = $1', [connectionId]);
  const r = rows[0];
  if (!r) return null;
  if (r.token_enc) return decryptToken(r.token_enc);
  if (r.token_ref && process.env[r.token_ref]) return process.env[r.token_ref]!;
  if (r.grant_id) return getGrantToken(db, r.grant_id);
  return null;
}

export async function listConnections(db: Db, storeId: string): Promise<ConnectionRow[]> {
  return db.query<ConnectionRow>(
    `select id, channel, external_account_id, display_name, capabilities, status, token_source,
            scopes, avatar_url, connected_by, connected_at::text, token_expires_at::text,
            last_sync_at::text, last_error
       from connection where store_id = $1 order by channel, display_name`, [storeId]);
}

export async function disconnect(db: Db, storeId: string, connectionId: string, actor = 'unknown'): Promise<boolean> {
  const rows = await db.query<{ channel: string; display_name: string | null }>(
    'select channel, display_name from connection where id = $1 and store_id = $2', [connectionId, storeId]);
  if (!rows.length) return false;
  // Keep the row so history and foreign keys survive, but drop every secret.
  await db.query(
    `update connection set status='disconnected', token_enc=null, refresh_enc=null, grant_id=null,
            scopes=null, token_expires_at=null, last_error=null where id=$1 and store_id=$2`,
    [connectionId, storeId]);
  await db.query(
    `insert into audit_log(store_id, actor, actor_type, action, target, before) values ($1,$2,'human','connection.disconnect',$3,$4)`,
    [storeId, actor, connectionId, JSON.stringify(rows[0])]);
  return true;
}

/** Connections whose token is expiring, for the renewal job and the warning banner. */
export async function expiringConnections(db: Db, withinDays = 14): Promise<ConnectionRow[]> {
  return db.query<ConnectionRow>(
    `select id, channel, external_account_id, display_name, capabilities, status, token_source,
            scopes, avatar_url, connected_by, connected_at::text, token_expires_at::text,
            last_sync_at::text, last_error
       from connection
      where status = 'connected' and token_expires_at is not null
        and token_expires_at < now() + ($1 || ' days')::interval
      order by token_expires_at`, [String(withinDays)]);
}
