// Zip read/write with the platform's (De)CompressionStream — no library, works in the browser and in Node tests.
// xlsx.ts reads Page365's export with it; gosell.ts edits the GoSell template's XML and packs it again.

/** Every file in a zip, decompressed. */
export async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const [name, e] of zipEntries(buf)) out.set(name, await inflate(buf.subarray(e.start, e.start + e.size), e.method));
  return out;
}

/** Packs files into a zip (deflate), in the given order. */
export async function zip(files: Map<string, Uint8Array>): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const packed = await deflate(data);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 8, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, packed.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 8, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, packed.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    parts.push(local, packed);
    central.push(cd);
    offset += local.length + packed.length;
  }
  const cdSize = central.reduce((t, c) => t + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.size, true); ev.setUint16(10, files.size, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((t, a) => t + a.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Response(data as Uint8Array<ArrayBuffer>).body!.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
}

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Entry { start: number; size: number; method: number }

/** Local-file entries by name, from the central directory at the end of the zip. */
export function zipEntries(b: Uint8Array): Map<string, Entry> {
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

export async function inflate(data: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return data;
  if (method !== 8) throw new Error(`zip method ${method} ไม่รองรับ`);
  return new Uint8Array(await new Response(new Response(data as Uint8Array<ArrayBuffer>).body!.pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}
