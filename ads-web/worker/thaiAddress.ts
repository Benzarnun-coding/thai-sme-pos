// Thai address book (ตำบล → อำเภอ → จังหวัด → รหัสไปรษณีย์) for bills filled from the chat: customers often leave
// out the postcode or write "นม" for นครราชสีมา. We look the subdistrict up and fill or check the rest, the way
// Page365's own subdistrict picker would. Data: worker/data/thaiAddressData.ts (7,436 subdistricts).

import { THAI_ADDRESS_ROWS } from './data/thaiAddressData.ts';

interface Row { sub: string; dist: string; prov: string; zip: string }

let rows: Row[] | null = null;
const all = (): Row[] => (rows ??= THAI_ADDRESS_ROWS.split('\n').map((l) => { const [sub, dist, prov, zip] = l.split('|'); return { sub, dist, prov, zip }; }));

// Common short forms people type for provinces.
const PROVINCE_ALIAS: Record<string, string> = {
  กทม: 'กรุงเทพมหานคร', กรุงเทพ: 'กรุงเทพมหานคร', กรุงเทพฯ: 'กรุงเทพมหานคร', นม: 'นครราชสีมา', โคราช: 'นครราชสีมา', อยุธยา: 'พระนครศรีอยุธยา',
  นครศรีฯ: 'นครศรีธรรมราช', สุราษฎร์: 'สุราษฎร์ธานี', ปทุม: 'ปทุมธานี', ปมุมธานี: 'ปทุมธานี', ประจวบ: 'ประจวบคีรีขันธ์', อุบล: 'อุบลราชธานี',
};

/** Strips prefixes and spaces: "ต. พรุดินนา" → "พรุดินนา", "อำเภอเมืองเลย" → "เมืองเลย". */
const THAI_DIGIT = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ'];

export function bare(s: string): string {
  return (s ?? '').replace(/^(ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|จังหวัด|จ\.)\s*/, '').replace(/\s+/g, '').trim()
    // "คลอง7" → "คลองเจ็ด" (Pathum Thani's numbered canals are written both ways)
    .replace(/(\D)(10|[1-9])$/, (_, a: string, n: string) => a + THAI_DIGIT[Number(n)]);
}

function province(s: string): string {
  const b = bare(s);
  return PROVINCE_ALIAS[b] ?? b;
}

/** "เมือง" alone or "อ.เมือง" means the province's capital district ("เมืองนครราชสีมา"). */
function districtMatches(rowDist: string, given: string, prov: string): boolean {
  const g = bare(given);
  if (!g) return true;
  if (rowDist === g) return true;
  if (g === 'เมือง' && rowDist === `เมือง${prov}`) return true;
  return rowDist.replace(/^เมือง/, '') === g.replace(/^เมือง/, '') && rowDist.startsWith('เมือง') === g.startsWith('เมือง');
}

export interface AddressParts { subdistrict: string; district: string; province: string; postal_code: string }

/**
 * Fills a missing postcode (and district/province) from the subdistrict, normalises the province, and says when
 * what was written doesn't exist or disagrees. Returns the completed parts and any doubt.
 */
export function completeAddress(a: AddressParts): { parts: AddressParts; doubt: string | null } {
  const sub = bare(a.subdistrict);
  const prov = province(a.province);
  const zip = (a.postal_code ?? '').replace(/\D/g, '');
  let cands = all().filter((r) => r.sub === sub);
  if (prov) cands = cands.filter((r) => r.prov === prov);
  if (a.district) cands = cands.filter((r) => districtMatches(r.dist, a.district, r.prov));
  if (zip && cands.length > 1) { const z = cands.filter((r) => r.zip === zip); if (z.length) cands = z; }

  if (cands.length === 1) {
    const r = cands[0];
    const parts = { subdistrict: r.sub, district: r.dist, province: r.prov, postal_code: zip || r.zip };
    // A postcode the customer typed that isn't this subdistrict's: keep theirs (some areas have their own), but say so.
    const doubt = zip && zip !== r.zip ? `รหัสไปรษณีย์ ${zip} ไม่ตรงกับ ต.${r.sub} อ.${r.dist} (${r.zip})` : null;
    return { parts, doubt };
  }
  if (cands.length > 1) {
    const zips = [...new Set(cands.map((r) => r.zip))];
    if (zips.length === 1 && new Set(cands.map((r) => `${r.dist}|${r.prov}`)).size === 1) {
      const r = cands[0];
      return { parts: { subdistrict: r.sub, district: r.dist, province: r.prov, postal_code: zip || r.zip }, doubt: null };
    }
    return { parts: { ...a, province: prov || a.province, postal_code: zip }, doubt: `ต.${sub} มีหลายที่ (${cands.slice(0, 3).map((r) => `อ.${r.dist} จ.${r.prov}`).join(', ')}) — ต้องมีอำเภอ/จังหวัด` };
  }
  // Subdistrict not found: still fill the postcode when the district has only one.
  const inDist = all().filter((r) => (!prov || r.prov === prov) && a.district && districtMatches(r.dist, a.district, r.prov));
  // A typo in the subdistrict ("ตลาดตะเคียน" for ลาดตะเคียน, อ.กบินทร์บุรี): the one closest by spelling in that
  // district, if it is the only one within 2 letters — filled, and said so for a person to check.
  if (sub && inDist.length) {
    const scored = inDist.map((r) => ({ r, d: editDistance(r.sub, sub) })).sort((x, y) => x.d - y.d);
    const best = scored[0];
    if (best.d <= 2 && (scored.length === 1 || scored[1].d > best.d || scored[1].r.sub === best.r.sub)) {
      const r = best.r;
      return { parts: { subdistrict: r.sub, district: r.dist, province: r.prov, postal_code: zip || r.zip }, doubt: `ไม่มี ต.${sub} — ใช้ ต.${r.sub} อ.${r.dist} (สะกดใกล้สุด) ช่วยเช็ก` };
    }
  }
  const distZips = [...new Set(inDist.map((r) => r.zip))];
  if (!zip && distZips.length === 1) return { parts: { ...a, district: inDist[0].dist, province: inDist[0].prov, postal_code: distZips[0] }, doubt: sub ? `ไม่พบ ต.${sub} ใน อ.${inDist[0].dist} — เช็กชื่อตำบล` : null };
  return { parts: { ...a, province: prov || a.province, postal_code: zip }, doubt: sub ? `ไม่พบ ต.${sub}${a.district ? ` อ.${bare(a.district)}` : ''}${prov ? ` จ.${prov}` : ''} ในฐานข้อมูลตำบล` : null };
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** The subdistricts a district + postcode can be (a bill whose ตำบล was left blank): one name = it can only be that. */
export function subdistrictsOf(district: string, prov: string, zip: string): string[] {
  const p = province(prov);
  const z = (zip ?? '').replace(/\D/g, '');
  return [...new Set(all().filter((r) => (!p || r.prov === p) && districtMatches(r.dist, district, r.prov) && (!z || r.zip === z)).map((r) => r.sub))];
}

/** The district + province a postcode belongs to (the first, when it spans several): the App Review test question. */
export function zipPlace(zip: string): { district: string; province: string } | null {
  const r = all().find((x) => x.zip === zip);
  return r ? { district: r.dist, province: r.prov } : null;
}

/**
 * ตำบล left out (Benz 26 Oct): a postcode alone almost never tells it (35 of 966 postcodes have one subdistrict;
 * district + postcode, 88 of 7,434), so it is picked only when the district + postcode leave one, or when exactly
 * one of their subdistricts is named in what the customer wrote (a village "บ้านหนองบัว ม.3" → ต.หนองบัว). The
 * district's and province's own names are taken out first (they are always in the text). Otherwise no pick, and
 * the candidates go to a person.
 */
export function guessSubdistrict(district: string, prov: string, zip: string, clues: string[]): { sub: string | null; how: 'only' | 'clue' | null; candidates: string[] } {
  const candidates = subdistrictsOf(district, prov, zip);
  if (candidates.length === 1) return { sub: candidates[0], how: 'only', candidates };
  if (!candidates.length) return { sub: null, how: null, candidates };
  const strip = [bare(district), province(prov), bare(prov)].filter((x) => x.length >= 2).sort((a, b) => b.length - a.length);
  let text = clues.join(' ').replace(/\s+/g, '');
  for (const s of strip) text = text.split(s).join('|');
  const hits = candidates.filter((c) => c.length >= 2 && text.includes(c));
  // "หนองบัว" inside "หนองบัวแดง": the longer name wins; two unrelated names = no pick.
  const longest = hits.filter((h) => !hits.some((o) => o !== h && o.includes(h)));
  return longest.length === 1 ? { sub: longest[0], how: 'clue', candidates } : { sub: null, how: null, candidates };
}
