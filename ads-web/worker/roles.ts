// Who may change what. Everyone signed in through Cloudflare Access can read everything; "cost editors"
// (emails listed in settings) may only change costs — nothing that touches Meta, rules, stages or settings.

export type Role = 'admin' | 'costs';

export function roleOf(email: string, costEditors: string[]): Role {
  return costEditors.includes(email.trim().toLowerCase()) ? 'costs' : 'admin';
}

/** Writes a cost editor may make: web costs, product lines (cost, promos), syncing costs from the sheets. */
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
];

export function canWrite(role: Role, method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') return true;
  if (role === 'admin') return true;
  return COST_WRITES.some(([m, re]) => m === method && re.test(path.replace(/\/$/, '')));
}
