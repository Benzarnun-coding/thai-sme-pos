// Cloudflare Access decides who can log in: the reusable policy "PkJeans team" holds an email list. With a
// Cloudflare API token (Account → Access: Apps and Policies → Edit) the dashboard keeps that list equal to its
// users, so the ผู้ใช้ page is the only place people are added or removed.

export interface AccessEnv { CF_API_TOKEN?: string; CF_ACCOUNT_ID?: string; CF_ACCESS_POLICY_ID?: string }

export interface AccessStatus {
  configured: boolean;
  policy_name: string | null;
  in_access: string[];
  missing: string[];   // in the dashboard, not yet allowed to log in
  extra: string[];     // allowed to log in, not in the dashboard
  error: string | null;
}

interface Policy { id: string; name: string; decision: string; include: any[]; exclude?: any[]; require?: any[]; session_duration?: string }

const API = 'https://api.cloudflare.com/client/v4';

function ready(env: AccessEnv): env is Required<AccessEnv> {
  return !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.CF_ACCESS_POLICY_ID);
}

async function getPolicy(env: Required<AccessEnv>): Promise<Policy> {
  const res = await fetch(`${API}/accounts/${env.CF_ACCOUNT_ID}/access/policies/${env.CF_ACCESS_POLICY_ID}`, { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(`Cloudflare: ${body?.errors?.[0]?.message ?? res.statusText}`);
  return body.result as Policy;
}

const emailsOf = (p: Policy) => (p.include ?? []).map((r: any) => r?.email?.email).filter((e: unknown): e is string => typeof e === 'string').map((e) => e.toLowerCase());

export async function accessStatus(env: AccessEnv, wanted: string[]): Promise<AccessStatus> {
  if (!ready(env)) return { configured: false, policy_name: null, in_access: [], missing: [], extra: [], error: null };
  try {
    const p = await getPolicy(env);
    const have = emailsOf(p);
    const want = [...new Set(wanted.map((e) => e.toLowerCase()))];
    return { configured: true, policy_name: p.name, in_access: have, missing: want.filter((e) => !have.includes(e)), extra: have.filter((e) => !want.includes(e)), error: null };
  } catch (err: any) {
    return { configured: true, policy_name: null, in_access: [], missing: [], extra: [], error: err?.message ?? String(err) };
  }
}

/** Replaces the policy's email list with `wanted`; other rule kinds in the policy (groups, domains) are kept. */
export async function syncAccess(env: AccessEnv, wanted: string[]): Promise<{ emails: string[] }> {
  if (!ready(env)) throw new Error('ยังไม่ได้ตั้ง CF_API_TOKEN / CF_ACCOUNT_ID / CF_ACCESS_POLICY_ID');
  const p = await getPolicy(env);
  const others = (p.include ?? []).filter((r: any) => !r?.email);
  const emails = [...new Set(wanted.map((e) => e.toLowerCase()))].sort();
  const body = { name: p.name, decision: p.decision, include: [...others, ...emails.map((e) => ({ email: { email: e } }))], exclude: p.exclude ?? [], require: p.require ?? [], ...(p.session_duration ? { session_duration: p.session_duration } : {}) };
  const res = await fetch(`${API}/accounts/${env.CF_ACCOUNT_ID}/access/policies/${env.CF_ACCESS_POLICY_ID}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const out: any = await res.json().catch(() => ({}));
  if (!res.ok || !out.success) throw new Error(`Cloudflare: ${out?.errors?.[0]?.message ?? res.statusText}`);
  return { emails };
}
