// Catalog data shared by /catalog and /catalog/orders: meta (tabs, web SKUs, pictures, suppliers set on the page) and
// every sheet row, loaded page by page. Pages are cached by the browser per catalog_version, so moving between the
// two pages costs no D1 reads.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CatalogMeta, type Role } from './api.ts';
import { rowFromArray, thumb, type CatalogRow, type ImageOverride } from './catalog.ts';

export function useCatalog() {
  const [meta, setMeta] = useState<CatalogMeta | null>(null);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState<{ done: number; of: number } | null>({ done: 0, of: 0 });
  const [error, setError] = useState('');
  const [role, setRole] = useState<Role>('viewer');

  useEffect(() => { api.me().then((m) => setRole(m.role)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setError('');
    setLoading({ done: 0, of: 0 });
    try {
      const m = await api.catalog();
      setMeta(m);
      const of = m.tabs.reduce((t, x) => t + x.skus, 0);
      setLoading({ done: 0, of });
      let done = 0;
      const parts = await Promise.all(m.tabs.map(async (t) => {
        const out: CatalogRow[] = [];
        for (let after = ''; ;) {
          const page = await api.catalogRows(t.tab, after, m.version);
          for (const a of page.rows) out.push(rowFromArray(a));
          done += page.rows.length;
          setLoading({ done, of });
          if (!page.next) break;
          after = page.next;
        }
        return out;
      }));
      setRows(parts.flat());
      setLoading(null);
    } catch (e: any) {
      setError(e.message);
      setLoading(null);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const images = meta?.images;
  const imageMap = useMemo(() => new Map<string, ImageOverride>((images ?? []).map((i) => {
    const src = (size: string) => `/api/catalog/image?key=${encodeURIComponent(i.key)}&size=${size}&v=${encodeURIComponent(i.updated_at)}`;
    return [i.key, i.uploaded ? { full: src('full'), thumb: src('thumb') } : { full: i.url ?? '', thumb: thumb(i.url ?? '') }];
  })), [images]);
  const suppliers = meta?.suppliers;
  const supplierMap = useMemo(() => new Map((suppliers ?? []).map((s) => [s.key, s.shop])), [suppliers]);
  const prices = meta?.prices;
  const priceMap = useMemo(() => new Map((prices ?? []).map((p) => [p.key, p.price])), [prices]);
  const sellPrices = meta?.sell_prices;
  const sellMap = useMemo(() => new Map((sellPrices ?? []).map((p) => [p.key, p.price])), [sellPrices]);
  const labels = meta?.labels;
  const labelMap = useMemo(() => new Map((labels ?? []).map((l) => [l.key, l.label])), [labels]);
  const aliases = meta?.aliases;
  const aliasMap = useMemo(() => new Map((aliases ?? []).map((a) => [a.alias, a.sku])), [aliases]);
  const canEdit = role === 'owner' || role === 'admin' || role === 'costs';

  return { meta, setMeta, rows, setRows, loading, error, load, role, canEdit, imageMap, supplierMap, priceMap, sellMap, labelMap, aliasMap };
}
