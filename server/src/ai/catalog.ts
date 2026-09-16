/**
 * Every box in the back office, and the add-ons an AI box can be given.
 *
 * This is the product vocabulary. The Studio screen renders exactly this; the
 * prompt assembler and the job runner read exactly this. Three kinds of box:
 *
 *   ai          — teachable by typing, has a chat, runs on a schedule too
 *   automation  — deterministic job (sync, guard, publish, measure); no prompt
 *   human       — a queue a person works (approval)
 *
 * Boxes are ordered by their step in the daily loop: sense → plan → create →
 * check → approve → publish → run ads → measure → report → learn.
 */
export type AgentSlug =
  | 'sense' | 'stock_guard'
  | 'scout' | 'strategist' | 'copywriter' | 'qa'
  | 'approval' | 'publisher'
  | 'campaign' | 'measure' | 'analyst'
  | 'reporter' | 'learner';
export type Kind = 'ai' | 'automation' | 'human';
export type Team = 'sense' | 'content' | 'approve' | 'ads' | 'learn';
export type Autonomy = 'propose' | 'auto';

export const TEAM_LABEL: Record<Team, string> = {
  sense: 'รับข้อมูล', content: 'สร้างคอนเทนต์', approve: 'อนุมัติและโพสต์', ads: 'ยิงแอดและวัดผล', learn: 'รายงานและเรียนรู้',
};
export const TEAM_ORDER: Team[] = ['sense', 'content', 'approve', 'ads', 'learn'];

export interface AddonDef {
  id: string;
  kind: 'knowledge' | 'action';
  label: string;          // plain Thai, shown on the toggle
  hint: string;           // one line under the label
  /** Phase of the build this becomes real in; before that the toggle is shown but locked. */
  phase: 1 | 2 | 3 | 4 | 5 | 6;
  /** Actions that change the outside world need approval unless autonomy='auto'. */
  risky?: boolean;
}

export const ADDONS: AddonDef[] = [
  // ---- knowledge: what an AI box may read ----
  { id: 'voice',       kind: 'knowledge', label: 'เสียงของแบรนด์',        hint: 'โทน emoji และรูปประโยคที่เพจใช้',            phase: 1 },
  { id: 'usp',         kind: 'knowledge', label: 'จุดขายของร้าน',          hint: 'ส่งฟรี เก็บเงินปลายทาง ไซส์ 28-44 ฯลฯ',     phase: 1 },
  { id: 'forbidden',   kind: 'knowledge', label: 'คำต้องห้าม',             hint: 'คำที่ผิดนโยบายโฆษณาหรือเสี่ยงกฎหมาย',        phase: 1 },
  { id: 'sizes',       kind: 'knowledge', label: 'ตารางไซส์',              hint: 'เอว/น้ำหนัก → ไซส์ และไซส์ขายดี',             phase: 1 },
  { id: 'signals',     kind: 'knowledge', label: 'สินค้า สต็อก ยอดขาย',    hint: 'จาก POS · รู้ว่าไซส์ไหนเหลือกี่ตัว',          phase: 1 },
  { id: 'ads',         kind: 'knowledge', label: 'ผลแอดล่าสุด',            hint: 'ใช้ไป ทักแชท ROAS ของแต่ละแอด',            phase: 1 },
  { id: 'posts',       kind: 'knowledge', label: 'โพสต์ที่ผ่านมา',          hint: 'โพสต์ไหน reach ดี เขียนแบบไหน',              phase: 1 },
  { id: 'competitors', kind: 'knowledge', label: 'แอดของคู่แข่ง',           hint: 'จาก Ad Library: hook ราคา รูปแบบ ที่คู่แข่งใช้', phase: 1 },
  { id: 'runs',        kind: 'knowledge', label: 'สิ่งที่ระบบทำวันนี้',      hint: 'ผลรันของทุกกล่องในวันนี้',                    phase: 1 },
  // ---- actions: what an AI box may do ----
  { id: 'draft_brief',   kind: 'action', label: 'ร่างแผนคอนเทนต์',      hint: 'เสนอว่าจะดันสินค้าตัวไหน มุมไหน',           phase: 2 },
  { id: 'draft_post',    kind: 'action', label: 'ร่างโพสต์',             hint: 'เขียนแคปชั่นพร้อมราคาและไซส์',               phase: 2 },
  { id: 'review',        kind: 'action', label: 'ตรวจโพสต์',             hint: 'ผ่าน/ไม่ผ่าน พร้อมเหตุผล',                   phase: 2 },
  { id: 'write_report',  kind: 'action', label: 'เขียนรายงาน',           hint: 'สรุปรายวัน/รายสัปดาห์ส่งเข้า LINE',           phase: 2 },
  { id: 'propose_rule',  kind: 'action', label: 'เสนอกฎที่เรียนรู้',      hint: 'กฎใหม่พร้อมหลักฐาน รอคนเปิดใช้',             phase: 2 },
  { id: 'publish_post',  kind: 'action', label: 'โพสต์ลงเพจ',            hint: 'ต้องได้สิทธิ์ pages_manage_posts ก่อน',       phase: 3, risky: true },
  { id: 'create_ad',     kind: 'action', label: 'สร้างแอดใหม่',          hint: 'ตั้งแอดจากโพสต์ที่อนุมัติ ภายในเพดานงบ',      phase: 4, risky: true },
  { id: 'adjust_budget', kind: 'action', label: 'ปรับงบแอด',             hint: 'เพิ่ม/ลด/พัก ภายในเพดานที่ตั้งไว้',           phase: 4, risky: true },
];

export const ADDON_BY_ID: Record<string, AddonDef> = Object.fromEntries(ADDONS.map((a) => [a.id, a]));

export interface AgentDef {
  slug: AgentSlug;
  kind: Kind;
  team: Team;
  /** Position in the daily loop, for ordering the screen. */
  step: number;
  name: string;
  emoji: string;
  role: string;
  /** When it runs on its own; `cron` is what the scheduler uses, `schedule` is what the owner reads. */
  schedule: string;
  cron: string | null;
  /** For AI boxes: the question the scheduler asks it when it runs unattended. */
  runPrompt?: string;
  /** Default teaching, in the owner's voice, that they can edit or replace. AI boxes only. */
  instructions: string;
  examples: { ask: string; answer: string }[];
  addons: { knowledge: string[]; actions: string[] };
  autonomy: Autonomy;
  effort: 'low' | 'medium' | 'high';
  /** Suggested opening questions on the chat screen. AI boxes only. */
  starters: string[];
  /** For automation boxes: what it does, one line per rule, shown instead of a chat. */
  rules?: string[];
}

const none = { instructions: '', examples: [], addons: { knowledge: [], actions: [] }, autonomy: 'auto' as const, effort: 'low' as const, starters: [] };

export const AGENTS: AgentDef[] = [
  /* ---------------------------------------------------------------- sense */
  {
    slug: 'sense', kind: 'automation', team: 'sense', step: 1, name: 'ตัวดึงข้อมูล', emoji: '📡',
    role: 'ดึงยอดขายจาก POS, สถิติเพจ และผลแอด ทุกช่องทาง มาไว้ที่เดียว',
    schedule: 'ทุก 6 ชั่วโมง', cron: '0 */6 * * *',
    rules: [
      'อ่านยอดขายรายวันจาก POS/Bigseller (นำเข้าไฟล์หรือ API)',
      'ดึง insights ของโพสต์และแอดจาก Facebook ด้วยสิทธิ์อ่านอย่างเดียว',
      'ทุกอย่างลง raw_event ก่อน แล้วค่อยแปลงเป็นตาราง — ดึงซ้ำกี่ครั้งก็ไม่ซ้ำแถว',
      'ถ้า token หมดอายุหรือดึงไม่ได้ ให้บันทึก error และไม่แตะข้อมูลเดิม',
    ],
    ...none,
  },
  {
    slug: 'stock_guard', kind: 'automation', team: 'sense', step: 2, name: 'ยามสต็อก', emoji: '🛡️',
    role: 'เช็คไซส์ขายดี (30/32/34) ทุกสินค้า ถ้าขาดให้ปิดป้าย "โฆษณาได้" และแจ้งหยุดแอดที่รันอยู่',
    schedule: 'ทุก 15 นาที และทุกครั้งที่สต็อกเปลี่ยน', cron: '*/15 * * * *',
    rules: [
      'ไซส์ขายดีตามหมวด: ผู้ชาย 30/32/34 · ผู้หญิง 28/30/32 · สปอร์ต FS',
      'ไซส์ขายดีไซส์ใดต่ำกว่า 6 ตัวรวมทุกสี = สินค้านั้น promotable=false',
      'สินค้าที่เหลือเกิน 60 วันขาย = ติดป้าย "เหลือเยอะ" ให้นักวางแผนเสนอโปร',
      'เมื่อสินค้ากลายเป็นห้ามโฆษณา ส่ง event ให้ตัวโพสต์หยุดแอดที่เกี่ยวภายใน 15 นาที',
    ],
    ...none,
  },

  /* -------------------------------------------------------------- content */
  {
    slug: 'scout', kind: 'ai', team: 'content', step: 3, name: 'สอดแนมคู่แข่ง', emoji: '🕵️',
    role: 'ดูแอดของเพจยีนส์คู่แข่งจาก Ad Library แล้วบอกว่าเขาเล่นมุมไหน ราคาเท่าไหร่ เราควรโต้ยังไง',
    schedule: 'ทุกวัน 05:00', cron: '0 5 * * *',
    runPrompt: 'สรุปว่าคู่แข่งเล่นอะไรอยู่วันนี้ และเสนอมุมโต้ 2 มุมให้นักวางแผน',
    instructions: [
      'เทียบราคาคู่แข่งกับราคาเราเป็นตัวเลขเสมอ ไม่ใช่ "ถูกกว่า/แพงกว่า" ลอย ๆ',
      'บอก hook ที่คู่แข่งใช้ซ้ำ (เช่น 1 แถม 1, ส่งฟรี, ราคาเซ็ต) และของเราที่ยังไม่มีใครใช้',
      'เสนอมุมโต้ไม่เกิน 2 มุม พร้อมสินค้าของเราที่พร้อมไซส์',
      'ห้ามเอาชื่อคู่แข่งไปใส่ในโพสต์ของเรา',
    ].join('\n'),
    examples: [],
    addons: { knowledge: ['competitors', 'signals', 'usp'], actions: ['draft_brief'] },
    autonomy: 'propose', effort: 'medium',
    starters: ['คู่แข่งเล่นอะไรอยู่ตอนนี้', 'ราคาเราเทียบคู่แข่งเป็นยังไง', 'มุมไหนที่ยังไม่มีใครใช้'],
  },
  {
    slug: 'strategist', kind: 'ai', team: 'content', step: 4, name: 'นักวางแผน', emoji: '🧭',
    role: 'ดูยอดขายกับสต็อก แล้วบอกว่าสัปดาห์นี้ควรดันสินค้าตัวไหน มุมไหน',
    schedule: 'ทุกวัน 06:00', cron: '0 6 * * *',
    runPrompt: 'วันนี้ควรดันสินค้าตัวไหน มุมไหน เสนอเป็นแผนไม่เกิน 3 ชิ้น',
    instructions: [
      'เสนอไม่เกิน 3 ตัวต่อครั้ง เรียงตามความคุ้ม',
      'สินค้าที่ไซส์ 30/32/34 ขาด ห้ามเสนอเด็ดขาด ให้บอกแทนว่าต้องเติมไซส์ก่อน',
      'ถ้าสินค้าไหนเหลือเยอะเกิน 60 วัน ให้เสนอทำโปรเซ็ตล้างสต็อก',
      'บอกเหตุผลด้วยตัวเลข ไม่ต้องเขียนยาว',
    ].join('\n'),
    examples: [],
    addons: { knowledge: ['signals', 'ads', 'usp', 'sizes', 'competitors'], actions: ['draft_brief'] },
    autonomy: 'propose', effort: 'medium',
    starters: ['สัปดาห์นี้ควรดันตัวไหน', 'ตัวไหนห้ามยิงแอดตอนนี้', 'มีอะไรเหลือเยอะที่ควรล้างสต็อก'],
  },
  {
    slug: 'copywriter', kind: 'ai', team: 'content', step: 5, name: 'นักเขียน', emoji: '✍️',
    role: 'เขียนโพสต์และแคปชั่นแอดในสไตล์ของเพจ ราคาและไซส์ตรงกับของจริงเสมอ',
    schedule: 'เมื่อแผนได้รับอนุมัติ', cron: null,
    runPrompt: 'เขียนโพสต์ 2 แบบสำหรับสินค้าที่ขายดีที่สุดที่พร้อมไซส์',
    instructions: [
      'ใช้ emoji นำหน้าบรรทัดแบบเพจ: 👖 ⭐ 🔥 🚚',
      'ราคาต้องมาจากข้อมูลสินค้าเท่านั้น ห้ามเดาราคา',
      'ทุกโพสต์ต้องมี ราคาเดี่ยว + ราคาเซ็ต + ช่วงไซส์ + ส่งฟรีหรือเก็บเงินปลายทาง',
      'ปิดท้ายด้วย "ทักแชทสั่งได้เลย"',
      'ห้ามใช้คำในรายการคำต้องห้าม',
    ].join('\n'),
    examples: [{
      ask: 'เขียนโพสต์ยีนส์ผ้ายืด',
      answer: '👖 ยีนส์ผ้ายืด 4 ตัว 990.- ตกตัวละ 247!\n⭐ ไซส์ 28-44 อ้วนผอมใส่ได้\n🚚 ส่งฟรี + เก็บเงินปลายทาง\nทักแชทสั่งได้เลย',
    }],
    addons: { knowledge: ['voice', 'usp', 'forbidden', 'sizes', 'signals', 'posts'], actions: ['draft_post'] },
    autonomy: 'propose', effort: 'medium',
    starters: ['เขียนโพสต์ขาสั้นผ้าสี 3 แบบ', 'แคปชั่นแอดกระบอกเล็ก เน้นราคาเซ็ต', 'โพสต์ขายส่งสำหรับพ่อค้าแม่ค้า'],
  },
  {
    slug: 'qa', kind: 'ai', team: 'content', step: 6, name: 'ผู้ตรวจ', emoji: '🔍',
    role: 'ตรวจโพสต์ก่อนออก: ราคาถูกไหม ไซส์มีจริงไหม มีคำต้องห้ามไหม',
    schedule: 'ทุกร่างที่นักเขียนส่งมา', cron: null,
    instructions: [
      'ตอบ ผ่าน หรือ ไม่ผ่าน ก่อนเสมอ แล้วค่อยบอกเหตุผลเป็นข้อ',
      'ราคาผิดจากข้อมูลสินค้าแม้ 1 บาท = ไม่ผ่าน',
      'โพสต์ที่พูดถึงไซส์ที่หมด = ไม่ผ่าน',
      'เจอคำต้องห้ามให้บอกคำนั้นและเสนอคำแทน',
    ].join('\n'),
    examples: [],
    addons: { knowledge: ['forbidden', 'sizes', 'signals'], actions: ['review'] },
    autonomy: 'auto', effort: 'low',
    starters: ['ตรวจโพสต์นี้ให้หน่อย: ...', 'คำไหนใช้ไม่ได้บ้าง', 'ราคาในโพสต์นี้ถูกไหม'],
  },

  /* -------------------------------------------------------------- approve */
  {
    slug: 'approval', kind: 'human', team: 'approve', step: 7, name: 'คิวอนุมัติ', emoji: '✅',
    role: 'ทุกอย่างที่กระทบโลกจริง (โพสต์ ตั้งแอด เพิ่มงบ) มารอที่นี่ให้คนกดจากมือถือ',
    schedule: 'เมื่อมีงานรอ · แจ้งเตือนทาง LINE', cron: null,
    rules: [
      'งานเสี่ยงต่ำ (ร่างโพสต์ที่ผู้ตรวจผ่านแล้ว) แสดงเป็นชุดให้กดอนุมัติทีเดียว',
      'งานเสี่ยงสูง (ตั้งแอดใหม่ เพิ่มงบ) ต้องกดทีละรายการ และเห็นเหตุผลของ AI',
      'ไม่กดภายใน 24 ชม. = หมดอายุ ไม่ทำเอง',
      'ทุกการกดลง audit_log ว่าใคร อนุมัติอะไร เมื่อไหร่',
    ],
    ...none,
  },
  {
    slug: 'publisher', kind: 'automation', team: 'approve', step: 8, name: 'ตัวโพสต์และตั้งแอด', emoji: '🚀',
    role: 'เอางานที่อนุมัติแล้วไปโพสต์และตั้งแอดจริง ตามเวลาที่กำหนด ภายในเพดานงบ',
    schedule: 'ตามเวลาที่อนุมัติไว้ · เช็คคิวทุก 5 นาที', cron: '*/5 * * * *',
    rules: [
      'โพสต์ในช่วงเวลาที่ reach ดีของเพจ (จากข้อมูลโพสต์ที่ผ่านมา)',
      'ก่อนตั้งแอด: committed + งบใหม่ ต้องไม่เกินเพดานวัน/เดือน (budget ledger) ใน transaction เดียว',
      'ทุกงานมี idempotency key — retry กี่ครั้งก็ไม่ได้แอดซ้ำ',
      'ถ้า store.autopilot=false หรือ token ใกล้หมดอายุ (< 1 วัน) หยุดทั้งหมดและแจ้ง',
    ],
    ...none,
  },

  /* ------------------------------------------------------------------ ads */
  {
    slug: 'campaign', kind: 'ai', team: 'ads', step: 9, name: 'ผู้จัดการแอด', emoji: '🎯',
    role: 'ตั้งแอดจากโพสต์ที่อนุมัติแล้ว: กลุ่มเป้าหมาย งบต่อวัน และกฎหยุด/เพิ่ม ภายในเพดานงบของร้าน',
    schedule: 'ทุก 6 ชั่วโมง และเมื่อมีโพสต์ใหม่อนุมัติ', cron: '30 */6 * * *',
    runPrompt: 'แบ่งงบวันนี้ให้สินค้าที่พร้อมไซส์ และบอกว่าแอดตัวไหนควรหยุด',
    instructions: [
      'งบรวมต่อวันห้ามเกินเพดานของร้าน ถ้าไม่พอให้ตัดตัวที่ ROAS ต่ำสุดออก ไม่ใช่หารเฉลี่ย',
      'แอดใหม่เริ่มที่ 150-300 บาท/วัน ทดสอบ 2 ชิ้นต่อสินค้า (A/B) 3 วันก่อนเพิ่มงบ',
      'เป้าหมายแอดคือ "ทักแชท" (messages) ไม่ใช่ยอด like',
      'สินค้าที่ไซส์ขายดีขาด ห้ามตั้งแอดใหม่ และต้องเสนอหยุดแอดที่รันอยู่ทันที',
      'ทุกแอดต้องมีกฎหยุด: ROAS ต่ำกว่า 1.5 สามวันติด หรือใช้ไป 3 เท่าของราคาสินค้าโดยไม่มีคนทัก',
    ].join('\n'),
    examples: [],
    addons: { knowledge: ['signals', 'ads', 'usp', 'posts'], actions: ['create_ad', 'adjust_budget'] },
    autonomy: 'propose', effort: 'medium',
    starters: ['ตั้งแอดให้กระบอกเล็ก งบ 300/วัน', 'แบ่งงบ 1,500/วัน ให้ 3 ตัวยังไงดี', 'ตัวไหนควรหยุดแอดตอนนี้'],
  },
  {
    slug: 'measure', kind: 'automation', team: 'ads', step: 10, name: 'ตัววัดผล', emoji: '📏',
    role: 'จับคู่แอดกับยอดขายจริงใน POS (lift) ไม่เชื่อตัวเลข conversion ของแพลตฟอร์มอย่างเดียว',
    schedule: 'ทุกคืน 23:30', cron: '30 23 * * *',
    rules: [
      'ยอดขายของสินค้าที่มีแอด เทียบ 7 วันก่อนมีแอด = lift ของแอดนั้น',
      'แอดขายส่ง (Messenger) วัดที่จำนวนคนทัก ไม่ใช่ยอดซื้อทันที',
      'ทดลอง A/B ที่ครบวันทดสอบ ให้ตัดสินผู้ชนะและปิดตัวแพ้',
      'ผลทั้งหมดเขียนลง fact ตาราง append-only แก้ย้อนหลังไม่ได้',
    ],
    ...none,
  },
  {
    slug: 'analyst', kind: 'ai', team: 'ads', step: 11, name: 'นักวิเคราะห์', emoji: '📊',
    role: 'อ่านผลแอดกับยอดขาย แล้วบอกว่าตัวไหนควรเพิ่มงบ ตัวไหนควรพัก',
    schedule: 'ทุกวัน 07:00', cron: '0 7 * * *',
    runPrompt: 'สรุปผลแอดถึงเมื่อวาน ตัวไหนควรเพิ่มงบ ตัวไหนควรพัก',
    instructions: [
      'วัดที่ยอดทักแชทและ ROAS ไม่ใช่ยอด like',
      'ROAS ต่ำกว่า 1.5 สามวันติด = เสนอพัก',
      'ROAS เกิน 3 และยังมีสต็อกครบไซส์ = เสนอเพิ่มงบไม่เกิน 30% ต่อวัน',
      'แอดขายส่งวัดที่จำนวนคนทัก ไม่ใช่ยอดขายทันที',
    ].join('\n'),
    examples: [],
    addons: { knowledge: ['ads', 'signals', 'posts'], actions: ['adjust_budget'] },
    autonomy: 'propose', effort: 'medium',
    starters: ['สรุปผลแอดสัปดาห์นี้', 'ตัวไหนควรพัก ตัวไหนควรเพิ่มงบ', 'แอดขายส่งคุ้มไหม'],
  },

  /* ---------------------------------------------------------------- learn */
  {
    slug: 'reporter', kind: 'ai', team: 'learn', step: 12, name: 'นักรายงาน', emoji: '📈',
    role: 'เขียนสรุปประจำวันและประจำสัปดาห์ให้อ่านจบใน 1 นาที: ขายได้เท่าไหร่ ใช้แอดไปเท่าไหร่ ระบบทำอะไรไป',
    schedule: 'ทุกวัน 21:00 และทุกวันจันทร์ 08:00', cron: '0 21 * * *',
    runPrompt: 'เขียนสรุปประจำวันสำหรับเจ้าของร้าน',
    instructions: [
      'ขึ้นต้นด้วยตัวเลข 3 ตัว: ยอดขาย ค่าแอด ROAS แล้วค่อยรายละเอียด',
      'บอกสิ่งที่ต้องตัดสินใจก่อน (มีอะไรรออนุมัติ มีอะไรต้องเติมสต็อก)',
      'ไม่เกิน 12 บรรทัด อ่านบนมือถือได้',
      'ถ้าไม่มีอะไรผิดปกติ ให้บอกว่าไม่มี ไม่ต้องหาเรื่องเขียน',
    ].join('\n'),
    examples: [],
    addons: { knowledge: ['signals', 'ads', 'posts', 'runs'], actions: ['write_report'] },
    autonomy: 'auto', effort: 'low',
    starters: ['สรุปวันนี้ให้หน่อย', 'สัปดาห์นี้เทียบสัปดาห์ก่อนเป็นยังไง', 'มีอะไรที่ต้องตัดสินใจไหม'],
  },
  {
    slug: 'learner', kind: 'ai', team: 'learn', step: 13, name: 'ผู้เรียนรู้', emoji: '🧠',
    role: 'ดูว่าอะไร work ไม่ work ในสัปดาห์ที่ผ่านมา แล้วเสนอเป็นกฎพร้อมหลักฐาน ให้คนเปิดใช้',
    schedule: 'ทุกวันอาทิตย์ 20:00', cron: '0 20 * * 0',
    runPrompt: 'จากผลโพสต์และแอดสัปดาห์นี้ เสนอกฎที่ควรจำไว้ไม่เกิน 3 ข้อ พร้อมหลักฐานตัวเลข',
    instructions: [
      'กฎต้องมีหลักฐานเป็นตัวเลขเทียบกัน (เช่น reach ต่างกันกี่ %) ถ้าไม่มีอย่าเสนอ',
      'เสนอไม่เกิน 3 กฎต่อสัปดาห์ กฎเป็นข้อความสั้นที่นักเขียน/ผู้จัดการแอดเอาไปใช้ได้ทันที',
      'กฎที่ขัดกับสิ่งที่เจ้าของสอนไว้ ให้บอกว่าขัดและให้เจ้าของเลือก',
    ].join('\n'),
    examples: [],
    addons: { knowledge: ['ads', 'posts', 'signals'], actions: ['propose_rule'] },
    autonomy: 'propose', effort: 'high',
    starters: ['สัปดาห์นี้เรียนรู้อะไรได้บ้าง', 'โพสต์แบบไหน reach ดีกว่ากัน', 'แอดแบบไหนคุ้มกว่ากัน'],
  },
];

export const AGENT_BY_SLUG: Record<string, AgentDef> = Object.fromEntries(AGENTS.map((a) => [a.slug, a]));
export const AI_AGENTS = AGENTS.filter((a) => a.kind === 'ai');
