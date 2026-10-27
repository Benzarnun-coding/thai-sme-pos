// When the morning rule run happens (Benz 27 Oct 2026). The Page365 file of yesterday arrives 09:00–12:00, so an
// 08:00 run always judged yesterday by Meta's tags (26 Oct: 258 tagged vs 109 real → six raises that real sales
// don't support). With guardrails.morning_wait on, the morning run waits for the file: it runs at the first
// 10-minute tick after the file is in, or at 13:00 with Meta's numbers if it never came. Off, it runs at 08:00.

import { bkkDate } from './conversionStore.ts';

export type MorningAction = { run: false; why: string } | { run: true; trigger: string };

/** Pure: what a 10-minute morning tick (08:00–13:50 Bangkok) should do. */
export function morningDecision(o: { wait: boolean; now: Date; done: boolean; fileIn: boolean }): MorningAction {
  const t = new Date(o.now.getTime() + 7 * 3_600_000);
  const hour = t.getUTCHours(), minute = t.getUTCMinutes();
  if (o.done) return { run: false, why: 'รอบเช้าวันนี้รันไปแล้ว' };
  if (!o.wait) return hour === 8 && minute < 10 ? { run: true, trigger: 'schedule' } : { run: false, why: 'รอบเช้ารัน 08:00' };
  if (hour < 8) return { run: false, why: 'ยังไม่ถึง 08:00' };
  if (o.fileIn) return { run: true, trigger: 'schedule:ไฟล์ Page365 เมื่อวานเข้าแล้ว ใช้ยอดจริง' };
  if (hour >= 13) return { run: true, trigger: 'schedule:13:00 ไฟล์ Page365 เมื่อวานยังไม่มา ใช้ยอดแท็ก Meta' };
  return { run: false, why: 'รอไฟล์ Page365 ของเมื่อวาน' };
}

/** A scheduled run already happened this Bangkok morning (before 17:00, so the 20:00 run doesn't count). */
export async function morningDone(db: D1Database, now: Date): Promise<boolean> {
  const start = new Date(`${bkkDate(0, now.getTime())}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 17 * 3_600_000);
  const r = await db.prepare(`SELECT 1 AS x FROM runs WHERE trigger LIKE 'schedule%' AND run_at >= ? AND run_at < ? LIMIT 1`)
    .bind(start.toISOString(), end.toISOString()).first<{ x: number }>();
  return !!r;
}

/** Yesterday's (Bangkok) Page365 export is uploaded. */
export async function yesterdayFileIn(db: D1Database, now: Date): Promise<boolean> {
  const r = await db.prepare('SELECT 1 AS x FROM p365_uploads WHERE date = ? LIMIT 1').bind(bkkDate(1, now.getTime())).first<{ x: number }>();
  return !!r;
}
