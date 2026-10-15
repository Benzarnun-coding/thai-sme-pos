// Who may change what. Everyone who gets through Cloudflare Access can read everything; what they can change
// depends on their role in the `users` table (managed on the ผู้ใช้ page by owners):
//   owner  – everything, including users and roles (the people in OWNER_EMAILS are always owners)
//   admin  – everything except users
//   costs  – only costs (web costs, product lines, syncing the cost sheets, Page365 / marketplace money uploads, the product catalog)
//   viewer – read only

export type Role = 'owner' | 'admin' | 'costs' | 'viewer';
export const ROLES: Role[] = ['owner', 'admin', 'costs', 'viewer'];

export function roleOf(email: string, owners: string[], users: Map<string, Role>, costEditors: string[] = []): Role {
  const e = email.trim().toLowerCase();
  if (owners.includes(e)) return 'owner';
  const r = users.get(e);
  if (r) return r;
  if (costEditors.includes(e)) return 'costs';
  return 'viewer';
}

/** Writes a cost editor may make: web costs, product lines (cost, promos), syncing costs from the sheets, order files. */
const COST_WRITES: [string, RegExp][] = [
  ['POST', /^\/api\/costs$/],
  ['DELETE', /^\/api\/costs$/],
  ['POST', /^\/api\/costs\/sync$/],
  ['POST', /^\/api\/campaign-costs\/sync$/],
  ['POST', /^\/api\/sections$/],
  ['PUT', /^\/api\/sections\/[\w-]+$/],
  ['PUT', /^\/api\/actual-sales\/\d{4}-\d{2}-\d{2}$/],
  ['POST', /^\/api\/p365\/upload$/],
  ['POST', /^\/api\/p365\/recredit$/],
  ['POST', /^\/api\/catalog\/sync$/],
  ['POST', /^\/api\/catalog\/web$/],
  ['PUT', /^\/api\/catalog\/web$/],
  ['DELETE', /^\/api\/catalog\/web$/],
  ['POST', /^\/api\/catalog\/image$/],
  ['DELETE', /^\/api\/catalog\/image$/],
  ['PUT', /^\/api\/catalog\/supplier$/],
  ['PUT', /^\/api\/catalog\/price$/],
  ['PUT', /^\/api\/catalog\/sell-price$/],
  ['PUT', /^\/api\/catalog\/label$/],
  ['PUT', /^\/api\/catalog\/alias$/],
  ['PUT', /^\/api\/mp-orders$/],
  ['PUT', /^\/api\/mp-import-map$/],
  ['PUT', /^\/api\/purchase$/],
  ['PUT', /^\/api\/purchase\/missing$/],
  ['PUT', /^\/api\/purchase\/payments$/],
  ['DELETE', /^\/api\/purchase$/],
];

export function canWrite(role: Role, method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') return true;
  const p = path.replace(/\/$/, '');
  if (/^\/api\/users(\/|$)/.test(p)) return role === 'owner';
  if (role === 'owner' || role === 'admin') return true;
  if (role === 'costs') return COST_WRITES.some(([m, re]) => m === method && re.test(p));
  return false;
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'เจ้าของ', admin: 'ผู้ดูแล', costs: 'แก้ต้นทุน', viewer: 'ดูอย่างเดียว' };
