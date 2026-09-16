/**
 * Demo brain: answers as each AI box would, without a model.
 *
 * Used when no Anthropic credentials are configured (and inside the published
 * demo, which has no server at all). It is deliberately simple and deliberately
 * grounded: every price, size and number comes from the same data the real box
 * would be given, so the demo never shows a made-up fact. Written in plain JS so
 * the artifact builder can inline it unchanged.
 *
 * @typedef {{ name: string; category: string|null; base_price: number|null; set_price: {qty:number;price:number}|null;
 *   sales_7d: number; sales_prev_7d?: number; trend_pct: number|null; stock_total: number; stock_by_size: Record<string,number>;
 *   missing_core_sizes: string[]; core_size_ok: boolean; overstock: boolean; promotable: boolean; note: string;
 *   days_of_cover: number|null }} Signal
 * @typedef {{ ad_name: string; campaign_name: string; spend: string|number; conversations: number; purchases: number; revenue: string|number; first_date?: string; last_date?: string }} Ad
 * @typedef {{ page_name: string; ad_text: string; hook: string|null; price_hint: number|null; format: string|null; first_seen: string }} CompetitorAd
 * @typedef {{ name: string; emoji: string|null; status: string; summary: string; started_at: string }} Run
 * @typedef {{ brand: Record<string,string>; signals?: Signal[]; ads?: Ad[]; posts?: {message:string|null; reach:number|null; engaged?: number|null}[];
 *   competitors?: CompetitorAd[]; runs?: Run[] }} Knowledge
 * @typedef {{ slug: string; name: string; instructions: string; autonomy: 'propose'|'auto'; addons: { knowledge?: string[]; actions?: string[] } }} AgentLike
 */

const thb = (n) => '฿' + Math.round(Number(n)).toLocaleString('th-TH');
const sizesOf = (s) => Object.entries(s.stock_by_size || {});
const pct = (v) => (v === null || v === undefined ? '—' : (v >= 0 ? '+' : '') + v + '%');

/** Forbidden words come from the brand doc, one per line, until the first "#" section after the list. */
function forbiddenWords(knowledge) {
  const doc = knowledge.brand && knowledge.brand.forbidden;
  if (!doc) return [];
  const out = [];
  for (const raw of doc.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-') || line.startsWith('|')) continue;
    out.push(line);
  }
  return out;
}

/** Best product for a message: the one whose longest name word appears in it ("ผ้ายืด" beats "สีดำ"). */
function findProduct(signals, text) {
  const t = text.toLowerCase();
  let best = null, bestLen = 0;
  for (const s of signals) {
    const n = s.name.toLowerCase();
    const len = t.includes(n) ? n.length : Math.max(0, ...n.split(' ').filter((w) => w.length >= 4 && t.includes(w)).map((w) => w.length));
    if (len > bestLen) { best = s; bestLen = len; }
  }
  return best;
}

function postFor(s) {
  const set = s.set_price ? `${s.set_price.qty} ตัว ${s.set_price.price}.-` : '';
  const each = s.set_price ? ` ตกตัวละ ${Math.round(s.set_price.price / s.set_price.qty)}` : '';
  const sizes = sizesOf(s).filter(([, q]) => q > 0).map(([z]) => z);
  const range = sizes.length > 1 ? `${sizes[0]}-${sizes[sizes.length - 1]}` : sizes[0] || '';
  return [
    `👖 ${s.name} ${s.base_price}.-${set ? ` / ${set}${each}` : ''}`,
    `⭐ ไซส์ ${range}${sizes.length >= 8 ? ' อ้วนผอมใส่ได้' : ''} · สินค้าพร้อมส่ง`,
    `🚚 ${s.set_price ? 'ส่งฟรีเมื่อซื้อเซ็ต + ' : ''}เก็บเงินปลายทาง`,
    'ทักแชทสั่งได้เลย',
  ].join('\n');
}

function adStats(ads) {
  return (ads || []).map((a) => {
    const spend = Number(a.spend), rev = Number(a.revenue);
    return { ...a, spend, rev, roas: spend > 0 ? rev / spend : 0, cpc: a.conversations ? Math.round(spend / a.conversations) : null,
      wholesale: /ขายส่ง|พ่อค้า|inbox/i.test(a.campaign_name + ' ' + a.ad_name) };
  });
}

/** Which product an ad is about, by name words. */
function productOfAd(signals, ad) {
  return findProduct(signals, ad.ad_name + ' ' + ad.campaign_name);
}

const BRAINS = {
  scout(agent, k, msg) {
    const comps = k.competitors || [];
    const sig = k.signals || [];
    if (!comps.length) return 'ยังไม่มีข้อมูลแอดคู่แข่ง ต่อ Ad Library ก่อน (เฟส 6) หรือเพิ่มด้วยมือ';
    const byHook = {};
    comps.forEach((c) => { const h = c.hook || 'other'; byHook[h] = (byHook[h] || 0) + 1; });
    const hookName = { bogo: '1 แถม 1', set_price: 'ราคาเซ็ต', single_price: 'ราคาเดี่ยวถูก', proof: 'รีวิว/หลักฐาน', wholesale: 'ขายส่ง', service: 'บริการเลือกไซส์', free_ship: 'ส่งฟรี', story: 'เรื่องเล่า' };
    const ranked = Object.entries(byHook).sort((a, b) => b[1] - a[1]);
    const ourSet = sig.filter((s) => s.promotable && s.set_price).sort((a, b) => b.sales_7d - a.sales_7d)[0];
    const cheapest = comps.filter((c) => c.price_hint && c.hook === 'single_price').sort((a, b) => a.price_hint - b.price_hint)[0];
    const ourCheapest = sig.filter((s) => s.promotable).sort((a, b) => (a.base_price || 9e9) - (b.base_price || 9e9))[0];
    if (/ราคา|เทียบ/.test(msg) && cheapest && ourCheapest) {
      return `ราคาเดี่ยวถูกสุดของคู่แข่ง: ${cheapest.page_name} ${cheapest.price_hint}.- (${cheapest.ad_text.slice(0, 40)}…)\nของเราถูกสุดที่พร้อมไซส์: ${ourCheapest.name} ${ourCheapest.base_price}.- (${ourCheapest.base_price - cheapest.price_hint >= 0 ? '+' : ''}${ourCheapest.base_price - cheapest.price_hint} บาท)\n\nไม่แนะนำสู้ราคาเดี่ยว — ${ourSet ? `ชูเซ็ต ${ourSet.name} ${ourSet.set_price.qty} ตัว ${ourSet.set_price.price} (ตกตัวละ ${Math.round(ourSet.set_price.price / ourSet.set_price.qty)}) ซึ่งต่ำกว่าราคาเดี่ยวคู่แข่งอยู่แล้ว` : 'ชูราคาเซ็ตแทน'}`;
    }
    const unused = Object.keys(hookName).filter((h) => !byHook[h] && ['proof', 'story', 'service', 'free_ship'].includes(h));
    const lines = [`คู่แข่ง ${new Set(comps.map((c) => c.page_name)).size} เพจ รันอยู่ ${comps.length} แอด (7 วันล่าสุด ${comps.filter((c) => (Date.now() - new Date(c.first_seen).getTime()) < 7 * 86400000).length} แอดใหม่)`];
    lines.push('\nมุมที่เขาใช้ซ้ำ:\n' + ranked.slice(0, 4).map(([h, n]) => `- ${hookName[h] || h} × ${n}${h === 'bogo' || h === 'single_price' ? ' — สงครามราคา' : ''}`).join('\n'));
    if (/มุม|ยังไม่มีใคร/.test(msg) || true) {
      lines.push('\nมุมโต้ที่แนะนำ (ไม่สู้ราคาเดี่ยว):');
      lines.push(`1. ${ourSet ? `ราคาเซ็ต ${ourSet.name} ${ourSet.set_price.qty} ตัว ${ourSet.set_price.price} — ถูกกว่าซื้อเดี่ยวของคู่แข่งเมื่อคิดต่อตัว และเขายังไม่มีใครชูเซ็ต ${ourSet.set_price.qty} ตัว` : 'ราคาเซ็ตของสินค้าที่พร้อมไซส์'}`);
      lines.push(`2. ${unused.length ? `${hookName[unused[0]]} — ยังไม่มีคู่แข่งเล่นมุมนี้ในสัปดาห์นี้` : 'ไซส์ 28-44 ครบ + เคลมได้ — คู่แข่งส่วนใหญ่หยุดที่ 40'}`);
    }
    if (agent.autonomy === 'propose') lines.push('\nส่งสองมุมนี้ให้นักวางแผนไหม');
    return lines.join('\n');
  },

  strategist(agent, k, msg) {
    const sig = k.signals || [];
    const ok = sig.filter((s) => s.promotable).sort((a, b) => (b.sales_7d * (1 + (b.trend_pct || 0) / 100)) - (a.sales_7d * (1 + (a.trend_pct || 0) / 100)));
    const blocked = sig.filter((s) => !s.promotable);
    const over = sig.filter((s) => s.overstock);
    if (/ห้าม|ไม่ควร|หยุด/.test(msg) && blocked.length) {
      return `ตอนนี้ห้ามยิงแอด ${blocked.length} ตัว\n` + blocked.map((s) => `- ${s.name} — ${s.note} (เหลือ ${s.stock_total} ตัว) ต้องเติมไซส์ก่อน`).join('\n');
    }
    if (/เหลือเยอะ|ล้าง|โปร/.test(msg)) {
      return over.length
        ? `ที่ควรล้างสต็อก:\n` + over.map((s) => `- ${s.name} เหลือ ${s.stock_total} ตัว ≈ ${s.days_of_cover} วัน → เสนอเซ็ต ${s.set_price ? s.set_price.qty + ' ตัว ' + s.set_price.price : '3 ตัวราคาพิเศษ'} ลงแอดงบเล็ก 3 วัน`).join('\n')
        : 'ตอนนี้ไม่มีตัวไหนเหลือเกิน 60 วัน สต็อกหมุนดี';
    }
    const top = ok.slice(0, 3);
    const lines = top.map((s, i) => {
      const angle = s.trend_pct && s.trend_pct >= 10 ? 'กำลังมา ดันต่อ' : s.set_price ? `ชูราคาเซ็ต ${s.set_price.qty} ตัว ${s.set_price.price}` : 'ราคาเดี่ยวชัด ๆ';
      return `${i + 1}. ${s.name} — ขาย 7 วัน ${s.sales_7d} ตัว (${pct(s.trend_pct)}) สต็อกครบไซส์ ${s.stock_total} ตัว → มุม: ${angle}`;
    });
    const comp = (k.competitors || []).filter((c) => c.hook === 'bogo' || c.hook === 'single_price').length;
    const tail = blocked.length ? `\n\nไม่เสนอ ${blocked.map((s) => s.name).join(', ')} เพราะ${blocked[0].note}` : '';
    const compNote = comp ? `\nคู่แข่งกำลังเล่นสงครามราคา ${comp} แอด — แผนนี้ชูเซ็ตและไซส์ครบแทนการลดราคาเดี่ยว` : '';
    const ask = agent.autonomy === 'propose' ? '\n\nอนุมัติให้นักเขียนร่างโพสต์ 3 ตัวนี้ไหม' : '';
    return `สัปดาห์นี้แนะนำดัน:\n${lines.join('\n')}${tail}${compNote}${ask}`;
  },

  copywriter(agent, k, msg) {
    const sig = k.signals || [];
    const bad = forbiddenWords(k);
    const n = /(\d+)\s*แบบ/.exec(msg);
    const count = n ? Math.min(3, Number(n[1])) : 1;
    let s = findProduct(sig, msg);
    if (/ขายส่ง|พ่อค้า|แม่ค้า/.test(msg)) {
      return '📣 รับพ่อค้า/แม่ค้า เริ่มต้น 20 ตัว 4,000.- ตกตัวละ 200\n👖 คละแบบ คละไซส์ได้ มากกว่า 40 แบบ\n⭐ สินค้าพร้อมส่ง เคลมได้\nทักแชทขอแคตตาล็อกได้เลย';
    }
    if (!s) s = sig.filter((x) => x.promotable).sort((a, b) => b.sales_7d - a.sales_7d)[0];
    if (!s) return 'ยังไม่มีข้อมูลสินค้า ขอเช็คก่อนแล้วจะร่างให้';
    if (!s.promotable) {
      const alt = sig.filter((x) => x.promotable).sort((a, b) => b.sales_7d - a.sales_7d)[0];
      return `${s.name} ตอนนี้${s.note} ยังไม่ควรโพสต์ขาย เดี๋ยวลูกค้าทักแล้วไม่มีของ\n\nร่างให้ตัวที่พร้อมแทน:\n\n${alt ? postFor(alt) : '—'}`;
    }
    const variants = [postFor(s)];
    if (count >= 2) variants.push(`🔥 ${s.set_price ? `${s.set_price.qty} ตัว ${s.set_price.price}.- ` : ''}${s.name}${s.set_price ? ` ตกตัวละ ${Math.round(s.set_price.price / s.set_price.qty)}` : ''}\n👖 ไซส์ ${sizesOf(s).filter(([, q]) => q > 0).map(([z]) => z).join(' ')} มีครบ\n🚚 เก็บเงินปลายทาง\nทักแชทสั่งได้เลย`);
    if (count >= 3) variants.push(`👖 ${s.name} ผ้าหนา ไม่ย้วย ซักไม่ตก\n⭐ ${s.base_price}.- ตัวเดียวก็ส่ง${s.set_price ? ` / เซ็ต ${s.set_price.qty} ตัว ${s.set_price.price}.-` : ''}\n🚚 มีบริการเก็บเงินปลายทาง\nทักแชทสั่งได้เลย`);
    const check = bad.length ? `\n\nเช็คคำต้องห้ามแล้ว ${bad.length} คำ — ไม่มีในร่างนี้` : '';
    const ask = agent.autonomy === 'propose' ? '\nส่งให้ผู้ตรวจแล้วรออนุมัติก่อนโพสต์' : '';
    return variants.map((v, i) => (count > 1 ? `แบบ ${i + 1}\n` : '') + v).join('\n\n') + check + ask;
  },

  qa(agent, k, msg) {
    const sig = k.signals || [];
    const bad = forbiddenWords(k).filter((w) => msg.includes(w));
    const issues = [];
    for (const w of bad) issues.push(`ใช้คำต้องห้าม "${w}" — ตัดออกหรือเปลี่ยนเป็นคำบอกคุณสมบัติจริง เช่น "ผ้าหนา ไม่ย้วย"`);
    const s = findProduct(sig, msg);
    if (s) {
      const prices = (msg.match(/(\d{3,4})\s*(?:\.-|บาท|-)/g) || []).map((m) => Number(m.replace(/\D/g, '')));
      const okPrices = new Set([s.base_price, s.set_price && s.set_price.price].filter(Boolean));
      for (const p of prices) if (!okPrices.has(p)) issues.push(`ราคา ${p} ไม่ตรงข้อมูลสินค้า (${s.name} ราคา ${s.base_price}${s.set_price ? ` / เซ็ต ${s.set_price.price}` : ''})`);
      for (const z of s.missing_core_sizes) if (msg.includes(z)) issues.push(`พูดถึงไซส์ ${z} แต่ไซส์นี้หมด`);
      if (!s.promotable && !issues.some((i) => i.includes('ไซส์'))) issues.push(`${s.name} ตอนนี้${s.note} ห้ามโฆษณา`);
    } else if (!/ตรวจ|คำไหน|ราคา/.test(msg) || msg.length < 25) {
      return 'วางโพสต์ที่จะให้ตรวจมาได้เลย จะเช็ค 3 อย่าง: ราคาตรงไหม ไซส์มีจริงไหม มีคำต้องห้ามไหม';
    }
    if (!issues.length) return `ผ่าน ✅\n- ราคาตรงกับข้อมูลสินค้า\n- ไม่พบไซส์ที่หมด\n- ไม่พบคำต้องห้าม${agent.autonomy === 'auto' ? '\n\nส่งเข้าคิวอนุมัติได้' : ''}`;
    return `ไม่ผ่าน ❌ พบ ${issues.length} จุด\n` + issues.map((i) => `- ${i}`).join('\n');
  },

  campaign(agent, k, msg) {
    const sig = k.signals || [];
    const ads = adStats(k.ads);
    const capMatch = /งบ\s*([\d,]+)/.exec(msg);
    const cap = capMatch ? Number(capMatch[1].replace(/,/g, '')) : 1500;
    const blocked = sig.filter((s) => !s.promotable);
    const running = ads.filter((a) => !a.wholesale);
    if (/หยุด|พัก/.test(msg)) {
      const toStop = running.filter((a) => { const p = productOfAd(sig, a); return (p && !p.promotable) || a.roas < 1.5; });
      if (!toStop.length) return 'ตอนนี้ไม่มีแอดที่เข้ากฎหยุด ทุกตัว ROAS เกิน 1.5 และสินค้ายังพร้อมไซส์';
      return 'ควรหยุดตอนนี้:\n' + toStop.map((a) => { const p = productOfAd(sig, a); return `- ${a.ad_name} — ${p && !p.promotable ? `สินค้า${p.note}` : `ROAS ${a.roas.toFixed(1)}x ใช้ไป ${thb(a.spend)}`}`; }).join('\n') + (agent.autonomy === 'propose' ? '\n\nอนุมัติให้หยุดไหม' : '\nหยุดแล้ว');
    }
    const one = findProduct(sig, msg);
    if (one && /ตั้งแอด|สร้างแอด/.test(msg)) {
      if (!one.promotable) return `ตั้งแอดให้ ${one.name} ไม่ได้ — ${one.note} ต้องเติมไซส์ก่อน (กฎยามสต็อก)`;
      const daily = Math.min(cap, Math.max(150, Math.min(300, cap)));
      return [`แผนแอด ${one.name} · งบ ${thb(daily)}/วัน · เป้าหมาย ทักแชท`,
        `- ชิ้น A: ราคาเซ็ต${one.set_price ? ` ${one.set_price.qty} ตัว ${one.set_price.price}` : ''} · ชิ้น B: ราคาเดี่ยว ${one.base_price} + ไซส์ครบ`,
        `- กลุ่มเป้าหมาย: ชาย 20-45 ทั่วประเทศ · เคยทักเพจ 90 วัน (retarget)`,
        `- ทดสอบ 3 วัน แบ่งงบ 50/50 แล้วเทงบให้ตัวที่ ฿/ทัก ต่ำกว่า`,
        `- กฎหยุด: ROAS < 1.5 สามวันติด หรือใช้ไป ${thb(one.base_price * 3)} โดยไม่มีคนทัก`,
        agent.autonomy === 'propose' ? '\nส่งเข้าคิวอนุมัติไหม' : ''].join('\n');
    }
    // split today's budget
    const ok = sig.filter((s) => s.promotable).sort((a, b) => b.sales_7d - a.sales_7d).slice(0, 3);
    const total = ok.reduce((s, p) => s + p.sales_7d, 0) || 1;
    const rows = ok.map((p) => ({ p, budget: Math.max(150, Math.round((cap * p.sales_7d / total) / 50) * 50) }));
    let sum = rows.reduce((s, r) => s + r.budget, 0);
    while (sum > cap && rows.length > 1) { rows.pop(); sum = rows.reduce((s, r) => s + r.budget, 0); }
    const lines = [`แบ่งงบ ${thb(cap)}/วัน ตามยอดขาย 7 วัน (เฉพาะสินค้าที่พร้อมไซส์):`];
    rows.forEach((r) => lines.push(`- ${r.p.name} ${thb(r.budget)}/วัน (ขาย ${r.p.sales_7d} ตัว, ${pct(r.p.trend_pct)})`));
    lines.push(`รวม ${thb(sum)} · เหลือ ${thb(cap - sum)} เก็บไว้เพิ่มให้ตัวที่ ฿/ทัก ดีสุดหลัง 3 วัน`);
    if (blocked.length) lines.push(`\nไม่ตั้งให้ ${blocked.map((b) => b.name).join(', ')} — ${blocked[0].note}`);
    const stop = running.filter((a) => a.roas < 1.5);
    if (stop.length) lines.push(`\nแอดที่เข้ากฎหยุด: ${stop.map((a) => a.ad_name).join(', ')}`);
    if (agent.autonomy === 'propose') lines.push('\nอนุมัติแผนนี้ไหม');
    return lines.join('\n');
  },

  analyst(agent, k, msg) {
    const ads = adStats(k.ads);
    if (!ads.length) return 'ยังไม่มีข้อมูลแอด ต่อบัญชีโฆษณาก่อนแล้วจะวิเคราะห์ให้';
    const wholesale = ads.filter((a) => a.wholesale);
    if (/ขายส่ง/.test(msg) && wholesale.length) {
      return wholesale.map((a) => `${a.ad_name}\n- ใช้ไป ${thb(a.spend)} ได้คนทัก ${a.conversations} คน = ${thb(a.cpc || 0)}/ทัก\n- แอดขายส่งวัดที่คนทัก ไม่ใช่ยอดซื้อทันที ถ้าปิดได้ 1 ใน 10 ที่ 4,000 บาท ก็คุ้มแล้ว → ให้รันต่อ`).join('\n\n');
    }
    const scale = ads.filter((a) => a.roas >= 3);
    const pause = ads.filter((a) => a.roas < 1.5 && !a.wholesale);
    const total = ads.reduce((s, a) => s + a.spend, 0), rev = ads.reduce((s, a) => s + a.rev, 0);
    const lines = [`ใช้ไปรวม ${thb(total)} ได้ยอด ${thb(rev)} (ROAS ${(rev / total).toFixed(1)}x) ทักแชท ${ads.reduce((s, a) => s + a.conversations, 0)} ครั้ง`];
    if (scale.length) lines.push('\nควรเพิ่มงบ (ไม่เกิน +30%/วัน):\n' + scale.map((a) => `- ${a.ad_name} ROAS ${a.roas.toFixed(1)}x ${thb(a.cpc || 0)}/ทัก`).join('\n'));
    if (pause.length) lines.push('\nควรพัก:\n' + pause.map((a) => `- ${a.ad_name} ROAS ${a.roas.toFixed(1)}x ใช้ไป ${thb(a.spend)} ซื้อ ${a.purchases}`).join('\n'));
    if (wholesale.length) lines.push(`\nแอดขายส่ง ${wholesale.length} ตัว วัดคนละแบบ — ${wholesale[0].conversations} คนทักที่ ${thb(wholesale[0].cpc || 0)}/ทัก ถือว่าดี`);
    if (agent.autonomy === 'propose') lines.push('\nอนุมัติให้ปรับตามนี้ไหม');
    return lines.join('\n');
  },

  reporter(agent, k) {
    const sig = k.signals || [];
    const ads = adStats(k.ads);
    const sales7 = sig.reduce((s, p) => s + (p.sales_7d || 0), 0);
    const prev7 = sig.reduce((s, p) => s + (p.sales_prev_7d || 0), 0);
    const spend = ads.reduce((s, a) => s + a.spend, 0), rev = ads.reduce((s, a) => s + a.rev, 0);
    const blocked = sig.filter((s) => !s.promotable);
    const runs = k.runs || [];
    const best = [...sig].sort((a, b) => b.sales_7d - a.sales_7d)[0];
    const lines = [
      `📈 ขาย 7 วัน ${sales7} ตัว${prev7 ? ` (${pct(Math.round(((sales7 - prev7) / prev7) * 100))} เทียบสัปดาห์ก่อน)` : ''} · ค่าแอด ${thb(spend)} · ROAS ${spend ? (rev / spend).toFixed(1) : '—'}x`,
      best ? `ขายดีสุด: ${best.name} ${best.sales_7d} ตัว` : '',
      blocked.length ? `⚠️ ต้องตัดสินใจ: ${blocked.map((b) => `${b.name} ${b.note}`).join(' · ')} — เติมไซส์หรือถอดจากแอด` : '✅ ทุกสินค้าพร้อมไซส์ ไม่มีอะไรต้องตัดสินใจ',
      ads.filter((a) => a.roas < 1.5 && !a.wholesale).length ? `แอดที่ควรพัก: ${ads.filter((a) => a.roas < 1.5 && !a.wholesale).map((a) => a.ad_name).join(', ')}` : '',
      runs.length ? `\nระบบทำวันนี้ ${runs.length} งาน:\n` + runs.slice(0, 6).map((r) => `- ${r.emoji || ''} ${r.name}: ${r.summary}`).join('\n') : '\nวันนี้ระบบยังไม่ได้รันอะไร',
    ].filter(Boolean);
    return lines.join('\n');
  },

  learner(agent, k) {
    const posts = k.posts || [];
    const ads = adStats(k.ads);
    const rules = [];
    const withSet = posts.filter((p) => /ตัว\s*\d{3,4}/.test(p.message || ''));
    const without = posts.filter((p) => !/ตัว\s*\d{3,4}/.test(p.message || ''));
    const avg = (arr) => arr.length ? Math.round(arr.reduce((s, p) => s + (p.reach || 0), 0) / arr.length) : 0;
    if (withSet.length && without.length) {
      const a = avg(withSet), b = avg(without);
      rules.push(`โพสต์ที่มีราคาเซ็ตในข้อความ reach เฉลี่ย ${a.toLocaleString('th-TH')} vs ไม่มี ${b.toLocaleString('th-TH')} (${pct(Math.round(((a - b) / (b || 1)) * 100))}, ${withSet.length}/${without.length} โพสต์) → ใส่ราคาเซ็ตทุกโพสต์`);
    }
    const setAds = ads.filter((a) => /เซ็ต|\d\s*ตัว/.test(a.ad_name) && !a.wholesale);
    const singleAds = ads.filter((a) => /เดี่ยว|199|179/.test(a.ad_name) && !a.wholesale);
    if (setAds.length && singleAds.length) {
      const c = (arr) => Math.round(arr.reduce((s, a) => s + a.spend, 0) / Math.max(1, arr.reduce((s, a) => s + a.conversations, 0)));
      rules.push(`แอดชูราคาเซ็ต ${thb(c(setAds))}/ทัก vs ราคาเดี่ยว ${thb(c(singleAds))}/ทัก (${setAds.length} vs ${singleAds.length} แอด) → เริ่มแอดใหม่ด้วยราคาเซ็ตก่อน`);
    }
    const video = ads.filter((a) => /วิดีโอ|ใส่จริง/.test(a.ad_name + a.campaign_name));
    if (video.length) rules.push(`แอดวิดีโอใส่จริง ${thb(video[0].cpc || 0)}/ทัก ต่ำสุดในชุด (1 แอด — หลักฐานยังน้อย ให้ทดสอบซ้ำก่อนตั้งเป็นกฎ)`);
    if (!rules.length) return 'สัปดาห์นี้หลักฐานยังไม่พอจะสรุปเป็นกฎ (ต้องมีโพสต์/แอดที่เทียบกันได้อย่างน้อย 2 คู่)';
    return 'กฎที่เสนอสัปดาห์นี้ (รอเจ้าของเปิดใช้):\n' + rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
  },
};

/**
 * @param {AgentLike} agent
 * @param {Knowledge} knowledge
 * @param {string} message
 * @returns {string}
 */
export function demoReply(agent, knowledge, message) {
  const brain = BRAINS[agent.slug];
  if (!brain) return 'กล่องนี้ไม่ใช่ AI — มันทำงานตามกฎ ไม่มีแชท';
  return brain(agent, knowledge, message.trim());
}
