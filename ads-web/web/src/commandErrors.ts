// Which message /command shows when /api/command/summary fails (CommandPage.tsx). Pure, so worker/commandErrors.test.ts runs it.

export const SESSION_EXPIRED = 'เซสชันหมดอายุ ล็อกอินใหม่: โหลดหน้านี้ใหม่';

/** null = `body` is a usable summary; otherwise the message to show. `body` is res.json() or null when that failed. */
export function summaryError(res: Pick<Response, 'status' | 'ok' | 'redirected'>, body: any): string | null {
  // Access session over: Access answers with its login page (HTML, not JSON) or the Worker says 401.
  if (res.status === 401 || res.redirected || (res.ok && !body)) return SESSION_EXPIRED;
  if (!res.ok || !body || body.version !== 1) return String(body?.error ?? `HTTP ${res.status}`);
  return null;
}

/** Message for anything thrown while loading. */
export function thrownError(e: any): string {
  // A redirect to the cross-site Access login fails as TypeError ("Failed to fetch"); retrying never helps, reloading does.
  return e instanceof TypeError ? `${SESSION_EXPIRED} (หรืออินเทอร์เน็ตหลุด)` : String(e?.message ?? e);
}
