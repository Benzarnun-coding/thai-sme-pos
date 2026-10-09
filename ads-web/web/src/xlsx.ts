// Reads the first sheet of an .xlsx in the browser (no library): unzip with DecompressionStream, parse the
// shared strings and the sheet XML. Enough for Page365's export; not a general spreadsheet reader.

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

interface Entry { start: number; size: number; method: number }

/** Local-file entries by name, from the central directory at the end of the zip. */
function zipEntries(b: Uint8Array): Map<string, Entry> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 70_000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ไฟล์ไม่ใช่ zip/xlsx');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, Entry>();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(off + 26, true), lelen = dv.getUint16(off + 28, true);
    out.set(name, { start: off + 30 + lnlen + lelen, size: csize, method });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

async function inflate(data: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return data;
  if (method !== 8) throw new Error(`zip method ${method} ไม่รองรับ`);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
