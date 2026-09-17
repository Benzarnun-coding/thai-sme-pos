/**
 * The office as a tiny simulation.
 *
 * Thirteen people at thirteen desks, in loop order, in two rows with a corridor
 * between. A box that runs makes its person type; when the run ends a paper
 * walks from that desk to the next one in the loop. Disabled boxes sleep at
 * their desk; an errored run puts a red mark over the head. Idle people
 * occasionally stroll to the water cooler so the floor never looks frozen.
 *
 * Logical canvas is 384×216 and is scaled by CSS; overlays (labels, bubbles,
 * tooltips) are DOM elements positioned in percent so they follow the scale.
 */
import { charSprite, furniture, lookFor, TEAM_CARPET, type Look, type Team } from './sprites';

export const W = 384;
export const H = 216;

export interface Person {
  slug: string;
  name: string;
  team: Team;
  look: Look;
  desk: { x: number; y: number };       // desk top-left
  home: { x: number; y: number };       // where the person stands (behind the desk)
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
}

export interface Paper { path: { x: number; y: number }[]; t: number; toSlug: string }

export interface Zone { team: Team; label: string; x: number; y: number; w: number; h: number }

// Rows leave room above the top row for speech bubbles and below the bottom row for name tags.
const CORRIDOR_Y = 124;
const COOLER = { x: 186, y: 106 };
const ROW1_Y = 58;   // desk top
const ROW2_Y = 164;

/** Which team sits in which row; row 1 reads left→right, row 2 continues left→right under it. */
function layoutDesks(n1: number, n2: number) {
  const row1 = Array.from({ length: n1 }, (_, i) => ({ x: Math.round(18 + i * ((W - 36 - 22) / Math.max(1, n1 - 1))), y: ROW1_Y }));
  const row2 = Array.from({ length: n2 }, (_, i) => ({ x: Math.round(14 + i * ((W - 28 - 22) / Math.max(1, n2 - 1))), y: ROW2_Y }));
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
    const home = { x: desk.x + 7, y: desk.y - 6 };
    return {
      slug: a.slug, name: a.name, team: a.team, look: lookFor(a.slug, a.team),
      desk, home, x: home.x, y: home.y,
      state: a.enabled ? 'idle' : 'sleep', error: a.last_run?.status === 'error', enabled: a.enabled,
      screen: !a.enabled ? 'off' : a.last_run?.status === 'error' ? 'err' : a.last_run ? 'on' : 'off',
      path: null, pathT: 0, onArrive: null, workUntil: 0, bubble: null, lastStroll: performance.now() - Math.random() * 8000,
    };
  });
  // zones: one carpet per team, spanning its desks
  const zones: Zone[] = [];
  for (const team of ['sense', 'content', 'approve', 'ads', 'learn'] as Team[]) {
    const ps = people.filter((p) => p.team === team);
    if (!ps.length) continue;
    const x0 = Math.min(...ps.map((p) => p.desk.x)) - 8, x1 = Math.max(...ps.map((p) => p.desk.x)) + 22 + 8;
    const y0 = ps[0].desk.y - 26;
    zones.push({ team, label: teamLabels[team], x: x0, y: y0, w: x1 - x0, h: 12 + 26 + 14 });
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

export class Scene {
  people: Person[];
  zones: Zone[];
  papers: Paper[] = [];
  now = 0;
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
    if (status === 'ok' && next) this.papers.push({ path: corridorPath({ x: p.home.x + 3, y: p.home.y + 4 }, { x: next.home.x + 3, y: next.home.y + 4 }), t: 0, toSlug: next.slug });
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
        p.pathT = Math.min(1, p.pathT + (dt * 38) / len);        // 38 px / s
        const at = pointAt(p.path, p.pathT); p.x = at.x; p.y = at.y;
        if (p.pathT >= 1) { p.path = null; p.state = p.enabled ? 'idle' : 'sleep'; const cb = p.onArrive; p.onArrive = null; cb?.(); }
      } else if (p.state === 'idle' && p.enabled && now - p.lastStroll > 14000 + (p.slug.length % 5) * 3000 && Math.random() < dt * 0.15) {
        // an idle stroll to the cooler and back
        p.lastStroll = now;
        this.walkTo(p, { x: COOLER.x - 6 + (p.slug.length % 3) * 6, y: COOLER.y + 10 }, () => {
          setTimeout(() => { if (p.state === 'idle') this.walkTo(p, p.home); }, 1400 + Math.random() * 1200);
        });
      }
      if (p.bubble && p.bubble.until < now) p.bubble = null;
    }
    for (const paper of this.papers) {
      const len = pathLength(paper.path) || 1;
      paper.t = Math.min(1, paper.t + (dt * 70) / len);
    }
    this.papers = this.papers.filter((pp) => pp.t < 1);
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingEnabled = false;
    // floor
    for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) {
      ctx.fillStyle = ((x + y) / 8) % 2 ? '#EEF0F7' : '#E7EAF4'; ctx.fillRect(x, y, 8, 8);
    }
    // corridor
    ctx.fillStyle = '#D7DBE8'; ctx.fillRect(0, CORRIDOR_Y - 10, W, 20);
    ctx.fillStyle = '#C9CEDF'; for (let x = 4; x < W; x += 16) ctx.fillRect(x, CORRIDOR_Y - 1, 8, 2);
    // carpets
    for (const z of this.zones) {
      const [a, b] = TEAM_CARPET[z.team];
      for (let y = z.y; y < z.y + z.h; y += 4) for (let x = z.x; x < z.x + z.w; x += 4) {
        ctx.fillStyle = ((x + y) / 4) % 2 ? a : b; ctx.fillRect(x, y, 4, 4);
      }
      ctx.strokeStyle = 'rgba(27,32,51,.18)'; ctx.lineWidth = 1; ctx.strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);
    }
    // plants & cooler
    ctx.drawImage(furniture('plant'), 4, ROW1_Y + 10); ctx.drawImage(furniture('plant'), W - 10, ROW2_Y + 12);
    ctx.drawImage(furniture('cooler'), COOLER.x, COOLER.y);

    // draw in y order so people in front overlap correctly: desks, then people sorted by y
    const drawables: { y: number; draw: () => void }[] = [];
    for (const p of this.people) {
      const deskSprite = furniture(p.screen === 'err' ? 'deskErr' : p.screen === 'on' ? 'deskOn' : 'desk');
      drawables.push({ y: p.desk.y + 6, draw: () => ctx.drawImage(deskSprite, p.desk.x, p.desk.y) });
      const frame = p.state === 'work' ? (Math.floor(this.now / 160) % 2 ? 'work1' : 'work0')
        : p.state === 'walk' ? (Math.floor(this.now / 140) % 2 ? 'walk1' : 'walk0')
        : p.state === 'sleep' ? 'sleep' : 'idle';
      const behindDesk = p.x === p.home.x && p.y === p.home.y;
      drawables.push({ y: behindDesk ? p.desk.y - 1 : p.y + 12, draw: () => {
        ctx.drawImage(charSprite(p.look, frame), Math.round(p.x), Math.round(p.y));
        if (p.state === 'sleep') { ctx.fillStyle = '#8A90A8'; ctx.fillRect(Math.round(p.x) + 8, Math.round(p.y) - 3 + (Math.floor(this.now / 500) % 2), 2, 2); ctx.fillRect(Math.round(p.x) + 10, Math.round(p.y) - 6, 2, 2); }
        if (p.error) { ctx.fillStyle = '#D93A3A'; ctx.fillRect(Math.round(p.x) + 3, Math.round(p.y) - 6, 2, 4); ctx.fillRect(Math.round(p.x) + 3, Math.round(p.y) - 1, 2, 1); }
      } });
    }
    drawables.sort((a, b) => a.y - b.y).forEach((d) => d.draw());
    // papers on top
    for (const paper of this.papers) {
      const at = pointAt(paper.path, paper.t);
      ctx.drawImage(furniture('paper'), Math.round(at.x), Math.round(at.y) - (Math.floor(this.now / 200) % 2));
    }
  }
}
