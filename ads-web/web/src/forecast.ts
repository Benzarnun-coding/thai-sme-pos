// How long our stock lasts (/catalog/stock): a sales forecast per model that follows the trend, split over sizes.
//   Demand: พี่เปีย = TikTok/Shopee pieces from the order-sheet rounds; GoSell = Facebook pieces from Page365.
//   Per model (sizes summed, less noisy than one size): pieces per day over the last 28 days that have data, today
//   left out (not finished). ≥ 7 days → a straight line fitted with recent days counting more (weight 0.9 per day
//   back); fewer → the average. The line is kept between ¼ and 3× the average, so a short dip or spike can't
//   predict zero or a flood.
//   Per size: the model's forecast × the size's share of the model's pieces (with a small floor, so a size that
//   hasn't sold lately still counts a little). Days of cover = the day the forecast sales use up the balance.

export interface Forecast {
  /** 'trend' (≥ 7 days of data), 'average' (fewer), 'none' (no data) */
  method: 'trend' | 'average' | 'none';
  /** days of data used */
  days: number;
  /** average pieces/day over the data days */
  mean: number;
  /** average of the last 7 data days, and of the 7 before (null when there are not 14 days) */
  last7: number;
  prev7: number | null;
  /** predicted pieces on day d (1 = tomorrow) */
  at: (d: number) => number;
}

const NONE: Forecast = { method: 'none', days: 0, mean: 0, last7: 0, prev7: null, at: () => 0 };

/** points: pieces per data day, `age` = days before today (1 = yesterday). Today's partial day is ignored. */
export function forecast(points: { age: number; qty: number }[]): Forecast {
  const pts = points.filter((p) => p.age >= 1).sort((a, b) => a.age - b.age);
  if (!pts.length) return NONE;
  const mean = pts.reduce((t, p) => t + p.qty, 0) / pts.length;
  const avg = (list: typeof pts) => list.reduce((t, p) => t + p.qty, 0) / list.length;
  const last7 = avg(pts.slice(0, 7));
  const prev7 = pts.length >= 14 ? avg(pts.slice(7, 14)) : null;
  const clamp = (v: number) => Math.min(3 * mean, Math.max(0.25 * mean, v));
  if (pts.length < 7) return { method: 'average', days: pts.length, mean, last7, prev7, at: () => mean };
  // Weighted least squares: qty = a + b·x, x = −age (x = 0 is today), weight 0.9^(age − 1).
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) {
    const w = 0.9 ** (p.age - 1), x = -p.age;
    sw += w; sx += w * x; sy += w * p.qty; sxx += w * x * x; sxy += w * x * p.qty;
  }
  const den = sw * sxx - sx * sx;
  const b = den ? (sw * sxy - sx * sy) / den : 0;
  const a = (sy - b * sx) / sw;
  return { method: 'trend', days: pts.length, mean, last7, prev7, at: (d) => clamp(a + b * d) };
}

/** A size's share of its model's pieces, with a floor of half a piece per size so unsold sizes still count a little. */
export function sizeShares(pieces: Map<string, number>, sizes: string[]): Map<string, number> {
  const total = sizes.reduce((t, s) => t + (pieces.get(s) ?? 0), 0) + 0.5 * sizes.length;
  return new Map(sizes.map((s) => [s, ((pieces.get(s) ?? 0) + 0.5) / total]));
}

/** Days until the forecast sales use up `stock` (fractional); 0 when there is none; null when beyond `cap` days. */
export function coverDays(stock: number, f: Forecast, share: number, cap = 90): number | null {
  if (stock <= 0) return 0;
  let used = 0;
  for (let d = 1; d <= cap; d++) {
    const day = f.at(d) * share;
    if (day <= 0) continue;
    if (used + day >= stock) return d - 1 + (stock - used) / day;
    used += day;
  }
  return null;
}

/** Pieces to add so the stock lasts `days` more days (0 when it already does). */
export function refill(stock: number, f: Forecast, share: number, days: number): number {
  let need = 0;
  for (let d = 1; d <= days; d++) need += f.at(d) * share;
  return Math.max(0, Math.ceil(need - Math.max(0, stock)));
}
