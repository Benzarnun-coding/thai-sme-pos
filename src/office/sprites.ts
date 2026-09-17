/**
 * Pixel art for the office.
 *
 * Every sprite is a list of strings; each character is one pixel and maps to a
 * palette key. Characters are 8×12, desks 22×12. Frames are cached per
 * (look, frame) as tiny offscreen canvases so the scene redraws cheaply.
 */
export type Team = 'sense' | 'content' | 'approve' | 'ads' | 'learn';

/** Shirt colour per team, hair per role — enough to tell thirteen people apart at 8×12. */
export const TEAM_SHIRT: Record<Team, string> = {
  sense: '#4E63D8', content: '#E8A33D', approve: '#1E8E3E', ads: '#D93A3A', learn: '#7B4EBF',
};
export const TEAM_CARPET: Record<Team, [string, string]> = {
  sense: ['#DDE3FA', '#CFD7F6'], content: ['#FBEFD6', '#F6E3BD'], approve: ['#E1F1E4', '#D0E8D5'],
  ads: ['#FBE3E3', '#F5D2D2'], learn: ['#ECE3F8', '#E0D3F2'],
};

export interface Look { hair: string; skin: string; shirt: string; pants: string; accessory?: 'glasses' | 'cap' | 'headset' | 'tie' | 'badge' }

const SKINS = ['#F2C9A0', '#E0AC7E', '#C68B5A', '#F7D8B8'];
const HAIRS = ['#2B2118', '#4A2C17', '#111111', '#8A5A2B', '#D9A441', '#5A3A6B', '#2E4A7A'];

/** A stable look for a role: same slug, same person every day. */
export function lookFor(slug: string, team: Team): Look {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const accessory = ({ qa: 'glasses', scout: 'cap', analyst: 'headset', approval: 'tie', reporter: 'badge' } as Record<string, Look['accessory']>)[slug];
  return { hair: HAIRS[h % HAIRS.length], skin: SKINS[(h >> 3) % SKINS.length], shirt: TEAM_SHIRT[team], pants: (h >> 5) % 2 ? '#2B3A67' : '#3D3D3D', accessory };
}

/* ---------- character frames (8 wide × 12 tall) ---------- */
// H hair · S skin · E eye · T shirt · P pants · B shoe · A accessory · . empty
const BODY_TOP = [
  '..HHHH..',
  '.HHHHHH.',
  '.HSSSSH.',
  '.HSESES.',
  '..SSSS..',
  '..S..S..',
];
const FRAMES: Record<string, string[]> = {
  idle: [...BODY_TOP,
    '.TTTTTT.',
    'TTTTTTTT',
    'STTTTTTS',
    '.TTTTTT.',
    '.PP..PP.',
    '.BB..BB.'],
  work0: [...BODY_TOP,
    '.TTTTTT.',
    'TTTTTTTT',
    'S.TTTT.S',
    'SSTTTTSS',
    '.PP..PP.',
    '.BB..BB.'],
  work1: [...BODY_TOP,
    '.TTTTTT.',
    'STTTTTTS',
    'STTTTTTS',
    '.TTTTTT.',
    '.PP..PP.',
    '.BB..BB.'],
  walk0: [...BODY_TOP,
    '.TTTTTT.',
    'TTTTTTTT',
    'STTTTTTS',
    '.TTTTTT.',
    '.PP.PP..',
    'BB...BB.'],
  walk1: [...BODY_TOP,
    '.TTTTTT.',
    'TTTTTTTT',
    'STTTTTTS',
    '.TTTTTT.',
    '..PP.PP.',
    '.BB...BB'],
  sleep: [...BODY_TOP.map((r, i) => (i === 3 ? '.HSHSHS.' : r)),   // eyes closed
    '.TTTTTT.',
    'TTTTTTTT',
    'STTTTTTS',
    '.TTTTTT.',
    '.PP..PP.',
    '.BB..BB.'],
};

/** Accessories overwrite pixels on top of a frame. */
function withAccessory(rows: string[], acc?: Look['accessory']): string[] {
  const g = rows.map((r) => r.split(''));
  if (acc === 'glasses') { g[3][2] = 'A'; g[3][3] = 'A'; g[3][4] = 'A'; g[3][5] = 'A'; }
  if (acc === 'cap') { g[0] = '.AAAAAA.'.split(''); g[1] = 'AAAAAAAA'.split(''); }
  if (acc === 'headset') { g[2][1] = 'A'; g[2][6] = 'A'; g[3][1] = 'A'; g[3][6] = 'A'; }
  if (acc === 'tie') { g[7][3] = 'A'; g[8][3] = 'A'; g[9][3] = 'A'; }
  if (acc === 'badge') { g[7][5] = 'A'; }
  return g.map((r) => r.join(''));
}

/* ---------- furniture ---------- */
export const DESK = [
  '......MMMMMMMM........',
  '......MCCCCCCM........',
  '......MCCCCCCM........',
  '......MCCCCCCM........',
  '......MMMMMMMM........',
  '.........MM...........',
  'WWWWWWWWWWWWWWWWWWWWWW',
  'WWWWWWWWWWWWWWWWWWWWWW',
  'DDDDDDDDDDDDDDDDDDDDDD',
  'DD..................DD',
  'DD..................DD',
  'DD..................DD',
];
export const PLANT = [
  '..GG..',
  '.GGGG.',
  'GGGGGG',
  '.GGGG.',
  '..OO..',
  '.OOOO.',
];
export const COOLER = [
  '.LLLL.',
  '.LWWL.',
  '.LWWL.',
  '.LLLL.',
  '.KKKK.',
  '.KKKK.',
  '.KKKK.',
  '.KKKK.',
];
export const PAPER = [
  'NNNN',
  'NnnN',
  'NnnN',
  'NNNN',
];

const FURN_PAL: Record<string, string> = {
  M: '#2B2E3A', C: '#5FD1FF', W: '#C8A171', D: '#9C7449',
  G: '#3F9D4C', O: '#B4532A', L: '#DDE3FA', K: '#8A90A8', N: '#FFFFFF', n: '#B7C3FF',
};

/* ---------- rendering with a cache ---------- */
const cache = new Map<string, HTMLCanvasElement>();

function paint(rows: string[], pal: Record<string, string>): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = rows[0].length; c.height = rows.length;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const color = pal[ch];
    if (color) { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); }
  }));
  return c;
}

export function charSprite(look: Look, frame: keyof typeof FRAMES, screenOff = false): HTMLCanvasElement {
  const key = `c|${look.hair}|${look.skin}|${look.shirt}|${look.pants}|${look.accessory ?? ''}|${frame}|${screenOff}`;
  let c = cache.get(key);
  if (!c) {
    const pal = { H: look.hair, S: look.skin, E: '#1B2033', T: look.shirt, P: look.pants, B: '#1B2033', A: look.accessory === 'cap' ? '#1B2033' : look.accessory === 'tie' ? '#D93A3A' : look.accessory === 'badge' ? '#FFD84D' : '#1B2033' };
    c = paint(withAccessory(FRAMES[frame], look.accessory), pal);
    cache.set(key, c);
  }
  return c;
}

export function furniture(name: 'desk' | 'deskOn' | 'deskErr' | 'plant' | 'cooler' | 'paper'): HTMLCanvasElement {
  let c = cache.get('f|' + name);
  if (!c) {
    if (name === 'desk') c = paint(DESK, { ...FURN_PAL, C: '#3A3F4F' });
    else if (name === 'deskOn') c = paint(DESK, FURN_PAL);
    else if (name === 'deskErr') c = paint(DESK, { ...FURN_PAL, C: '#F07676' });
    else if (name === 'plant') c = paint(PLANT, FURN_PAL);
    else if (name === 'cooler') c = paint(COOLER, { ...FURN_PAL, W: '#5FD1FF' });
    else c = paint(PAPER, FURN_PAL);
    cache.set('f|' + name, c);
  }
  return c;
}
