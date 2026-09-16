/**
 * Demo competitor ads for the scout.
 *
 * Until the Ad Library connector exists (phase 6) the scout needs something to
 * read. These are plausible jeans-page ads in the market's usual angles, marked
 * source='demo' so they are easy to replace and never mistaken for real data.
 */
import type { Db } from './db/client.js';

const DEMO: { page: string; text: string; hook: string; price: number | null; format: string; daysAgo: number }[] = [
  { page: 'ยีนส์ราคาส่ง 99', text: '🔥 1 แถม 1 ยีนส์ฟอก 2 ตัว 450.- ไซส์ 28-40 ส่งฟรี', hook: 'bogo', price: 450, format: 'image', daysAgo: 2 },
  { page: 'ยีนส์ราคาส่ง 99', text: 'ยีนส์ทรงกระบอก 179.- ตัวเดียวก็ส่ง เก็บเงินปลายทาง', hook: 'single_price', price: 179, format: 'image', daysAgo: 5 },
  { page: 'Denim Bros', text: 'ผ้ายืด 4 ตัว 890.- ใส่สบายทั้งวัน ไซส์ 28-46 อ้วนใส่ได้', hook: 'set_price', price: 890, format: 'video', daysAgo: 1 },
  { page: 'Denim Bros', text: 'รีวิวจริงจากลูกค้า 1,000+ ออเดอร์ ยีนส์ผ้าหนาไม่ย้วย', hook: 'proof', price: null, format: 'carousel', daysAgo: 9 },
  { page: 'กางเกงยีนส์ชาย บางบอน', text: 'ขายส่ง 10 ตัว 1,800.- ตกตัวละ 180 คละแบบได้ รับพ่อค้าแม่ค้า', hook: 'wholesale', price: 1800, format: 'image', daysAgo: 3 },
  { page: 'กางเกงยีนส์ชาย บางบอน', text: 'ชิโน่ 3 ตัว 500.- ส่งฟรี ไซส์ 28-40', hook: 'set_price', price: 500, format: 'image', daysAgo: 12 },
  { page: 'JeansFit Studio', text: 'เลือกไซส์ไม่ถูก? บอกส่วนสูงน้ำหนัก เราจัดให้ เปลี่ยนไซส์ฟรี', hook: 'service', price: null, format: 'video', daysAgo: 4 },
];

export async function seedCompetitors(db: Db, storeId: string, today = new Date()): Promise<number> {
  let n = 0;
  for (const [i, d] of DEMO.entries()) {
    const seen = new Date(today.getTime() - d.daysAgo * 86400000).toISOString().slice(0, 10);
    await db.query(
      `insert into competitor_ad(id, store_id, page_name, ad_text, hook, price_hint, format, first_seen, active, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,true,'demo')
       on conflict (id) do update set ad_text=excluded.ad_text, hook=excluded.hook, price_hint=excluded.price_hint, first_seen=excluded.first_seen`,
      [`${storeId}-demo-comp-${i + 1}`, storeId, d.page, d.text, d.hook, d.price, d.format, seen]);
    n++;
  }
  return n;
}
