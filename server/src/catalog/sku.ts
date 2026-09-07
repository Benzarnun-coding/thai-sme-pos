/**
 * SKU format used by the master catalog / Bigseller:
 *   [ประเภท]-[สถานที่]-[สี]-[ขนาด]   e.g.  KB-PK-BK-32
 *
 * Parsing is deliberately tolerant: extra dashes inside the type part are
 * folded back into the type so "KB-SLIM-PK-BK-32" still works.
 */
export interface ParsedSku {
  sku: string;
  type: string;
  location: string;
  color: string;
  size: string;
}

export function parseSku(input: string): ParsedSku {
  const sku = input.trim().toUpperCase();
  const parts = sku.split('-').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 4) throw new Error(`SKU "${input}" must have 4 parts: ประเภท-สถานที่-สี-ขนาด`);
  const size = parts[parts.length - 1];
  const color = parts[parts.length - 2];
  const location = parts[parts.length - 3];
  const type = parts.slice(0, parts.length - 3).join('-');
  return { sku, type, location, color, size };
}

export function buildSku(p: Omit<ParsedSku, 'sku'>): string {
  return [p.type, p.location, p.color, p.size].map((s) => s.trim().toUpperCase()).join('-');
}

/** Sort sizes numerically when they are numbers (28 < 30 < ... < 44), else alphabetically. */
export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
}
