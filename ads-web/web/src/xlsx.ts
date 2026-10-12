// Reads the first sheet of an .xlsx in the browser (no library): unzip with DecompressionStream, parse the
// shared strings and the sheet XML. Enough for Page365's export; not a general spreadsheet reader.

import { inflate, zipEntries } from './zip.ts';

export type SheetRow = Record<string, string>;

export async function readFirstSheet(file: File): Promise<{ sheet: string; headers: string[]; rows: SheetRow[] }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = zipEntries(buf);
  const text = async (name: string) => {
    const e = entries.get(name);
    if (!e) return null;
    return new TextDecoder().decode(await inflate(buf.subarray(e.start, e.start + e.size), e.method));
  };
  const wb = await text('xl/workbook.xml');
  if (!wb) throw new Error('ไม่ใช่ไฟล์ Excel (.xlsx)');
  const sheetName = new DOMParser().parseFromString(wb, 'application/xml').getElementsByTagName('sheet')[0]?.getAttribute('name') ?? 'Sheet1';
  const shared: string[] = [];
  const ss = await text('xl/sharedStrings.xml');
  if (ss) {
    const doc = new DOMParser().parseFromString(ss, 'application/xml');
    for (const si of Array.from(doc.getElementsByTagName('si'))) shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent ?? '').join(''));
  }
  const sheetXml = await text('xl/worksheets/sheet1.xml');
  if (!sheetXml) throw new Error('ไม่พบชีตแรกในไฟล์');
  const doc = new DOMParser().parseFromString(sheetXml, 'application/xml');
  const rowsRaw: Record<string, string>[] = [];
  for (const r of Array.from(doc.getElementsByTagName('row'))) {
    const cells: Record<string, string> = {};
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const ref = (c.getAttribute('r') ?? '').replace(/\d+$/, '');
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent;
      let val: string | null = null;
      if (v !== undefined && v !== null) val = t === 's' ? shared[Number(v)] ?? '' : v;
      else if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent ?? '').join('');
      if (val !== null && val !== '') cells[ref] = val;
    }
    rowsRaw.push(cells);
  }
  const header = rowsRaw[0] ?? {};
  const cols = Object.keys(header);
  const rows = rowsRaw.slice(1).filter((r) => Object.keys(r).length).map((r) => {
    const o: SheetRow = {};
    for (const col of cols) if (r[col] !== undefined) o[header[col]] = r[col];
    return o;
  });
  return { sheet: sheetName, headers: cols.map((c) => header[c]), rows };
}
