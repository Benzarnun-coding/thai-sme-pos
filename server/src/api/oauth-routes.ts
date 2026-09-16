/**
 * Connect-account endpoints.
 *
 * Flow from the browser's point of view:
 *   1. POST /connect/facebook          → { url }  then the browser goes there
 *   2. Facebook asks for consent, redirects to /api/oauth/facebook/callback
 *   3. We store the grant and bounce back to the app with ?grant=<id>
 *   4. GET  /connect/facebook/accounts → the Pages / ad accounts to choose from
 *   5. POST /connect/facebook/attach   → save the chosen ones
 *
 * When FB_APP_ID / FB_APP_SECRET are not configured the same endpoints run a
 * clearly-labelled demo so the screen can be shown to a partner before the
 * Meta App exists. Demo connections are marked token_source='demo'.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { attachAccount, consumeState, createState, disconnect, getGrantToken, listConnections, saveGrant } from '../auth/connections.js';
import { buildAuthorizeUrl, exchangeCode, listAccounts, type FacebookAccount } from '../auth/facebook-oauth.js';
import { isConfigured, missingEnv, PROVIDERS, scopesForPhase, type Channel } from '../auth/providers.js';

const CHANNELS = ['facebook', 'tiktok', 'shopee', 'line'] as const;
const isChannel = (v: string): v is Channel => (CHANNELS as readonly string[]).includes(v);

/** How far the build has got — controls which scopes we ask for today. */
const CURRENT_PHASE = Number(process.env.LOOPDESK_PHASE ?? 1);

function appBase(): string { return process.env.APP_BASE_URL ?? 'http://localhost:5173'; }
function apiBase(): string { return process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}`; }
function redirectUri(channel: Channel): string { return `${apiBase()}/api/oauth/${channel}/callback`; }

/** Capabilities a connection gets, derived from the scopes actually granted. */
function capabilitiesFor(channel: Channel, kind: string, scopes: string[]): Record<string, boolean> {
  if (channel !== 'facebook') return { insights: true };
  if (kind === 'ad_account') {
    return { insights: scopes.includes('ads_read'), ads: scopes.includes('ads_management') };
  }
  return {
    insights: scopes.includes('read_insights') || scopes.includes('pages_read_engagement'),
    post: scopes.includes('pages_manage_posts'),
  };
}

const DEMO_ACCOUNTS: FacebookAccount[] = [
  { kind: 'page', id: '100083203598462', name: 'กางเกงยีนส์ชาย Climax by PKjeans', token: 'demo-page-token', detail: 'การช้อปปิ้งและค้าปลีก · 44,000 ผู้ติดตาม' },
  { kind: 'page', id: '100090000000001', name: 'PKjeans ขายส่ง', token: 'demo-page-token-2', detail: 'ขายส่ง · 3,100 ผู้ติดตาม' },
  { kind: 'ad_account', id: 'act_8841000111', name: 'Climax Ads', detail: 'THB · ใช้งานได้' },
];

export function registerOauthRoutes(app: FastifyInstance, db: Db) {
  /** What can be connected, and what each permission means (for the UI). */
  app.get('/api/providers', async () => Object.values(PROVIDERS).map((p) => ({
    channel: p.channel, name: p.name, implemented: p.implemented,
    configured: isConfigured(p.channel), missing_env: missingEnv(p.channel),
    account_kinds: p.accountKinds,
    scopes: p.scopes.map((s) => ({ ...s, requested_now: s.phase <= CURRENT_PHASE })),
  })));

  /** Step 1 — start the connect. */
  app.post('/api/stores/:id/connect/:channel', async (req, reply) => {
    const { id, channel } = req.params as { id: string; channel: string };
    if (!isChannel(channel)) return reply.code(400).send({ error: `ไม่รู้จักช่องทาง ${channel}` });
    if (!PROVIDERS[channel].implemented) {
      return reply.code(501).send({ error: `${PROVIDERS[channel].name} ยังไม่เปิดให้เชื่อมต่อในเวอร์ชันนี้` });
    }
    const body = z.object({ by: z.string().optional() }).safeParse(req.body ?? {});
    const by = body.success ? body.data.by : undefined;
    const state = await createState(db, id, channel, `${appBase()}/#Marketing`);

    if (!isConfigured(channel)) {
      // Demo: skip Facebook entirely, hand back a grant the picker can use.
      const grantId = await saveGrant(db, { storeId: id, channel, userToken: 'demo-user-token', scopes: scopesForPhase(channel, CURRENT_PHASE), expiresInSec: 60 * 24 * 3600, grantedBy: by });
      return { mode: 'demo', grant_id: grantId, state, missing_env: missingEnv(channel),
        note: `ยังไม่ได้ตั้งค่า ${missingEnv(channel).join(', ')} — กำลังแสดงขั้นตอนแบบตัวอย่าง` };
    }

    return {
      mode: 'oauth',
      url: buildAuthorizeUrl({
        appId: process.env.FB_APP_ID!, redirectUri: redirectUri(channel), state,
        scopes: scopesForPhase(channel, CURRENT_PHASE), configId: process.env.FB_LOGIN_CONFIG_ID,
      }),
    };
  });

  /** Step 2/3 — Facebook sends the owner back here. */
  app.get('/api/oauth/:channel/callback', async (req, reply) => {
    const { channel } = req.params as { channel: string };
    const q = req.query as { code?: string; state?: string; error?: string; error_description?: string };
    const back = (params: Record<string, string>) =>
      reply.redirect(`${appBase()}/#Marketing?` + new URLSearchParams(params).toString());

    if (!isChannel(channel)) return back({ connect_error: 'ช่องทางไม่ถูกต้อง' });
    if (q.error) return back({ connect_error: q.error_description ?? q.error });
    if (!q.code || !q.state) return back({ connect_error: 'ไม่ได้รับรหัสยืนยันจากผู้ให้บริการ' });

    const st = await consumeState(db, q.state);
    if (!st) return back({ connect_error: 'ลิงก์เชื่อมต่อหมดอายุหรือถูกใช้ไปแล้ว กรุณากดเชื่อมต่อใหม่' });

    try {
      const ex = await exchangeCode({
        code: q.code, appId: process.env.FB_APP_ID!, appSecret: process.env.FB_APP_SECRET!, redirectUri: redirectUri(channel),
      });
      const grantId = await saveGrant(db, {
        storeId: st.store_id, channel, userToken: ex.userToken, scopes: ex.scopes, expiresInSec: ex.expiresInSec,
      });
      return back({ grant: grantId, channel });
    } catch (e) {
      return back({ connect_error: (e as Error).message });
    }
  });

  /** Step 4 — which accounts this grant can reach. Tokens are never returned. */
  app.get('/api/stores/:id/connect/:channel/accounts', async (req, reply) => {
    const { id, channel } = req.params as { id: string; channel: string };
    const q = z.object({ grant: z.string().min(1) }).safeParse(req.query);
    if (!isChannel(channel) || !q.success) return reply.code(400).send({ error: 'ต้องระบุ grant' });

    const rows = await db.query<{ store_id: string; granted_scopes: string[] | null }>(
      'select store_id, granted_scopes from oauth_grant where id = $1 and channel = $2', [q.data.grant, channel]);
    if (!rows.length || rows[0].store_id !== id) return reply.code(404).send({ error: 'ไม่พบการเชื่อมต่อนี้' });
    const scopes = rows[0].granted_scopes ?? [];

    const token = await getGrantToken(db, q.data.grant);
    const accounts = token === 'demo-user-token' || !isConfigured(channel)
      ? DEMO_ACCOUNTS
      : await listAccounts({ userToken: token! });

    return {
      grant_id: q.data.grant, scopes, demo: token === 'demo-user-token',
      accounts: accounts.map((a) => ({
        kind: a.kind, id: a.id, name: a.name, detail: a.detail, avatar_url: a.avatar_url,
        capabilities: capabilitiesFor(channel, a.kind, scopes),
      })),
    };
  });

  /** Step 5 — save the accounts the owner ticked. */
  app.post('/api/stores/:id/connect/:channel/attach', async (req, reply) => {
    const { id, channel } = req.params as { id: string; channel: string };
    const body = z.object({
      grant: z.string().min(1),
      account_ids: z.array(z.string()).min(1),
      by: z.string().optional(),
    }).safeParse(req.body);
    if (!isChannel(channel) || !body.success) return reply.code(400).send({ error: 'ต้องระบุ grant และ account_ids' });

    const rows = await db.query<{ store_id: string; granted_scopes: string[] | null; expires_at: string | null }>(
      'select store_id, granted_scopes, expires_at::text from oauth_grant where id = $1 and channel = $2', [body.data.grant, channel]);
    if (!rows.length || rows[0].store_id !== id) return reply.code(404).send({ error: 'ไม่พบการเชื่อมต่อนี้' });
    const scopes = rows[0].granted_scopes ?? [];

    const token = await getGrantToken(db, body.data.grant);
    const demo = token === 'demo-user-token' || !isConfigured(channel);
    const available = demo ? DEMO_ACCOUNTS : await listAccounts({ userToken: token! });

    const attached: string[] = [];
    for (const accountId of body.data.account_ids) {
      const acc = available.find((a) => a.id === accountId);
      if (!acc) continue;
      await attachAccount(db, {
        storeId: id, channel, grantId: body.data.grant, externalId: acc.id, displayName: acc.name,
        token: acc.token, avatarUrl: acc.avatar_url ?? null, scopes,
        // A Page token derived from a long-lived user token does not expire on its
        // own; it dies with the grant. Track the grant's expiry so we warn in time.
        tokenExpiresAt: rows[0].expires_at ? new Date(rows[0].expires_at) : null,
        capabilities: capabilitiesFor(channel, acc.kind, scopes),
        connectedBy: body.data.by, source: demo ? 'demo' : 'oauth',
      });
      attached.push(acc.id);
    }
    if (!attached.length) return reply.code(400).send({ error: 'ไม่พบบัญชีที่เลือกในสิทธิ์ที่ได้รับ' });
    return { attached, demo, connections: await listConnections(db, id) };
  });

  /** Disconnect — keeps history, destroys every secret. */
  app.delete('/api/stores/:id/connections/:connId', async (req, reply) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const by = (req.query as { by?: string }).by;
    const ok = await disconnect(db, id, connId, by);
    if (!ok) return reply.code(404).send({ error: 'ไม่พบการเชื่อมต่อนี้' });
    return { disconnected: connId, connections: await listConnections(db, id) };
  });
}
