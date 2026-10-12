// Cloudflare Access sits in front of the site and signs every request with a JWT.
// We verify that JWT here too, so the API refuses anything that did not come through Access.

export interface AuthEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_BYPASS_AUTH?: string;
}

type Jwk = JsonWebKey & { kid: string };
let certCache: { url: string; keys: Jwk[]; at: number } | null = null;

/** Returns the signed-in email, or null when the request must be refused. Fails closed when Access is not configured. */
export async function authenticate(req: Request, env: AuthEnv): Promise<string | null> {
  // The dev bypass only works on a local dev server, so a stray production var can't open the site.
  const host = new URL(req.url).hostname;
  if (env.DEV_BYPASS_AUTH === 'true' && (host === 'localhost' || host === '127.0.0.1')) return 'dev@localhost';
  const team = env.ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
  if (!team || !env.ACCESS_AUD) return null;

  const token = req.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header: { kid?: string; alg?: string };
  let payload: { aud?: string | string[]; exp?: number; iss?: string; email?: string };
  try {
    header = JSON.parse(b64urlText(h));
    payload = JSON.parse(b64urlText(p));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;

  const key = (await certs(`${team}/cdn-cgi/access/certs`)).find((k) => k.kid === header.kid);
  if (!key) return null;
  const cryptoKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  if (payload.iss !== team) return null;
  return payload.email ?? 'unknown';
}

async function certs(url: string): Promise<Jwk[]> {
  if (certCache && certCache.url === url && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  certCache = { url, keys: body.keys, at: Date.now() };
  return body.keys;
}

function b64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function b64urlText(s: string): string {
  return new TextDecoder().decode(b64urlBytes(s));
}
