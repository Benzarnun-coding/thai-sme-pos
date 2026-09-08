/**
 * Mock Facebook data for demos (page followers, posts with insights, ad insights).
 * Clearly labelled "demo" in connection.display_name and raw_event.source so it is
 * never mistaken for a real sync. Replaced entirely by `pnpm sync:facebook` once a
 * real token is configured.
 */
import type { Db } from './db/client.js';

const POSTS = [
  { d: 1, msg: '👖 ยีนส์ผ้ายืด 4 ตัว 990.- ตกตัวละ 247!\n⭐ ไซส์ 28-44 อ้วนผอมใส่ได้\n🚚 ส่งฟรี + เก็บเงินปลายทาง\nทักแชทสั่งได้เลย', reach: 8800, eng: 640, com: 34, sh: 12, re: 210 },
  { d: 2, msg: '🔥 3 ตัว 700.- ยีนส์ทรงกระบอกเล็ก ผ้ายืด ชิโน่ คละแบบได้\n👖 ไซส์ 28-44 มีครบ\nทักแชทสั่งได้เลย', reach: 12400, eng: 910, com: 58, sh: 21, re: 340 },
  { d: 3, msg: '📣 รับพ่อค้า/แม่ค้า เริ่มต้น 20 ตัว 4,000.- ตกตัวละ 200\n👖 คละแบบ คละไซส์ได้ มากกว่า 40 แบบ\nทักแชทขอแคตตาล็อกได้เลย', reach: 5600, eng: 420, com: 47, sh: 9, re: 120 },
  { d: 5, msg: '👖 ขาสั้นผ้าสี 1 ตัว 189.- / 3 ตัว 499.-\n⭐ ไซส์ 28-44 · สี ดำ กรม เทา\n🚚 เก็บเงินปลายทาง', reach: 7100, eng: 480, com: 22, sh: 8, re: 170 },
  { d: 7, msg: '🔥 โปรเด็ด 1 แถม 1 ยีนส์ฟอก 490.- (2 ตัว)\n👖 ไซส์ 28-44 ครบ\nหมดศุกร์นี้ ทักแชทสั่งได้เลย', reach: 9900, eng: 720, com: 41, sh: 17, re: 260 },
  { d: 9, msg: '👖 ชิโน่สไตล์เกาหลี 199.- / 3 ตัว 550.-\n⭐ ใส่ทำงานได้ ใส่เที่ยวได้ ไซส์ 28-40\n🚚 ส่งฟรีเมื่อซื้อเซ็ต', reach: 4300, eng: 260, com: 12, sh: 4, re: 95 },
  { d: 11, msg: '👖 ยีนส์ทรงกระบอกเล็ก สีดำ 199.-\n⭐ ผ้าหนา ไม่ย้วย ซักไม่ตก ไซส์ 28-44\nทักแชทสั่งได้เลย', reach: 6200, eng: 390, com: 19, sh: 6, re: 140 },
  { d: 13, msg: '🚚 มีบริการเก็บเงินปลายทาง สินค้าพร้อมส่ง เคลมได้\n👖 ยีนส์ชาย มากกว่า 40 แบบ ไซส์ 28-44', reach: 3800, eng: 210, com: 8, sh: 3, re: 70 },
];

const ADS = [
  { id: 'demo-ad-1', name: '[AI][0903-01][A] กระบอกเล็ก · เซ็ต 3 ตัว 550', camp: 'กระบอกเล็ก · ทดสอบ hook', spend: 350, imp: 21000, clicks: 640, conv: 11, buy: 2, unit: 550, days: 7 },
  { id: 'demo-ad-2', name: '[AI][0903-01][B] กระบอกเล็ก · ราคาเดี่ยว 199', camp: 'กระบอกเล็ก · ทดสอบ hook', spend: 300, imp: 19000, clicks: 420, conv: 6, buy: 1, unit: 398, days: 7 },
  { id: 'demo-ad-3', name: '[AI][0904-02][A] ผ้ายืดสปอร์ต · ใส่จริง 3 ส่วนสูง', camp: 'ผ้ายืดสปอร์ต · วิดีโอ', spend: 260, imp: 48000, clicks: 1250, conv: 14, buy: 2, unit: 499, days: 5 },
  { id: 'demo-ad-4', name: '[AI][0902-03][A] ขาสั้นผ้าสี · 3 ตัว 499', camp: 'ขาสั้น · เซ็ต', spend: 180, imp: 6000, clicks: 200, conv: 5, buy: 1, unit: 499, days: 7 },
  { id: 'demo-ad-5', name: '[AI][0901-05][A] ผ้ายืด · คำค้น "ยีนส์เอวสูง"', camp: 'ผ้ายืด · คำค้น (พักแล้ว)', spend: 200, imp: 4000, clicks: 105, conv: 2, buy: 0, unit: 299, days: 4 },
  { id: 'demo-ad-6', name: '[AI][0906-04][A] รับพ่อค้าแม่ค้า 20 ตัว 4,000', camp: 'ขายส่ง · Messenger (วัดที่ inbox)', spend: 120, imp: 7200, clicks: 270, conv: 7, buy: 0, unit: 4000, days: 7 },
];

export async function seedFacebookDemo(db: Db, storeId: string, today: Date) {
  const day = (n: number) => { const x = new Date(today); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const jit = (v: number) => Math.round(v * (0.8 + rnd() * 0.4));

  await db.query('insert into raw_event(store_id, source, kind, payload) values ($1,$2,$3,$4)', [storeId, 'demo', 'facebook_demo_seed', JSON.stringify({ posts: POSTS.length, ads: ADS.length })]);

  for (let n = 13; n >= 0; n--) {
    await db.query(
      `insert into page_snapshot(store_id, channel, date, followers, fans, raw) values ($1,'facebook',$2,$3,$4,$5)
       on conflict (store_id, channel, date) do update set followers=excluded.followers, fans=excluded.fans`,
      [storeId, day(n), 44000 - n * 38, 43100 - n * 30, JSON.stringify({ demo: true })]);
  }

  for (const [i, p] of POSTS.entries()) {
    const created = new Date(today); created.setUTCDate(created.getUTCDate() - p.d); created.setUTCHours(13, 30, 0, 0);
    await db.query(
      `insert into fact_post_insight_daily(store_id, channel, external_post_id, date, created_time, message, permalink, reach, engaged, clicks, comments, shares, reactions, raw)
       values ($1,'facebook',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (channel, external_post_id, date) do update set reach=excluded.reach, engaged=excluded.engaged, comments=excluded.comments`,
      [storeId, `demo-post-${i + 1}`, day(0), created.toISOString(), p.msg, null, p.reach, p.eng, Math.round(p.eng * 0.55), p.com, p.sh, p.re, JSON.stringify({ demo: true })]);
  }

  for (const a of ADS) {
    for (let n = a.days - 1; n >= 0; n--) {
      const spend = jit(a.spend), imp = jit(a.imp), clicks = jit(a.clicks), conv = jit(a.conv), buy = a.buy ? jit(a.buy) : 0;
      await db.query(
        `insert into fact_ad_insight_daily(store_id, channel, external_ad_id, ad_name, campaign_name, date, impressions, reach, clicks, spend, conversations, purchases, revenue, raw)
         values ($1,'facebook',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (channel, external_ad_id, date) do update set spend=excluded.spend, impressions=excluded.impressions, clicks=excluded.clicks, conversations=excluded.conversations, purchases=excluded.purchases, revenue=excluded.revenue`,
        [storeId, a.id, a.name, a.camp, day(n), imp, Math.round(imp * 0.78), clicks, spend, conv, buy, buy * a.unit, JSON.stringify({ demo: true })]);
    }
  }

  await db.query(
    `update connection set status='connected', display_name=$2, external_account_id='demo-page', last_sync_at=now(), token_expires_at=now() + interval '58 days', last_error=null
      where store_id=$1 and channel='facebook'`,
    [storeId, 'กางเกงยีนส์ชาย Climax by PKjeans · ข้อมูล demo (ยังไม่ต่อ token จริง)']);

  return { posts: POSTS.length, ads: ADS.length };
}
