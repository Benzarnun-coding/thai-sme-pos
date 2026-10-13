// Discord bot with buttons: heavy rule decisions (pause a campaign, move it down to retest) are posted as a
// question and wait for someone in the channel to press a button. Discord calls /webhook/discord for every
// press (signed with the app's Ed25519 key); budget ±20% still applies on its own.

export interface DiscordEnv {
  DB: D1Database;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_APP_PUBLIC_KEY?: string;
  DISCORD_CHANNEL_ID?: string;
}

export const approvalsEnabled = (env: DiscordEnv) => !!(env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID && env.DISCORD_APP_PUBLIC_KEY);

export interface Proposal {
  id: string; created_at: string; kind: 'pause' | 'move'; entity_id: string; entity_name: string; rule_id: string;
  plan: string; detail: string; status: string; decided_by: string | null; decided_at: string | null; message_id: string | null;
}

/** Ed25519 check of Discord's signature over timestamp + body. */
export async function verifyDiscord(req: Request, body: string, publicKeyHex: string): Promise<boolean> {
  const sig = req.headers.get('X-Signature-Ed25519');
  const ts = req.headers.get('X-Signature-Timestamp');
  if (!sig || !ts) return false;
  const hex = (h: string) => new Uint8Array((h.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
  try {
    const key = await crypto.subtle.importKey('raw', hex(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, hex(sig), new TextEncoder().encode(ts + body));
  } catch {
    return false;
  }
}

const STAGE_TH: Record<string, string> = { experiment: 'ทดลอง', testing: 'ทดสอบ', winning: 'ทำเงิน', retest: 'ดับ → ทดสอบใหม่' };

/** The question as Discord shows it, with the buttons for a pending one. */
export function proposalMessage(p: Proposal): { content: string; components: unknown[] } {
  const d = JSON.parse(p.detail || '{}');
  const what = p.kind === 'pause' ? `⏸ **หยุดแคมเปญ** "${p.entity_name}"` : `↘ **ย้ายกลุ่ม** "${p.entity_name}" ${STAGE_TH[d.move_from] ?? d.move_from ?? 'ไม่มีกลุ่ม'} → ${STAGE_TH[d.move_to] ?? d.move_to}`;
  const content = `❓ **ขออนุมัติ** ${what}\nเหตุผล: \`${p.rule_id}\` ${p.plan.replace(/^(PAUSE|ย้าย) .*?\[/, '[')}\n_กดปุ่มเพื่อตัดสินใจ · ถ้าไม่มีใครกด รอบถัดไปจะถามใหม่_`;
  return {
    content,
    components: [{ type: 1, components: [
      { type: 2, style: 4, label: p.kind === 'pause' ? 'อนุมัติ หยุดเลย' : 'อนุมัติ ย้ายเลย', custom_id: `approve:${p.id}` },
      { type: 2, style: 2, label: 'ไม่ รอ 3 วัน', custom_id: `reject:${p.id}` },
      ...(p.kind === 'pause' ? [{ type: 2, style: 1, label: 'ย้ายไปทดสอบแทน', custom_id: `totesting:${p.id}` }] : []),
    ] }],
  };
}

export async function postProposal(env: DiscordEnv, p: Proposal): Promise<string | null> {
  const res = await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(proposalMessage(p)),
  });
  if (!res.ok) { console.error('discord post', res.status, await res.text()); return null; }
  return ((await res.json()) as { id: string }).id;
}

/** Edit an earlier question (e.g. mark it expired) so its buttons go away. */
export async function editMessage(env: DiscordEnv, messageId: string, content: string): Promise<void> {
  await fetch(`https://discord.com/api/v10/channels/${env.DISCORD_CHANNEL_ID}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, components: [] }),
  }).catch(() => null);
}

export async function saveProposals(db: D1Database, list: Proposal[]): Promise<void> {
  if (!list.length) return;
  await db.prepare(`INSERT INTO proposals (id, created_at, kind, entity_id, entity_name, rule_id, plan, detail, status, message_id)
    SELECT value->>'id', value->>'created_at', value->>'kind', value->>'entity_id', value->>'entity_name', value->>'rule_id', value->>'plan', value->>'detail', 'pending', NULL
    FROM json_each(?)`).bind(JSON.stringify(list)).run();
}

/** Same rule on the same campaign was answered "no" in the last 3 days, or is still waiting: don't ask again. */
export async function recentlyAsked(db: D1Database, since: string): Promise<Set<string>> {
  const { results } = await db.prepare(`SELECT entity_id, rule_id, status FROM proposals WHERE (status = 'rejected' AND decided_at >= ?) OR status = 'pending'`)
    .bind(since).all<{ entity_id: string; rule_id: string; status: string }>();
  return new Set(results.map((r) => `${r.rule_id}:${r.entity_id}`));
}

/** Pending questions older than the new run are closed: the new run asks again if the rule still holds. */
export async function expireOld(env: DiscordEnv, before: string): Promise<void> {
  const { results } = await env.DB.prepare(`SELECT * FROM proposals WHERE status = 'pending' AND created_at < ?`).bind(before).all<Proposal>();
  if (!results.length) return;
  await env.DB.prepare(`UPDATE proposals SET status = 'expired', decided_at = ? WHERE status = 'pending' AND created_at < ?`).bind(new Date().toISOString(), before).run();
  for (const p of results) if (p.message_id) await editMessage(env, p.message_id, `⌛ หมดเวลา (ไม่มีคนกด) — ${p.kind === 'pause' ? 'หยุด' : 'ย้าย'} "${p.entity_name}" · รอบนี้ถามใหม่ถ้ายังเข้าเงื่อนไข`);
}
