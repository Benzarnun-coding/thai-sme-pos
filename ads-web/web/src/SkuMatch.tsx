// "จับคู่ SKU": match another system's SKU (Lazada's own id, a typo, an old code) to one of ours, once — every later
// order with that SKU is read as ours (right sheet, cost, sales). Used on the order page's ตรวจสอบ rows and งานค้าง.

import { useMemo, useState } from 'react';
import { api, type CatalogAlias } from './api.ts';
import { colorLabel, type CatalogRow } from './catalog.ts';
import { suggestSkus } from './purchase.ts';
import { useUi } from './ui.tsx';

export function SkuMatch({ alias, initialQuery, rows, onMatched }: {
  alias: string; initialQuery: string; rows: CatalogRow[]; onMatched: (a: CatalogAlias) => void;
}) {
  const { toast } = useUi();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const hits = useMemo(() => (open ? suggestSkus(rows, q, 8) : []), [open, rows, q]);
  async function pick(r: CatalogRow) {
    setBusy(true);
    try {
      const { alias: saved } = await api.setAlias(alias, r.sku);
      if (saved) onMatched(saved);
      toast(`จับคู่ ${alias} = ${r.sku} แล้ว · ออเดอร์ต่อไปเข้าใบที่ถูกเอง`, 'ok');
      setOpen(false);
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }
  if (!open) return <button className="link small" onClick={() => setOpen(true)} title="บอกว่า SKU นี้คือสินค้าตัวไหนของเรา ระบบจำไว้ใช้ทุกวัน">จับคู่ SKU ของเรา</button>;
  return (
    <div className="sku-match">
      <input value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="รหัส สี ไซส์ เช่น 101/1 ดำ 32" aria-label="ค้นหา SKU ของเรา"
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && hits[0]) pick(hits[0]); }} />
      <div className="sku-match-list">
        {hits.map((r) => (
          <button key={`${r.tab}|${r.sku}`} className="sku-match-item" disabled={busy} onClick={() => pick(r)}>
            <code>{r.sku}</code>
            <span className="muted small">{r.code}{r.color ? ` · ${colorLabel(r.color)}` : ''}{r.size ? ` · ${r.size}` : ''} · {r.tab}</span>
          </button>
        ))}
        {!hits.length && <span className="muted small">ไม่พบ · ลองพิมพ์แค่รหัส เช่น 101/1</span>}
      </div>
      <button className="link small" onClick={() => setOpen(false)}>ยกเลิก</button>
    </div>
  );
}
