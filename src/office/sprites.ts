/**
 * Pixel art for the office.
 *
 * Every sprite is a list of strings; each character is one pixel and maps to a
 * palette key. People are 12×18 with a dark outline and one shade step on hair,
 * skin, shirt and trousers; desks are 28×18. Frames are cached per (look,
 * frame) as tiny offscreen canvases so the scene redraws cheaply.
 */
export type Team = 'sense' | 'content' | 'approve' | 'ads' | 'learn';

/** Shirt colour per team, hair per role — enough to tell thirteen people apart. */
export const TEAM_SHIRT: Record<Team, string> = {
  sense: '#4E63D8', content: '#E8A33D', approve: '#1E8E3E', ads: '#D93A3A', learn: '#7B4EBF',
};
export const TEAM_CARPET: Record<Team, [string, string, string]> = {          // [light, dark, border]
  sense: ['#DDE3FA', '#D2DAF6', '#AAB8EA'], content: ['#FBEFD6', '#F6E5C4', '#E5C68E'], approve: ['#E1F1E4', '#D3E9D8', '#A9D2B2'],
  ads: ['#FBE3E3', '#F6D6D6', '#E7A9A9'], learn: ['#ECE3F8', '#E2D6F2', '#C4AEE3'],
};

export interface Look { hair: string; skin: string; shirt: string; pants: string; accessory?: 'glasses' | 'cap' | 'headset' | 'tie' | 'badge' }

const SKINS = ['#F2C9A0', '#E0AC7E', '#C68B5A', '#F7D8B8'];
const HAIRS = ['#2B2118', '#4A2C17', '#111111', '#8A5A2B', '#D9A441', '#5A3A6B', '#2E4A7A'];
export const OUTLINE = '#2A2F45';

/** A stable look for a role: same slug, same person every day. */
export function lookFor(slug: string, team: Team): Look {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const accessory = ({ qa: 'glasses', scout: 'cap', analyst: 'headset', approval: 'tie', reporter: 'badge' } as Record<string, Look['accessory']>)[slug];
  return { hair: HAIRS[h % HAIRS.length], skin: SKINS[(h >>> 3) % SKINS.length], shirt: TEAM_SHIRT[team], pants: (h >>> 5) % 2 ? '#2B3A67' : '#3D3D3D', accessory };
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(ch).map((v) => v.toString(16).padStart(2, '0')).join('');
}

/* ---------- people (12 wide × 18 tall) ---------- */
// o outline · H hair · h hair light · S skin · s skin shade · W eye white · E pupil
// T shirt · t shirt shade · P pants · p pants shade · B shoe · A accessory · . empty
const HEAD = [
  '....oooo....',
  '...oHHHHo...',
  '..oHhHHHHHo.',
  '..oHHHHHHHo.',
  '..oHSSSSSHo.',
  '..oSSSSSSSo.',
  '..oSWESSWEo.',
  '..oSSSSSSSo.',
  '...osSSSso..',
  '....oSSo....',
];
const HEAD_CLOSED = HEAD.map((r, i) => (i === 6 ? '..oSEESSEEo.' : r));
const LEGS_STAND = [
  '..oPPPoPPPo.',
  '..oPPpoPpPo.',
  '..oPPPoPPPo.',
  '..oBBBoBBBo.',
];
const LEGS_STEP = [
  '..oPPPoPPPo.',
  '.oPPpo.oPPo.',
  '.oPPo...oPPo',
  '.oBBo...oBBo',
];
const TORSO_IDLE = [
  '..ooTTTTToo.',
  '.oTTtTTTtTTo',
  '.oSTTTTTTTSo',
  '..oTTtTtTTo.',
];
const TORSO_TYPE0 = [
  '..ooTTTTToo.',
  '.oTTtTTTtTTo',
  '.oTTTTTTTTTo',
  '.oSTtTtTTSo.',
];
const TORSO_TYPE1 = [
  '..ooTTTTToo.',
  '.oTTtTTTtTTo',
  '.oSTTTTTTTSo',
  '.oSTtTtTTSo.',
];
const FRAMES: Record<string, string[]> = {
  idle: [...HEAD, ...TORSO_IDLE, ...LEGS_STAND],
  blink: [...HEAD_CLOSED, ...TORSO_IDLE, ...LEGS_STAND],
  work0: [...HEAD, ...TORSO_TYPE0, ...LEGS_STAND],
  work1: [...HEAD, ...TORSO_TYPE1, ...LEGS_STAND],
  walk0: [...HEAD, ...TORSO_IDLE, ...LEGS_STEP],
  walk1: [...HEAD, ...TORSO_IDLE, ...LEGS_STAND],
  sleep: [...HEAD_CLOSED, ...TORSO_IDLE, ...LEGS_STAND],
};
export type Frame = keyof typeof FRAMES;

/** Accessories overwrite pixels on top of a frame. */
function withAccessory(rows: string[], acc?: Look['accessory']): string[] {
  const g = rows.map((r) => r.split(''));
  if (acc === 'glasses') { g[6][3] = 'A'; g[6][6] = 'A'; g[6][7] = 'A'; g[6][10] = 'A'; g[7][4] = 'A'; g[7][5] = 'A'; g[7][8] = 'A'; g[7][9] = 'A'; }
  if (acc === 'cap') { g[1] = '...oAAAAo...'.split(''); g[2] = '..oAAAAAAAo.'.split(''); g[3] = '.oAAAAAAAAAo'.split(''); }
  if (acc === 'headset') { g[4][2] = 'A'; g[5][2] = 'A'; g[6][2] = 'A'; g[4][10] = 'A'; g[5][10] = 'A'; g[6][10] = 'A'; g[1][4] = 'A'; g[1][5] = 'A'; g[1][6] = 'A'; g[1][7] = 'A'; }
  if (acc === 'tie') { g[11][6] = 'A'; g[12][6] = 'A'; g[13][6] = 'A'; }
  if (acc === 'badge') { g[11][8] = 'A'; g[12][8] = 'A'; }
  return g.map((r) => r.join(''));
}

/* ---------- furniture ---------- */
const D20 = 'D'.repeat(20);
export const DESK = [
  '..........oooooooo..........',
  '..........oCCCCCCo..........',
  '..........oCCCCCCo..........',
  '..........oCCCCCCo..........',
  '..........oCCCCCCo..........',
  '..........oooooooo..........',
  '.............oo.............',
  '............oooo............',
  'oooooooooooooooooooooooooooo',
  'oWWWWWWWWWWWWWWWWWWWWWWWWWWo',
  'oWWWWkkkkkkkkWWWWmmmWWWNNWWo',
  'oWWWWkkkkkkkkWWWWmmmWWWNNWWo',
  'oWWWWWWWWWWWWWWWWWWWWWWWWWWo',
  'o' + 'D'.repeat(26) + 'o',
  'oDDd' + D20 + 'dDDo',
  'oDDd' + D20 + 'dDDo',
  '.oDo....................oDo.',
  '.ooo....................ooo.',
];
export const PLANT = [
  '...GG.GG..',
  '..GgGGGgG.',
  '.GGGgGGGGG',
  '.GgGGGGgG.',
  '..GGGgGG..',
  '....oGo...',
  '...ooooo..',
  '...oOOOo..',
  '...oOoOo..',
  '...ooooo..',
];
export const COOLER = [
  '.oooooo.',
  '.oLLLLo.',
  '.oLKKLo.',
  '.oLKKLo.',
  '.oLLLLo.',
  '.oooooo.',
  '.oQQQQo.',
  '.oQnnQo.',
  '.oQQQQo.',
  '.oQQQQo.',
  '.oQQQQo.',
  '.oooooo.',
];
export const COFFEE = [
  '.oooooo.',
  '.oQQQQo.',
  '.oQnnQo.',
  '.oQQQQo.',
  '.oo..oo.',
  '.o.mm.o.',
  '.o.mm.o.',
  '.oooooo.',
];
export const PAPER = [
  'ooooo',
  'oNNNo',
  'oNnNo',
  'oNnNo',
  'ooooo',
];

const FURN_PAL: Record<string, string> = {
  o: OUTLINE, C: '#5FD1FF', W: '#D9B486', D: '#A57A4C', d: '#8B6238', k: '#3A3F4F', m: '#E8E2D6', N: '#FFFFFF', n: '#B7C3FF',
  G: '#3F9D4C', g: '#6FC47A', O: '#B4532A', L: '#DDE3FA', K: '#5FD1FF', Q: '#8A90A8',
};

/* ---------- rendering with a cache ---------- */
const cache = new Map<string, HTMLCanvasElement>();

function paint(rows: string[], pal: Record<string, string>): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(...rows.map((r) => r.length)); c.height = rows.length;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const color = pal[ch];
    if (color) { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); }
  }));
  return c;
}

export function charSprite(look: Look, frame: Frame): HTMLCanvasElement {
  const key = `c|${look.hair}|${look.skin}|${look.shirt}|${look.pants}|${look.accessory ?? ''}|${frame}`;
  let c = cache.get(key);
  if (!c) {
    const pal = {
      o: OUTLINE, H: look.hair, h: shade(look.hair, 0.35), S: look.skin, s: shade(look.skin, -0.18), W: '#FFFFFF', E: '#1B2033',
      T: look.shirt, t: shade(look.shirt, -0.2), P: look.pants, p: shade(look.pants, -0.25), B: '#1B2033',
      A: look.accessory === 'cap' ? '#1B2033' : look.accessory === 'tie' ? '#D93A3A' : look.accessory === 'badge' ? '#FFD84D' : '#1B2033',
    };
    c = paint(withAccessory(FRAMES[frame], look.accessory), pal);
    cache.set(key, c);
  }
  return c;
}

export function furniture(name: 'desk' | 'deskOn' | 'deskErr' | 'plant' | 'cooler' | 'coffee' | 'paper'): HTMLCanvasElement {
  let c = cache.get('f|' + name);
  if (!c) {
    if (name === 'desk') c = paint(DESK, { ...FURN_PAL, C: '#3A3F4F' });
    else if (name === 'deskOn') c = paint(DESK, FURN_PAL);
    else if (name === 'deskErr') c = paint(DESK, { ...FURN_PAL, C: '#F07676' });
    else if (name === 'plant') c = paint(PLANT, FURN_PAL);
    else if (name === 'cooler') c = paint(COOLER, FURN_PAL);
    else if (name === 'coffee') c = paint(COFFEE, { ...FURN_PAL, m: '#5A3A2A' });
    else c = paint(PAPER, FURN_PAL);
    cache.set('f|' + name, c);
  }
  return c;
}
