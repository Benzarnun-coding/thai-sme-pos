export function baht(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const s = `฿${Math.abs(n).toLocaleString('th-TH', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
  return n < 0 ? `-${s}` : s;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return n.toLocaleString('th-TH', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function roas(value: number, spend: number): string {
  return spend > 0 ? num(value / spend, 2) : '–';
}

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
}

/** good = at or above target, warn = profitable but under target, bad = losing money */
export function roasTone(r: number | null, breakeven: number | null): 'good' | 'warn' | 'bad' | '' {
  if (r === null || breakeven === null || !Number.isFinite(r)) return '';
  if (r < breakeven) return 'bad';
  if (r < breakeven * 1.3) return 'warn';
  return 'good';
}
