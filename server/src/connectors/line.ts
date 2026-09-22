/**
 * LINE Messaging API push — the owner's phone is where approvals and the daily
 * report land. Needs LINE_CHANNEL_ACCESS_TOKEN (Messaging API channel) and
 * LINE_TO (a user, group or room id). Without them every call is a no-op that
 * says so, so the loop never depends on LINE being set up.
 */
export function lineConfigured() { return !!(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_TO); }

export async function notifyLine(text: string, fetchImpl: typeof fetch = fetch): Promise<{ sent: boolean; reason?: string }> {
  if (!lineConfigured()) return { sent: false, reason: 'LINE ยังไม่ได้ตั้งค่า (LINE_CHANNEL_ACCESS_TOKEN, LINE_TO)' };
  const body = { to: process.env.LINE_TO, messages: [{ type: 'text', text: text.slice(0, 4900) }] };
  try {
    const r = await fetchImpl('https://api.line.me/v2/bot/message/push', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }, body: JSON.stringify(body),
    });
    if (!r.ok) return { sent: false, reason: `LINE ${r.status}: ${(await r.text()).slice(0, 200)}` };
    return { sent: true };
  } catch (e) { return { sent: false, reason: (e as Error).message }; }
}

export const appLink = (hash: string) => `${(process.env.APP_URL ?? process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, '')}/#${hash}`;
