/**
 * Facebook "Connect account" flow.
 *
 *   1. buildAuthorizeUrl()  → bounce the owner to Facebook's consent screen
 *   2. exchangeCode()       → code → short-lived user token → long-lived user token (~60 days)
 *   3. listAccounts()       → the Pages and ad accounts that token can reach
 *   4. (caller stores the chosen Page token, which does NOT expire while the
 *      long-lived user token stays valid)
 *
 * Every network call goes through `fetchImpl` so the whole flow is testable
 * without touching Facebook.
 */
import { GRAPH_VERSION, PROVIDERS } from './providers.js';

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface FacebookAccount {
  kind: 'page' | 'ad_account';
  id: string;
  name: string;
  avatar_url?: string;
  /** page token — present for pages only; never sent to the browser */
  token?: string;
  detail?: string;
}

export interface ExchangeResult {
  userToken: string;
  expiresInSec: number | null;
  scopes: string[];
}

export function buildAuthorizeUrl(o: { appId: string; redirectUri: string; state: string; scopes: string[]; configId?: string }): string {
  const u = new URL(PROVIDERS.facebook.authorizeUrl);
  u.searchParams.set('client_id', o.appId);
  u.searchParams.set('redirect_uri', o.redirectUri);
  u.searchParams.set('state', o.state);
  u.searchParams.set('response_type', 'code');
  // Facebook Login for Business uses a saved configuration instead of a raw scope list
  if (o.configId) u.searchParams.set('config_id', o.configId);
  else u.searchParams.set('scope', o.scopes.join(','));
  return u.toString();
}

async function graph<T>(path: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<T> {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchImpl(url);
  const body = (await res.json()) as { error?: { message: string; code: number } };
  if (!res.ok || body.error) throw new Error(`Facebook ${path}: ${body.error?.message ?? res.status}`);
  return body as T;
}

/** code → long-lived user token. Two hops, exactly as Meta documents it. */
export async function exchangeCode(o: {
  code: string; appId: string; appSecret: string; redirectUri: string; fetchImpl?: typeof fetch;
}): Promise<ExchangeResult> {
  const f = o.fetchImpl ?? fetch;
  const short = await graph<{ access_token: string }>('oauth/access_token', {
    client_id: o.appId, client_secret: o.appSecret, redirect_uri: o.redirectUri, code: o.code,
  }, f);

  const long = await graph<{ access_token: string; expires_in?: number }>('oauth/access_token', {
    grant_type: 'fb_exchange_token', client_id: o.appId, client_secret: o.appSecret, fb_exchange_token: short.access_token,
  }, f);

  let scopes: string[] = [];
  try {
    const perms = await graph<{ data: { permission: string; status: string }[] }>('me/permissions', { access_token: long.access_token }, f);
    scopes = (perms.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission);
  } catch {
    // permissions endpoint is informational; a failure must not break the connect
  }

  return { userToken: long.access_token, expiresInSec: long.expires_in ?? null, scopes };
}

/** Everything this grant can reach, so the owner can pick. */
export async function listAccounts(o: { userToken: string; fetchImpl?: typeof fetch }): Promise<FacebookAccount[]> {
  const f = o.fetchImpl ?? fetch;
  const out: FacebookAccount[] = [];

  try {
    const pages = await graph<{ data: { id: string; name: string; access_token: string; category?: string; followers_count?: number; picture?: { data?: { url?: string } } }[] }>(
      'me/accounts', { access_token: o.userToken, fields: 'id,name,access_token,category,followers_count,picture{url}', limit: '50' }, f);
    for (const p of pages.data ?? []) {
      out.push({
        kind: 'page', id: p.id, name: p.name, token: p.access_token,
        avatar_url: p.picture?.data?.url,
        detail: [p.category, p.followers_count ? `${p.followers_count.toLocaleString('th-TH')} ผู้ติดตาม` : null].filter(Boolean).join(' · '),
      });
    }
  } catch (e) {
    throw new Error(`ดึงรายชื่อเพจไม่สำเร็จ: ${(e as Error).message}`);
  }

  try {
    const accounts = await graph<{ data: { id: string; account_id: string; name: string; currency?: string; account_status?: number }[] }>(
      'me/adaccounts', { access_token: o.userToken, fields: 'id,account_id,name,currency,account_status', limit: '50' }, f);
    for (const a of accounts.data ?? []) {
      out.push({
        kind: 'ad_account', id: a.id, name: a.name,
        detail: [a.currency, a.account_status === 1 ? 'ใช้งานได้' : 'ถูกระงับ'].filter(Boolean).join(' · '),
      });
    }
  } catch {
    // ad accounts need ads_read; a store may connect the Page first and ads later
  }

  return out;
}

/** Ask Facebook whether a stored token is still alive (used by the refresh job). */
export async function inspectToken(o: { token: string; appId: string; appSecret: string; fetchImpl?: typeof fetch }) {
  const f = o.fetchImpl ?? fetch;
  const r = await graph<{ data: { is_valid: boolean; expires_at: number; scopes?: string[] } }>(
    'debug_token', { input_token: o.token, access_token: `${o.appId}|${o.appSecret}` }, f);
  return {
    valid: r.data.is_valid,
    expiresAt: r.data.expires_at ? new Date(r.data.expires_at * 1000) : null, // 0 = never expires
    scopes: r.data.scopes ?? [],
  };
}
