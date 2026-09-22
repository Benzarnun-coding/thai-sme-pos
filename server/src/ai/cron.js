/**
 * A five-field cron matcher and "next fire" finder, in plain JS so the
 * published demo can show the same "next run" times the server computes.
 * Supports *, numbers, lists, ranges and steps (e.g. "30 *\/6 * * 1-5").
 */

/** @param {string} field @param {number} min @param {number} max @returns {Set<number>} */
function expand(field, min, max) {
  const out = new Set();
  for (const part of field.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`cron: bad field "${field}"`);
    const step = m[2] ? Number(m[2]) : 1;
    let lo = min, hi = max;
    if (m[1] !== '*') { const [a, b] = m[1].split('-').map(Number); lo = a; hi = b === undefined ? (m[2] ? max : a) : b; }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** @param {string} expr */
export function parseCron(expr) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`cron: expected 5 fields, got "${expr}"`);
  return { minute: expand(f[0], 0, 59), hour: expand(f[1], 0, 23), day: expand(f[2], 1, 31), month: expand(f[3], 1, 12), dow: expand(f[4], 0, 6) };
}

/** Local-time parts of a Date in a given IANA zone (Bangkok has no DST, so an offset would do, but this stays general). */
function partsIn(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
  const p = {};
  for (const { type, value } of fmt.formatToParts(date)) p[type] = value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { minute: Number(p.minute), hour: Number(p.hour) % 24, day: Number(p.day), month: Number(p.month), dow };
}

/** Does this cron fire at this minute? */
export function cronMatches(expr, date, tz = 'Asia/Bangkok') {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  const p = partsIn(date, tz);
  return c.minute.has(p.minute) && c.hour.has(p.hour) && c.day.has(p.day) && c.month.has(p.month) && c.dow.has(p.dow);
}

/** The next minute (strictly after `from`) at which the cron fires, scanning up to 8 days; null if none. */
export function nextFire(expr, from = new Date(), tz = 'Asia/Bangkok') {
  const c = parseCron(expr);
  const t = new Date(from); t.setSeconds(0, 0); t.setMinutes(t.getMinutes() + 1);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    if (cronMatches(c, t, tz)) return t;
    t.setMinutes(t.getMinutes() + 1);
  }
  return null;
}
