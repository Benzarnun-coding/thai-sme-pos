// Work order 2026-11-18 (Max, Benz said "ให้ทำ" 19 Nov): every bill case posted to the order-problems Discord
// channel (autoFill.ts `tell`) is also sent as JSON to the webhook of Max's bot อูนิ, so it needn't read Discord
// every 30 minutes. The Discord post is unchanged and never waits on this.
//
// Ships switched off. It sends only when all three hold: meta_capi key case_forward = 'on' (the switch on the
// order-notes Log tab, owner only) and the secrets UNI_CASE_WEBHOOK_URL (https) + UNI_CASE_WEBHOOK_KEY are set.
// The JSON carries the customer's Facebook name and bill number to a server outside this system — Benz's call.
// Nothing about the customer is stored here: the last result keeps the bill number and the outcome only.

export interface CaseForwardEnv {
  DB: D1Database;
  /** where อูนิ takes bill cases (secret, https) */
  UNI_CASE_WEBHOOK_URL?: string;
  /** sent as-is as the Authorization header: the whole value of the "ส่วนหัว Authorization" box in Max's webhook panel (secret) */
  UNI_CASE_WEBHOOK_KEY?: string;
}

export interface BillCase {
  bill_no: number | null;
  customer_name: string;
  admin_summary: string;
  status_header: string;
  issues: string[];
  posted_at: string;
  /** Not known: the channel webhook doesn't give the message link back. */
  discord_message_url: string | null;
}

export const HEADER_FILLED = 'ใส่บิลให้แล้ว แต่ช่วยเช็กก่อนส่งบิล';
export const HEADER_PERSON = 'บิลนี้ต้องให้คนดู';

/** The same facts as the Discord message, as data. */
export function billCase(a: { billNo: number | null; name: string; noteText: string; reasons: string[]; filled: boolean; at?: string }): BillCase {
  return {
    bill_no: a.billNo,
    customer_name: a.name || 'ไม่ทราบชื่อ',
    admin_summary: a.noteText.replace(/\s+/g, ' ').trim(),
    status_header: a.filled ? HEADER_FILLED : HEADER_PERSON,
    issues: a.reasons.slice(0, 6),
    posted_at: a.at ?? new Date().toISOString(),
    discord_message_url: null,
  };
}

export async function caseForwardOn(db: D1Database): Promise<boolean> {
  const r = await db.prepare("SELECT value FROM meta_capi WHERE key = 'case_forward'").first<{ value: string }>().catch(() => null);
  return r?.value === 'on';
}

export async function setCaseForward(db: D1Database, on: boolean): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('case_forward', ?)").bind(on ? 'on' : 'off').run();
}

export type ForwardResult = 'off' | 'not_set' | 'sent' | 'failed';
export interface ForwardLast { at: string; bill_no: number | null; result: ForwardResult; http: number | null }

const ready = (env: CaseForwardEnv) => /^https:\/\//.test(env.UNI_CASE_WEBHOOK_URL ?? '') && !!env.UNI_CASE_WEBHOOK_KEY;

/** One POST per case, 5 s at most, no retry. Never throws: a webhook that is down must not stop the bill flow. */
export async function forwardCase(env: CaseForwardEnv, c: BillCase, fetcher: typeof fetch = fetch): Promise<ForwardResult> {
  let result: ForwardResult = 'off';
  let http: number | null = null;
  try {
    if (!(await caseForwardOn(env.DB))) return 'off';
    if (!ready(env)) result = 'not_set';
    else {
      const r = await fetcher(env.UNI_CASE_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: env.UNI_CASE_WEBHOOK_KEY!.trim() },
        body: JSON.stringify(c),
        signal: AbortSignal.timeout(5000),
      });
      http = r.status;
      result = r.ok ? 'sent' : 'failed';
    }
  } catch (err) {
    console.error('case forward', (err as Error).message);
    result = 'failed';
  }
  const last: ForwardLast = { at: new Date().toISOString(), bill_no: c.bill_no, result, http };
  await env.DB.prepare("INSERT OR REPLACE INTO meta_capi (key, value) VALUES ('case_forward_last', ?)").bind(JSON.stringify(last)).run().catch(() => null);
  return result;
}

/** For the switch on the Log tab: is it on, are both secrets in, what happened last, and what one case looks like. */
export async function caseForwardStatus(env: CaseForwardEnv): Promise<{ on: boolean; ready: boolean; last: ForwardLast | null; sample: BillCase }> {
  const row = await env.DB.prepare("SELECT value FROM meta_capi WHERE key = 'case_forward_last'").first<{ value: string }>().catch(() => null);
  let last: ForwardLast | null = null;
  try { last = row ? JSON.parse(row.value) : null; } catch { last = null; }
  return {
    on: await caseForwardOn(env.DB),
    ready: ready(env),
    last,
    sample: billCase({ billNo: 33605, name: 'ตัวอย่าง (ไม่ใช่ลูกค้าจริง)', noteText: '501/1 31\ncod 249', reasons: ['501/1 ไม่มีไซส์ 31 — รุ่นนี้มี 28, 29, 30, 32, 34, 36 · ต้องถามลูกค้าใหม่'], filled: false }),
  };
}
