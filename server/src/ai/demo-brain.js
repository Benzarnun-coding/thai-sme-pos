/**
 * Demo brain: answers as each assistant would, without a model.
 *
 * Used when no Anthropic credentials are configured (and inside the published
 * demo, which has no server at all). It is deliberately simple and deliberately
 * grounded: every price, size and number comes from the same data the real
 * assistant would be given, so the demo never shows a made-up fact. Written in
 * plain JS so the artifact builder can inline it unchanged.
 *
 * @typedef {{ name: string; category: string|null; base_price: number|null; set_price: {qty:number;price:number}|null;
 *   sales_7d: number; trend_pct: number|null; stock_total: number; stock_by_size: Record<string,number>;
 *   missing_core_sizes: string[]; core_size_ok: boolean; overstock: boolean; promotable: boolean; note: string;
 *   days_of_cover: number|null }} Signal
 * @typedef {{ ad_name: string; campaign_name: string; spend: string|number; conversations: number; purchases: number; revenue: string|number }} Ad
 * @typedef {{ brand: Record<string,string>; signals?: Signal[]; ads?: Ad[]; posts?: {message:string|null; reach:number|null}[] }} Knowledge
 * @typedef {{ slug: string; name: string; instructions: string; autonomy: 'propose'|'auto'; addons: { knowledge?: string[]; actions?: string[] } }} AgentLike
 */

const thb = (n) => '฿' + Math.round(Number(n)).toLocaleString('th-TH');
const sizesOf = (s) => Object.entries(s.stock_by_size || {});

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

/** Size guess from height/weight, matching the sizes.md table (weight is what decides). */
function sizeFor(weight) {
  if (weight < 52) return '28';
  if (weight < 60) return '30';
  if (weight < 68) return '32';
  if (weight < 76) return '34';
  if (weight < 84) return '36';
  if (weight < 92) return '38';
  if (weight < 100) return '40';
  if (weight < 108) return '42';
  return '44';
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

const BRAINS = {
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
      return `${i + 1}. ${s.name} — ขาย 7 วัน ${s.sales_7d} ตัว (${s.trend_pct === null ? '—' : (s.trend_pct >= 0 ? '+' : '') + s.trend_pct + '%'}) สต็อกครบไซส์ ${s.stock_total} ตัว → มุม: ${angle}`;
    });
    const tail = blocked.length ? `\n\nไม่เสนอ ${blocked.map((s) => s.name).join(', ')} เพราะ${blocked[0].note}` : '';
    const ask = agent.autonomy === 'propose' ? '\n\nอนุมัติให้นักเขียนร่างโพสต์ 3 ตัวนี้ไหม' : '';
    return `สัปดาห์นี้แนะนำดัน:\n${lines.join('\n')}${tail}${ask}`;
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
    if (!issues.length) return `ผ่าน ✅\n- ราคาตรงกับข้อมูลสินค้า\n- ไม่พบไซส์ที่หมด\n- ไม่พบคำต้องห้าม${agent.autonomy === 'auto' ? '\n\nส่งเข้าคิวโพสต์ได้' : ''}`;
    return `ไม่ผ่าน ❌ พบ ${issues.length} จุด\n` + issues.map((i) => `- ${i}`).join('\n');
  },

  analyst(agent, k, msg) {
    const ads = (k.ads || []).map((a) => {
      const spend = Number(a.spend), rev = Number(a.revenue);
      return { ...a, spend, rev, roas: spend > 0 ? rev / spend : 0, cpc: a.conversations ? Math.round(spend / a.conversations) : null };
    });
    if (!ads.length) return 'ยังไม่มีข้อมูลแอด ต่อบัญชีโฆษณาก่อนแล้วจะวิเคราะห์ให้';
    const wholesale = ads.filter((a) => /ขายส่ง|พ่อค้า|inbox/i.test(a.campaign_name + a.ad_name));
    if (/ขายส่ง/.test(msg) && wholesale.length) {
      return wholesale.map((a) => `${a.ad_name}\n- ใช้ไป ${thb(a.spend)} ได้คนทัก ${a.conversations} คน = ${thb(a.cpc || 0)}/ทัก\n- แอดขายส่งวัดที่คนทัก ไม่ใช่ยอดซื้อทันที ถ้าปิดได้ 1 ใน 10 ที่ 4,000 บาท ก็คุ้มแล้ว → ให้รันต่อ`).join('\n\n');
    }
    const scale = ads.filter((a) => a.roas >= 3);
    const pause = ads.filter((a) => a.roas < 1.5 && !wholesale.includes(a));
    const total = ads.reduce((s, a) => s + a.spend, 0), rev = ads.reduce((s, a) => s + a.rev, 0);
    const lines = [`ใช้ไปรวม ${thb(total)} ได้ยอด ${thb(rev)} (ROAS ${(rev / total).toFixed(1)}x) ทักแชท ${ads.reduce((s, a) => s + a.conversations, 0)} ครั้ง`];
    if (scale.length) lines.push('\nควรเพิ่มงบ (ไม่เกิน +30%/วัน):\n' + scale.map((a) => `- ${a.ad_name} ROAS ${a.roas.toFixed(1)}x ${thb(a.cpc || 0)}/ทัก`).join('\n'));
    if (pause.length) lines.push('\nควรพัก:\n' + pause.map((a) => `- ${a.ad_name} ROAS ${a.roas.toFixed(1)}x ใช้ไป ${thb(a.spend)} ซื้อ ${a.purchases}`).join('\n'));
    if (wholesale.length) lines.push(`\nแอดขายส่ง ${wholesale.length} ตัว วัดคนละแบบ — ${wholesale[0].conversations} คนทักที่ ${thb(wholesale[0].cpc || 0)}/ทัก ถือว่าดี`);
    if (agent.autonomy === 'propose') lines.push('\nอนุมัติให้ปรับตามนี้ไหม');
    return lines.join('\n');
  },

  chat(agent, k, msg) {
    const sig = k.signals || [];
    const polite = /ค่ะ/.test(agent.instructions) ? 'ค่ะ' : 'ครับ';
    const hw = /(\d{3})\s*(?:หนัก|\/|,|\s)\s*(\d{2,3})/.exec(msg.replace(/สูง|น้ำหนัก|กก|ซม|cm|kg/g, ' '));
    if (hw) {
      const z = sizeFor(Number(hw[2]));
      const next = String(Number(z) + 2);
      const has = sig.filter((s) => (s.stock_by_size || {})[z] > 0).slice(0, 2);
      return `สูง ${hw[1]} หนัก ${hw[2]} แนะนำไซส์ ${z} ${polite} ถ้าชอบหลวมเลือก ${next} ได้\n${has.length ? `ไซส์ ${z} ตอนนี้มีใน ${has.map((s) => s.name).join(' และ ')} สนใจทรงไหน${polite}` : `ขอเช็คสต็อกไซส์ ${z} ก่อน${polite}`}`;
    }
    if (/ปลายทาง|cod|ส่งกี่วัน|ส่งฟรี/i.test(msg)) {
      return `เก็บเงินปลายทางได้${polite} ส่งทุกวัน ปกติถึงใน 1-3 วัน${polite} ซื้อเป็นเซ็ตส่งฟรี${polite} รับทรงไหน ไซส์อะไรดี${polite}`;
    }
    const s = findProduct(sig, msg);
    if (s) {
      const z = /\b(2[68]|3[02468]|4[024]|FS)\b/.exec(msg);
      if (z) {
        const q = (s.stock_by_size || {})[z[1]] || 0;
        if (q > 0) return `${s.name} ไซส์ ${z[1]} ${q < 6 ? `เหลือ ${q} ตัวสุดท้าย` : 'มี'}${polite} ราคา ${s.base_price}.-${s.set_price ? ` หรือเซ็ต ${s.set_price.qty} ตัว ${s.set_price.price}.- ส่งฟรี` : ''} รับกี่ตัว${polite}`;
        const alt = sizesOf(s).filter(([, q2]) => q2 > 0).map(([zz]) => zz);
        return `${s.name} ไซส์ ${z[1]} หมดพอดี${polite} ตอนนี้มี ${alt.join(' ')} หรือดูทรงอื่นไซส์ ${z[1]} ให้ไหม${polite}`;
      }
      return `${s.name} ราคา ${s.base_price}.-${s.set_price ? ` เซ็ต ${s.set_price.qty} ตัว ${s.set_price.price}.- ส่งฟรี` : ''} มีไซส์ ${sizesOf(s).filter(([, q]) => q > 0).map(([zz]) => zz).join(' ')}${polite} ใส่ไซส์อะไร${polite}`;
    }
    if (/เคลม|เปลี่ยน|ลดหน่อย|ลดได้/.test(msg)) return `เดี๋ยวให้แอดมินติดต่อกลับเรื่องนี้${polite} ขอเบอร์หรือทักไว้ตรงนี้ได้เลย${polite}`;
    return `สวัสดี${polite} สนใจทรงไหนอยู่${polite} บอกส่วนสูง น้ำหนัก มาได้เลย เดี๋ยวแนะนำไซส์ให้${polite}`;
  },

  wholesale(agent, k, msg) {
    const sig = (k.signals || []).filter((s) => s.promotable);
    const n = /(\d{2,3})\s*ตัว/.exec(msg);
    if (/แคตตาล็อก|แคตาล็อก|ดูแบบ/.test(msg)) {
      return `แบบที่พร้อมส่งครบไซส์ตอนนี้:\n` + sig.map((s) => `- ${s.name} · ไซส์ ${sizesOf(s).filter(([, q]) => q > 0).map(([z]) => z).join(' ')}`).join('\n') + `\n\nขายส่งเริ่ม 20 ตัว 4,000.- คละแบบคละไซส์ได้ ขายที่ไหนอยู่ครับ จะแนะนำแบบที่ขายง่าย`;
    }
    if (n) {
      const qty = Number(n[1]);
      if (qty > 50) return `${qty} ตัว เป็นออเดอร์ใหญ่ครับ ขอให้เจ้าของคุยราคาพิเศษให้โดยตรง ขอเบอร์ติดต่อไว้ได้เลยครับ`;
      const perSet = Math.floor(qty / 20);
      const mix = sig.slice(0, 3).map((s) => s.name);
      return `${qty} ตัว = ${thb(qty * 200)} ตกตัวละ 200 ครับ (${perSet} เซ็ตขึ้นไป)\nแนะนำคละ: ${mix.join(' / ')} เน้นไซส์ 30-34 ที่ขายง่ายสุด\nโอนแล้วส่งภายใน 1-2 วัน หรือเก็บปลายทางก็ได้ครับ`;
    }
    return 'ขายส่งเริ่มต้น 20 ตัว 4,000.- ตกตัวละ 200 คละแบบ คละไซส์ได้ครับ ขายที่ไหนอยู่ครับ (ตลาดนัด / ออนไลน์ / หน้าร้าน) จะได้แนะนำแบบที่ขายง่าย';
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
  if (!brain) return 'ผู้ช่วยตัวนี้ยังไม่มีสมองเวอร์ชันตัวอย่าง';
  return brain(agent, knowledge, message.trim());
}
