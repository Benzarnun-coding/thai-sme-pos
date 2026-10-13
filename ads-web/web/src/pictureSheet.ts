// Picture order sheets for the China warehouse (CN): pictures are easier to pick from than a list. Text stays as it
// is in the sheet and in Bigseller (no translation). PNG pages drawn on a canvas in the browser:
//   orderPictureSheets  one block per order, like Bigseller's picking list (order no., carrier + tracking, photo,
//                       product name, SKU, option, quantity, store, ทั้งหมด, cut line) — CN packs each order itself
//   pictureSheets       one block per product: photo, code, colour, sizes × quantity, order numbers per size
// Photos from other sites come through /api/catalog/image-proxy so the canvas can still be exported.

import { colorLabel } from './catalog.ts';
import { thaiShortDate, type OrderBlock, type PictureBlock } from './purchase.ts';

const W = 1080;
const PAD = 36;
const HEAD = 150;
const MAX_HEIGHT = 2300;
const FONT = '"Sukhumvit Set", Thonburi, "Leelawadee UI", "Noto Sans Thai", Tahoma, -apple-system, "Segoe UI", Arial, sans-serif';

/** Same-origin pictures as they are; others through the Worker. */
export function drawableUrl(src: string): string {
  if (!src) return '';
  return src.startsWith('/') ? src : `/api/catalog/image-proxy?url=${encodeURIComponent(src)}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = drawableUrl(src);
  });
}

async function loadAll(srcs: string[]): Promise<Map<string, HTMLImageElement | null>> {
  const images = new Map<string, HTMLImageElement | null>();
  await Promise.all([...new Set(srcs.filter(Boolean))].map(async (src) => { images.set(src, await loadImage(src)); }));
  return images;
}

function drawPhoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null | undefined, x: number, y: number, size: number) {
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(x, y, size, size);
  if (img) {
    const s = Math.max(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();
    ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
    ctx.restore();
  } else {
    ctx.fillStyle = '#9ca3af';
    ctx.font = `600 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ไม่มีรูป', x + size / 2, y + size / 2);
    ctx.textAlign = 'left';
  }
  ctx.strokeStyle = '#d1d5db';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, size, size);
}

/** Text broken into lines that fit `width` (at a space when there is one, else mid-word, as Thai has none); at most `max`. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (line && ctx.measureText(line + ch).width > width) {
      const cut = line.lastIndexOf(' ');
      if (cut > line.length / 2) { lines.push(line.slice(0, cut)); line = line.slice(cut + 1) + ch; } else { lines.push(line); line = ch; }
    } else line += ch;
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), `${lines[max - 1].slice(0, -1)}…`];
}

function header(ctx: CanvasRenderingContext2D, title: string, date: string, round: number, right: string, page: string) {
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, W, HEAD - 24);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.font = `700 54px ${FONT}`;
  ctx.fillText(title, PAD, 50);
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(`${thaiShortDate(date)}  ·  รอบ ${round}`, PAD, 96);
  ctx.textAlign = 'right';
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(right, W - PAD, 50);
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(page, W - PAD, 96);
  ctx.textAlign = 'left';
}

async function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('สร้างรูปไม่สำเร็จ');
  return blob;
}

function newCanvas(height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, height);
  return [canvas, ctx];
}

function paginate<T>(list: T[], heightOf: (x: T) => number): T[][] {
  const pages: T[][] = [[]];
  let h = HEAD;
  for (const x of list) {
    if (pages[pages.length - 1].length && h + heightOf(x) > MAX_HEIGHT - PAD) { pages.push([]); h = HEAD; }
    pages[pages.length - 1].push(x);
    h += heightOf(x);
  }
  return pages;
}

// ---- per order (Bigseller picking-list layout) ----

/** "TikTok-TH-J&T Express" → "J&T Express". */
export function shortCarrier(c: string): string {
  return c.replace(/^(tiktok|shopee|lazada)-th-/i, '').trim();
}

const ORDER_HEAD = 64;
const ITEM_H = 200;
const ITEM_PHOTO = 170;
const ORDER_FOOT = 96;

export async function orderPictureSheets(title: string, date: string, round: number, orders: OrderBlock[]): Promise<Blob[]> {
  const heightOf = (o: OrderBlock) => ORDER_HEAD + o.items.length * ITEM_H + ORDER_FOOT;
  const pages = paginate(orders, heightOf);
  const images = await loadAll(orders.flatMap((o) => o.items.map((i) => i.image)));
  const pieces = orders.reduce((n, o) => n + o.qty, 0);
  const out: Blob[] = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const [canvas, ctx] = newCanvas(HEAD + page.reduce((n, o) => n + heightOf(o), 0) + PAD);
    header(ctx, title, date, round, `${orders.length} ออเดอร์ · ${pieces} ชิ้น`, pages.length > 1 ? `หน้า ${pi + 1}/${pages.length}` : '');

    let top = HEAD;
    for (const o of page) {
      // Order No. … | carrier (#tracking)
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#111827';
      ctx.font = `600 28px ${FONT}`;
      ctx.fillText(`Order No. ${o.order || '—'}`, PAD, top + 40, 520);
      ctx.textAlign = 'right';
      ctx.font = `500 26px ${FONT}`;
      ctx.fillText(`${shortCarrier(o.carrier)}${o.tracking ? ` (#${o.tracking})` : ''}`, W - PAD, top + 40, 470);
      ctx.textAlign = 'left';
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(PAD, top + 54); ctx.lineTo(W - PAD, top + 54); ctx.stroke();

      let iy = top + ORDER_HEAD;
      for (const it of o.items) {
        drawPhoto(ctx, images.get(it.image), PAD, iy + 12, ITEM_PHOTO);
        const tx = PAD + ITEM_PHOTO + 24, tw = W - tx - PAD - 130;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#111827';
        ctx.font = `500 26px ${FONT}`;
        wrapText(ctx, it.name || it.code, tw, 2).forEach((line, i) => ctx.fillText(line, tx, iy + 44 + i * 34));
        ctx.font = `700 32px ${FONT}`;
        ctx.fillText(it.sku, tx, iy + 126, tw);
        ctx.fillStyle = '#374151';
        ctx.font = `500 26px ${FONT}`;
        ctx.fillText(it.option || `${colorLabel(it.color)} ${it.size}`, tx, iy + 166, tw);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#111827';
        ctx.font = `800 64px ${FONT}`;
        ctx.fillText(String(it.qty), W - PAD - 20, iy + 116);
        ctx.textAlign = 'left';
        iy += ITEM_H;
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD, iy); ctx.lineTo(W - PAD, iy); ctx.stroke();
      }

      // store, ทั้งหมด, then the cut line
      ctx.textAlign = 'right';
      ctx.fillStyle = '#111827';
      ctx.font = `500 26px ${FONT}`;
      ctx.fillText(o.store, W - PAD, iy + 34, 600);
      ctx.font = `700 28px ${FONT}`;
      ctx.fillText(`ทั้งหมด: ${o.qty}`, W - PAD, iy + 70);
      ctx.textAlign = 'left';
      const cut = iy + ORDER_FOOT - 8;
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 8]);
      ctx.beginPath(); ctx.moveTo(PAD, cut); ctx.lineTo(W - PAD - 44, cut); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#6b7280';
      ctx.font = `400 34px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('✂', W - PAD - 34, cut);
      top += heightOf(o);
    }
    out.push(await toPng(canvas));
  }
  return out;
}

// ---- per product ----

const PHOTO = 220;
const MIN_BLOCK = PHOTO + 40;
const MONO = '500 21px Menlo, Consolas, "Courier New", monospace';
const ORDER_LINE = 28;

export async function pictureSheets(title: string, date: string, round: number, blocks: PictureBlock[]): Promise<Blob[]> {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `600 30px ${FONT}`;
  const textX = PAD + PHOTO + 28;
  const textW = W - textX - PAD - 150;
  const chipW = (t: string) => measure.measureText(t).width + 28;
  const laid = blocks.map((block) => {
    const chips = block.sizes.map((s) => `${s.size || '—'} × ${s.qty}`);
    const lines: string[][] = [[]];
    let x = 0;
    for (const c of chips) {
      if (x > 0 && x + chipW(c) > textW) { lines.push([]); x = 0; }
      lines[lines.length - 1].push(c);
      x += chipW(c) + 12;
    }
    // Order numbers per size, wrapped across the full width under the chips: "30: 5865…, 5865…".
    measure.font = MONO;
    const fullW = W - textX - PAD;
    const orderLines: string[] = [];
    for (const sz of block.sizes) {
      if (!sz.orders.length) continue;
      let line = `${sz.size || '—'}: `;
      sz.orders.forEach((o, i) => {
        const piece = i ? `, ${o}` : o;
        if (i && measure.measureText(line + piece).width > fullW) { orderLines.push(`${line},`); line = `   ${o}`; } else line += piece;
      });
      orderLines.push(line);
    }
    measure.font = `600 30px ${FONT}`;
    const ordersH = orderLines.length ? 10 + orderLines.length * ORDER_LINE : 0;
    return { block, lines, orderLines, height: Math.max(MIN_BLOCK, 132 + lines.length * 54 + ordersH + 12) };
  });
  const pages = paginate(laid, (l) => l.height);
  const images = await loadAll(blocks.map((b) => b.image));
  const total = blocks.reduce((n, b) => n + b.qty, 0);
  const out: Blob[] = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const [canvas, ctx] = newCanvas(HEAD + page.reduce((n, l) => n + l.height, 0) + PAD);
    header(ctx, title, date, round, `รวม ${total} ชิ้น`, pages.length > 1 ? `หน้า ${pi + 1}/${pages.length}` : `${blocks.length} รุ่น`);

    let top = HEAD;
    for (const { block: b, lines, orderLines, height } of page) {
      drawPhoto(ctx, images.get(b.image), PAD, top + 20, PHOTO);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#111827';
      ctx.font = `700 44px ${FONT}`;
      ctx.fillText(b.code, textX, top + 66, textW + 130);
      ctx.fillStyle = '#4b5563';
      ctx.font = `500 26px ${FONT}`;
      ctx.fillText(`${b.spu}${b.color ? `   ${colorLabel(b.color)}` : ''}`, textX, top + 106, textW + 130);

      ctx.font = `600 30px ${FONT}`;
      let cy = top + 128;
      for (const line of lines) {
        let cx = textX;
        for (const chip of line) {
          const w = chipW(chip);
          ctx.fillStyle = '#eef2ff';
          ctx.strokeStyle = '#6366f1';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(cx, cy, w, 44, 10);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#1e1b4b';
          ctx.textBaseline = 'middle';
          ctx.fillText(chip, cx + 14, cy + 23);
          cx += w + 12;
        }
        cy += 54;
      }
      if (orderLines.length) {
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#374151';
        ctx.font = MONO;
        orderLines.forEach((line, i) => ctx.fillText(line, textX, cy + 22 + i * ORDER_LINE));
      }

      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#111827';
      ctx.font = `800 72px ${FONT}`;
      ctx.fillText(String(b.qty), W - PAD, top + 110);
      ctx.fillStyle = '#6b7280';
      ctx.font = `500 24px ${FONT}`;
      ctx.fillText('ชิ้น', W - PAD, top + 146);
      ctx.textAlign = 'left';

      top += height;
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(PAD, top); ctx.lineTo(W - PAD, top); ctx.stroke();
    }
    out.push(await toPng(canvas));
  }
  return out;
}
