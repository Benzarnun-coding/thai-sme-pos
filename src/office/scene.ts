/**
 * The office as a tiny simulation.
 *
 * Thirteen people at thirteen desks, in loop order, in two rows with a corridor
 * between. A box that runs makes its person type; when the run ends a paper
 * walks from that desk to the next one in the loop. Disabled boxes sleep at
 * their desk; an errored run puts a red mark over the head. Idle people blink,
 * and occasionally stroll to the water cooler so the floor never looks frozen.
 *
 * Logical canvas is 480×250 and is scaled by CSS; overlays (labels, bubbles,
 * tooltips) are DOM elements positioned in percent so they follow the scale.
 */
import { charSprite, furniture, lookFor, OUTLINE, TEAM_CARPET, TEAM_SHIRT, type Frame, type Look, type Team } from './sprites';

export const W = 480;
export const H = 250;

export interface Person {
  slug: string;
  name: string;
  team: Team;
  look: Look;
  desk: { x: number; y: number };       // desk top-left (28×18)
  home: { x: number; y: number };       // where the person stands (behind the desk, 12×18)
  x: number; y: number;
  state: 'idle' | 'work' | 'walk' | 'sleep';
  error: boolean;
  enabled: boolean;
  screen: 'off' | 'on' | 'err';
  path: { x: number; y: number }[] | null;
  pathT: number;
  onArrive: (() => void) | null;
  workUntil: number;
  bubble: { text: string; until: number } | null;
  lastStroll: number;
  seed: number;
}

export interface Paper { path: { x: number; y: number }[]; t: number; toSlug: string }

export interface Zone { team: Team; label: string; x: number; y: number; w: number; h: number }

export const WALL_H = 30;
export const CORRIDOR_Y = 150;
export const COOLER = { x: 228, y: 161 };
export const COFFEE = { x: 240, y: 165 };
const ROW1_Y = 78;    // desk top
const ROW2_Y = 204;
const DESK_W = 28;
const CARPET_ABOVE = 24, CARPET_BELOW = 14;

/** Which team sits in which row; row 1 reads left→right, row 2 continues left→right under it. */
function layoutDesks(n1: number, n2: number) {
  const row1 = Array.from({ length: n1 }, (_, i) => ({ x: Math.round(26 + i * ((W - 52 - DESK_W) / Math.max(1, n1 - 1))), y: ROW1_Y }));
  const row2 = Array.from({ length: n2 }, (_, i) => ({ x: Math.round(20 + i * ((W - 40 - DESK_W) / Math.max(1, n2 - 1))), y: ROW2_Y }));
  return [...row1, ...row2];
}

export function buildScene(agents: { slug: string; name: string; team: Team; enabled: boolean; last_run: { status: string } | null }[], teamLabels: Record<Team, string>) {
  const row1Teams: Team[] = ['sense', 'content'];
  const first = agents.filter((a) => row1Teams.includes(a.team));
  const second = agents.filter((a) => !row1Teams.includes(a.team));
  const desks = layoutDesks(first.length, second.length);
  const ordered = [...first, ...second];
  const people: Person[] = ordered.map((a, i) => {
    const desk = desks[i];
    const home = { x: desk.x + 8, y: desk.y - 12 };
    let seed = 0; for (const ch of a.slug) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    return {
      slug: a.slug, name: a.name, team: a.team, look: lookFor(a.slug, a.team),
      desk, home, x: home.x, y: home.y,
      state: a.enabled ? 'idle' : 'sleep', error: a.last_run?.status === 'error', enabled: a.enabled,
      screen: !a.enabled ? 'off' : a.last_run?.status === 'error' ? 'err' : a.last_run ? 'on' : 'off',
      path: null, pathT: 0, onArrive: null, workUntil: 0, bubble: null, lastStroll: performance.now() - Math.random() * 8000, seed,
    };
  });
  // zones: one carpet per team, spanning its desks
  const zones: Zone[] = [];
  for (const team of ['sense', 'content', 'approve', 'ads', 'learn'] as Team[]) {
    const ps = people.filter((p) => p.team === team);
    if (!ps.length) continue;
    const x0 = Math.min(...ps.map((p) => p.desk.x)) - 10, x1 = Math.max(...ps.map((p) => p.desk.x)) + DESK_W + 10;
    const y0 = ps[0].desk.y - CARPET_ABOVE;
    zones.push({ team, label: teamLabels[team], x: x0, y: y0, w: x1 - x0, h: CARPET_ABOVE + 18 + CARPET_BELOW });
  }
  return { people, zones };
}

/** Walk from a to b via the corridor: vertical to the corridor, along it, vertical again. */
export function corridorPath(a: { x: number; y: number }, b: { x: number; y: number }) {
  return [{ x: a.x, y: a.y }, { x: a.x, y: CORRIDOR_Y }, { x: b.x, y: CORRIDOR_Y }, { x: b.x, y: b.y }];
}

function pathLength(p: { x: number; y: number }[]) {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y);
  return l;
}
function pointAt(p: { x: number; y: number }[], t: number) {
  const total = pathLength(p); let d = t * total;
  for (let i = 1; i < p.length; i++) {
    const seg = Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y);
    if (d <= seg || i === p.length - 1) {
      const f = seg ? Math.min(1, d / seg) : 1;
      return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * f, y: p[i - 1].y + (p[i].y - p[i - 1].y) * f, seg: i };
    }
    d -= seg;
  }
  return { ...p[p.length - 1], seg: p.length - 1 };
}

/* ---------- static set dressing, drawn with rects (cheaper than maps for big flat shapes) ---------- */
function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number) {
  ctx.fillStyle = OUTLINE; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#BFE3FF'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#DFF2FF'; ctx.fillRect(x, y, w, Math.round(h * 0.45));
  // a drifting cloud
  const cx = x + ((t / 900 + x) % (w + 12)) - 6;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(Math.round(cx), y + 4, 6, 2); ctx.fillRect(Math.round(cx) + 1, y + 3, 3, 1);
  ctx.fillStyle = OUTLINE; ctx.fillRect(x + Math.floor(w / 2), y, 1, h); ctx.fillRect(x, y + Math.floor(h / 2), w, 1);
  ctx.fillStyle = '#C3CADB'; ctx.fillRect(x - 2, y + h + 1, w + 4, 2);
}
function drawWhiteboard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = OUTLINE; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x, y, w, h);
  const marks: [number, number, number, string][] = [[3, 3, 18, '#4E63D8'], [3, 6, 12, '#4E63D8'], [3, 9, 22, '#D93A3A'], [30, 3, 10, '#1E8E3E'], [30, 6, 14, '#1E8E3E'], [30, 9, 6, '#E8A33D']];
  for (const [mx, my, mw, c] of marks) { ctx.fillStyle = c; ctx.fillRect(x + mx, y + my, mw, 1); }
  ctx.fillStyle = '#E8A33D'; ctx.fillRect(x + 50, y + 3, 5, 5); ctx.fillStyle = '#4E63D8'; ctx.fillRect(x + 57, y + 5, 5, 5);
  ctx.fillStyle = '#C3CADB'; ctx.fillRect(x + 4, y + h + 1, w - 8, 1);
}
function drawClock(ctx: CanvasRenderingContext2D, x: number, y: number, now: number) {
  ctx.fillStyle = OUTLINE; ctx.fillRect(x, y + 1, 9, 7); ctx.fillRect(x + 1, y, 7, 9);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x + 1, y + 1, 7, 7);
  ctx.fillStyle = OUTLINE; ctx.fillRect(x + 4, y + 2, 1, 3);
  const s = Math.floor(now / 1000) % 4;
  ctx.fillRect(x + 4 + [1, 0, -1, 0][s], y + 4 + [0, 1, 0, -1][s], 1, 1);
}
function drawBookshelf(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = OUTLINE; ctx.fillRect(x, y, 18, 20);
  ctx.fillStyle = '#A57A4C'; ctx.fillRect(x + 1, y + 1, 16, 18);
  const spines = ['#4E63D8', '#D93A3A', '#E8A33D', '#1E8E3E', '#7B4EBF', '#2B3A67', '#E8A33D', '#4E63D8'];
  for (let row = 0; row < 3; row++) {
    ctx.fillStyle = '#8B6238'; ctx.fillRect(x + 1, y + 6 + row * 6, 16, 1);
    let bx = x + 2;
    for (let i = 0; i < 5 && bx < x + 15; i++) { const bw = 2 + ((row * 7 + i * 3) % 2); ctx.fillStyle = spines[(row * 3 + i) % spines.length]; ctx.fillRect(bx, y + 2 + row * 6, bw, 4); bx += bw + 1; }
  }
}
function drawSofa(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = OUTLINE; ctx.fillRect(x, y, 26, 10);
  ctx.fillStyle = '#5B74E0'; ctx.fillRect(x + 1, y + 1, 24, 8);
  ctx.fillStyle = '#4E63D8'; ctx.fillRect(x + 1, y + 4, 24, 5);
  ctx.fillStyle = OUTLINE; ctx.fillRect(x + 12, y + 4, 1, 5);
  ctx.fillStyle = '#7C91EA'; ctx.fillRect(x + 1, y + 1, 3, 8); ctx.fillRect(x + 22, y + 1, 3, 8);
}

export class Scene {
  people: Person[];
  zones: Zone[];
  papers: Paper[] = [];
  now = 0;
  selected: string | null = null;
  constructor(people: Person[], zones: Zone[]) { this.people = people; this.zones = zones; }

  person(slug: string) { return this.people.find((p) => p.slug === slug) ?? null; }

  /** The box started running: back to the desk, type, say so. */
  startWork(slug: string, text = 'กำลังทำงาน…') {
    const p = this.person(slug); if (!p) return;
    p.error = false;
    const begin = () => { p.state = 'work'; p.screen = 'on'; p.workUntil = Infinity; p.bubble = { text, until: Infinity }; };
    if (p.state === 'walk' || p.x !== p.home.x || p.y !== p.home.y) this.walkTo(p, p.home, begin); else begin();
  }

  /** The run ended: show the result, pass a paper to the next desk. */
  finishWork(slug: string, summary: string, status: 'ok' | 'skipped' | 'error', nextSlug: string | null) {
    const p = this.person(slug); if (!p) return;
    p.state = p.enabled ? 'idle' : 'sleep';
    p.workUntil = 0;
    p.error = status === 'error';
    p.screen = status === 'error' ? 'err' : 'on';
    p.bubble = { text: summary, until: this.now + 5000 };
    const next = nextSlug ? this.person(nextSlug) : null;
    if (status === 'ok' && next) this.papers.push({ path: corridorPath({ x: p.home.x + 4, y: p.home.y + 8 }, { x: next.home.x + 4, y: next.home.y + 8 }), t: 0, toSlug: next.slug });
  }

  setEnabled(slug: string, on: boolean) {
    const p = this.person(slug); if (!p) return;
    p.enabled = on;
    if (p.state !== 'walk') p.state = on ? 'idle' : 'sleep';
    if (!on) p.screen = 'off';
  }

  walkTo(p: Person, to: { x: number; y: number }, onArrive: (() => void) | null = null) {
    p.path = corridorPath({ x: p.x, y: p.y }, to);
    p.pathT = 0; p.state = 'walk'; p.onArrive = onArrive;
  }

  tick(dt: number, now: number) {
    this.now = now;
    for (const p of this.people) {
      if (p.state === 'walk' && p.path) {
        const len = pathLength(p.path) || 1;
        p.pathT = Math.min(1, p.pathT + (dt * 40) / len);        // 40 px / s
        const at = pointAt(p.path, p.pathT); p.x = at.x; p.y = at.y;
        if (p.pathT >= 1) { p.path = null; p.state = p.enabled ? 'idle' : 'sleep'; const cb = p.onArrive; p.onArrive = null; cb?.(); }
      } else if (p.state === 'idle' && p.enabled && now - p.lastStroll > 14000 + (p.seed % 5) * 3000 && Math.random() < dt * 0.15) {
        // an idle stroll to the cooler and back
        p.lastStroll = now;
        this.walkTo(p, { x: COOLER.x - 16 + (p.seed % 3) * 4, y: COOLER.y - 6 }, () => {
          setTimeout(() => { if (p.state === 'idle') this.walkTo(p, p.home); }, 1400 + Math.random() * 1200);
        });
      }
      if (p.bubble && p.bubble.until < now) p.bubble = null;
    }
    for (const paper of this.papers) {
      const len = pathLength(paper.path) || 1;
      paper.t = Math.min(1, paper.t + (dt * 72) / len);
    }
    this.papers = this.papers.filter((pp) => pp.t < 1);
  }

  private frameFor(p: Person): Frame {
    const t = this.now;
    if (p.state === 'work') return Math.floor(t / 160) % 2 ? 'work1' : 'work0';
    if (p.state === 'walk') return Math.floor(t / 150) % 2 ? 'walk1' : 'walk0';
    if (p.state === 'sleep') return 'sleep';
    return (Math.floor(t / 120) + p.seed) % 32 === 0 ? 'blink' : 'idle';
  }

  render(ctx: CanvasRenderingContext2D) {
    const t = this.now;
    ctx.imageSmoothingEnabled = false;
    // wood floor: planks with offset seams
    for (let y = WALL_H; y < H; y += 6) {
      const row = (y - WALL_H) / 6;
      ctx.fillStyle = row % 2 ? '#EADCC6' : '#E3D3BA'; ctx.fillRect(0, y, W, 6);
      ctx.fillStyle = '#D6C3A5'; ctx.fillRect(0, y + 5, W, 1);
      for (let x = (row % 3) * 22; x < W; x += 64) ctx.fillRect(x, y, 1, 5);
    }
    // wall with baseboard
    ctx.fillStyle = '#E4E8F3'; ctx.fillRect(0, 0, W, WALL_H);
    ctx.fillStyle = '#D5DAE9'; ctx.fillRect(0, WALL_H - 5, W, 3);
    ctx.fillStyle = '#B9C0D6'; ctx.fillRect(0, WALL_H - 2, W, 2);
    ctx.fillStyle = '#C9CFE2'; ctx.fillRect(0, WALL_H, W, 2);   // floor shadow under the wall
    drawWindow(ctx, 30, 5, 26, 16, t); drawWindow(ctx, 96, 5, 26, 16, t + 4000);
    drawWhiteboard(ctx, 176, 4, 66, 17);
    drawClock(ctx, 256, 8, t);
    drawWindow(ctx, 300, 5, 26, 16, t + 9000); drawWindow(ctx, 366, 5, 26, 16, t + 2500);
    drawBookshelf(ctx, 448, 6);

    // carpets
    for (const z of this.zones) {
      const [a, b, border] = TEAM_CARPET[z.team];
      ctx.fillStyle = 'rgba(27,32,51,.10)'; ctx.fillRect(z.x + 1, z.y + 1, z.w, z.h);
      for (let y = z.y; y < z.y + z.h; y += 4) for (let x = z.x; x < z.x + z.w; x += 4) {
        ctx.fillStyle = ((x + y) / 4) % 2 ? a : b; ctx.fillRect(x, y, 4, 4);
      }
      ctx.fillStyle = border; ctx.fillRect(z.x, z.y, z.w, 2); ctx.fillRect(z.x, z.y + z.h - 2, z.w, 2); ctx.fillRect(z.x, z.y, 2, z.h); ctx.fillRect(z.x + z.w - 2, z.y, 2, z.h);
      ctx.fillStyle = TEAM_SHIRT[z.team]; ctx.fillRect(z.x, z.y, 3, z.h);   // team stripe on the left edge
    }
    // corridor: a runner rug down the middle
    ctx.fillStyle = 'rgba(27,32,51,.10)'; ctx.fillRect(1, CORRIDOR_Y - 9, W, 20);
    ctx.fillStyle = '#C9CEDF'; ctx.fillRect(0, CORRIDOR_Y - 10, W, 20);
    ctx.fillStyle = '#BEC4D8'; ctx.fillRect(0, CORRIDOR_Y - 10, W, 1); ctx.fillRect(0, CORRIDOR_Y + 9, W, 1);
    ctx.fillStyle = '#B4BAD0'; for (let x = 6; x < W; x += 18) ctx.fillRect(x, CORRIDOR_Y - 1, 9, 2);

    // set dressing on the floor
    const shadow = (x: number, y: number, w: number) => { ctx.fillStyle = 'rgba(27,32,51,.14)'; ctx.fillRect(x, y, w, 2); };
    ctx.drawImage(furniture('plant'), 6, ROW1_Y + 4); ctx.drawImage(furniture('plant'), W - 16, ROW1_Y + 4);
    ctx.drawImage(furniture('plant'), 4, ROW2_Y + 2); ctx.drawImage(furniture('plant'), W - 14, ROW2_Y + 2);
    shadow(COOLER.x + 1, COOLER.y + 12, 8); ctx.drawImage(furniture('cooler'), COOLER.x, COOLER.y);
    shadow(COFFEE.x + 1, COFFEE.y + 8, 8); ctx.drawImage(furniture('coffee'), COFFEE.x, COFFEE.y);
    drawSofa(ctx, COFFEE.x + 14, COOLER.y + 1);

    // selected desk marker (pulsing)
    if (this.selected) {
      const p = this.person(this.selected);
      if (p) {
        ctx.fillStyle = Math.floor(t / 300) % 2 ? '#FFD84D' : '#FFB800';
        const x = p.desk.x - 3, y = p.home.y - 4, w = DESK_W + 6, h = p.desk.y + 18 - y + 3;
        ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w, y, 1, h + 1);
      }
    }

    // draw in y order so people in front overlap correctly: chairs, desks, people
    const drawables: { y: number; draw: () => void }[] = [];
    for (const p of this.people) {
      const deskSprite = furniture(p.screen === 'err' ? 'deskErr' : p.screen === 'on' ? 'deskOn' : 'desk');
      drawables.push({ y: p.desk.y + 8, draw: () => {
        ctx.fillStyle = 'rgba(27,32,51,.16)'; ctx.fillRect(p.desk.x + 2, p.desk.y + 10, DESK_W - 2, 9);   // desk shadow
        ctx.drawImage(deskSprite, p.desk.x, p.desk.y);
        if (p.screen === 'on') { ctx.fillStyle = 'rgba(95,209,255,.22)'; ctx.fillRect(p.desk.x + 8, p.desk.y - 1, 12, 8); ctx.fillRect(p.desk.x + 9, p.desk.y + 8, 10, 2); }
        if (p.screen === 'err') { ctx.fillStyle = 'rgba(240,118,118,.22)'; ctx.fillRect(p.desk.x + 8, p.desk.y - 1, 12, 8); }
      } });
      // chair behind the person
      drawables.push({ y: p.desk.y - 20, draw: () => {
        ctx.fillStyle = OUTLINE; ctx.fillRect(p.home.x - 1, p.home.y + 7, 14, 8);
        ctx.fillStyle = '#3D3D3D'; ctx.fillRect(p.home.x, p.home.y + 8, 12, 6);
        ctx.fillStyle = '#555555'; ctx.fillRect(p.home.x + 1, p.home.y + 8, 10, 1);
      } });
      const frame = this.frameFor(p);
      const behindDesk = p.x === p.home.x && p.y === p.home.y;
      const px = Math.round(p.x), py = Math.round(p.y);
      drawables.push({ y: behindDesk ? p.desk.y - 1 : p.y + 18, draw: () => {
        if (!behindDesk) { ctx.fillStyle = 'rgba(27,32,51,.18)'; ctx.fillRect(px + 2, py + 17, 8, 2); }
        ctx.drawImage(charSprite(p.look, frame), px, py);
        if (p.state === 'sleep') {
          ctx.fillStyle = '#6E7490';
          const b = Math.floor(t / 500) % 2;
          ctx.fillRect(px + 11, py - 2 + b, 2, 2); ctx.fillRect(px + 14, py - 6 + b, 3, 3);
        }
        if (p.state === 'work' && Math.floor(t / 90) % 3 === 0) { ctx.fillStyle = '#FFD84D'; ctx.fillRect(px + 2 + (Math.floor(t / 90) % 5) * 2, py + 12, 1, 1); }
        if (p.error) { ctx.fillStyle = '#D93A3A'; ctx.fillRect(px + 5, py - 8, 2, 5); ctx.fillRect(px + 5, py - 2, 2, 1); }
      } });
    }
    drawables.sort((a, b) => a.y - b.y).forEach((d) => d.draw());
    // papers on top
    for (const paper of this.papers) {
      const at = pointAt(paper.path, paper.t);
      ctx.fillStyle = 'rgba(27,32,51,.18)'; ctx.fillRect(Math.round(at.x) + 1, Math.round(at.y) + 5, 4, 1);
      ctx.drawImage(furniture('paper'), Math.round(at.x), Math.round(at.y) - (Math.floor(t / 200) % 2));
    }
    // soft vignette so the floor reads as one room
    const g = ctx.createLinearGradient(0, H - 30, 0, H);
    g.addColorStop(0, 'rgba(27,32,51,0)'); g.addColorStop(1, 'rgba(27,32,51,.08)');
    ctx.fillStyle = g; ctx.fillRect(0, H - 30, W, 30);
  }
}
