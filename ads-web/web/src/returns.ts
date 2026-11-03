// Returned parcels (idea #20): the number on the parcel → the SKUs of that parcel, from the Bigseller file loaded in the browser.
import { cleanSku } from './catalog.ts';
import type { OrderItem } from './purchase.ts';

/** Scanner output → comparable parcel number (upper case, no spaces / dashes). */
export const normTrack = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function trackHash(track: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normTrack(track)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** parcel number → its items (SKU summed). Rows without a parcel number are skipped. */
export function byTracking(items: OrderItem[]): Map<string, { sku: string; qty: number }[]> {
  const out = new Map<string, Map<string, number>>();
  for (const it of items) {
    const t = normTrack(it.tracking);
    const sku = cleanSku(it.sku);
    if (!t || !sku) continue;
    const m = out.get(t) ?? new Map<string, number>();
    m.set(sku, (m.get(sku) ?? 0) + it.qty);
    out.set(t, m);
  }
  return new Map([...out].map(([t, m]) => [t, [...m].map(([sku, qty]) => ({ sku, qty }))]));
}
