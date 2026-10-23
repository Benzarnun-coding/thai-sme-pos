// Answer bank → the Google Doc that Meta's Business AI reads as a source (Benz 2026-10-23: no more copying by hand).
// The Doc is rewritten whole from bot_kb (approved + applied) every time an answer is approved or taken out, so it
// always equals the bank and nobody edits it directly. Written with a Google service account (secret GOOGLE_SA_KEY,
// the JSON key; the Doc is shared with its e-mail as editor). Settings key `botkb_doc` = {doc_id, live}; it ships
// with live = false: GET /api/botkb/doc shows what would be written, nothing goes to Google until Benz switches it on.

import { kbPasteText, type KbItem } from './botKb.ts';

export interface DocEnv { DB: D1Database; GOOGLE_SA_KEY?: string }
export interface DocSettings { doc_id: string; live: boolean }

export async function loadDocSettings(db: D1Database): Promise<DocSettings> {
  const raw = await db.prepare("SELECT value FROM settings WHERE key = 'botkb_doc'").first<string>('value');
  try { const v = JSON.parse(raw ?? '{}'); return { doc_id: String(v.doc_id ?? ''), live: v.live === true }; } catch { return { doc_id: '', live: false }; }
}

export async function saveDocSettings(db: D1Database, s: DocSettings): Promise<void> {
  await db.prepare("INSERT INTO settings (key, value) VALUES ('botkb_doc', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(s)).run();
}

/** A Doc id from a pasted link or the id itself. */
export function docIdFrom(input: string): string {
  const m = /\/document\/d\/([\w-]{20,})/.exec(input) ?? /^([\w-]{20,})$/.exec(input.trim());
  return m ? m[1] : '';
}

/** Live = the switch is on and there is a Doc and a key to write with. */
export async function docLive(env: DocEnv): Promise<boolean> {
  const s = await loadDocSettings(env.DB);
  return s.live && !!s.doc_id && !!env.GOOGLE_SA_KEY;
}

/** The whole Doc: what Business AI should know, rules first, then question → answer. */
export function docText(items: KbItem[], date: string): string {
  // "(ทีมต้องยืนยัน …)" is for the team; the bot would say it to customers word for word (Benz 23 Oct).
  const clean = (t: string) => t.replace(/\s*\([^()]*ทีมต้องยืนยัน[^()]*\)/g, '').trim();
  const inBank = items.filter((i) => i.status === 'approved' || i.status === 'applied').sort((a, b) => a.id - b.id)
    .map((i) => ({ ...i, answer: clean(i.answer), rule: i.rule ? clean(i.rule) || null : null }));
  return `ข้อมูลร้าน PkJeans สำหรับตอบแชทลูกค้า (อัปเดต ${date})\n\n${inBank.length ? kbPasteText(inBank) : '(ยังไม่มีคำตอบ)'}\n`;
}

export function serviceEmail(key: string | undefined): string {
  try { return String(JSON.parse(key ?? '').client_email ?? ''); } catch { return ''; }
}

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = ''; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** OAuth access token for the service account (signed JWT → Google's token endpoint). */
async function googleToken(keyJson: string): Promise<string> {
  const key = JSON.parse(keyJson) as { client_email: string; private_key: string };
  const pem = key.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const signKey = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/documents', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signKey, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function docsFetch(token: string, url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 200);
    throw new Error(res.status === 403 || res.status === 404 ? `เปิด Doc ไม่ได้ (${res.status}) — แชร์ Doc ให้ service account เป็นผู้แก้ไขหรือยัง` : `Google Docs ${res.status}: ${t}`);
  }
  return res.json();
}

/** Read-only check that the key works and the Doc is shared with it: returns the Doc's title. */
export async function checkDoc(env: DocEnv): Promise<{ title: string; chars: number }> {
  const s = await loadDocSettings(env.DB);
  if (!s.doc_id) throw new Error('ยังไม่ได้ใส่ลิงก์ Doc');
  if (!env.GOOGLE_SA_KEY) throw new Error('ยังไม่ได้ตั้ง secret GOOGLE_SA_KEY');
  const token = await googleToken(env.GOOGLE_SA_KEY);
  const d = await docsFetch(token, `https://docs.googleapis.com/v1/documents/${s.doc_id}?fields=title,body.content(endIndex)`);
  const content = d.body?.content ?? [];
  return { title: d.title ?? '', chars: Math.max(0, (content[content.length - 1]?.endIndex ?? 1) - 2) };
}

/** Replaces the Doc's whole body with `text`. */
export async function writeDoc(env: DocEnv, text: string): Promise<void> {
  const s = await loadDocSettings(env.DB);
  if (!s.doc_id || !env.GOOGLE_SA_KEY) throw new Error('ยังไม่ได้ตั้ง Doc หรือ GOOGLE_SA_KEY');
  const token = await googleToken(env.GOOGLE_SA_KEY);
  const base = `https://docs.googleapis.com/v1/documents/${s.doc_id}`;
  const d = await docsFetch(token, `${base}?fields=body.content(endIndex)`);
  const content = d.body?.content ?? [];
  const end = content[content.length - 1]?.endIndex ?? 1;
  // The body always ends with one newline that can't be deleted, hence end - 1.
  const requests: unknown[] = end > 2 ? [{ deleteContentRange: { range: { startIndex: 1, endIndex: end - 1 } } }] : [];
  requests.push({ insertText: { location: { index: 1 }, text: text.replace(/\n$/, '') } });
  await docsFetch(token, `${base}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
}
