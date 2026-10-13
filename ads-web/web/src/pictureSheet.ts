// Picture order sheets for suppliers who do not read Thai (the China warehouse CN), as PNG pages:
//   pictureSheets       one block per product: photo, code, SKU, colour in English/Chinese, sizes × quantity
//   orderPictureSheets  one block per order, like Bigseller's picking list (order no., carrier + tracking, items,
//                       store, total, cut line) — for a warehouse that packs and ships each order itself
// Drawn on a canvas in the browser; photos from other sites come through /api/catalog/image-proxy so the canvas
// can still be exported.

import { colorForeign } from './catalog.ts';
import { sizeForeign, type OrderBlock, type PictureBlock } from './purchase.ts';

const W = 1080;
const PAD = 36;
const PHOTO = 220;
const HEAD = 150;
const MIN_BLOCK = PHOTO + 40;
const MAX_HEIGHT = 2300;
const FONT = '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans", Arial, sans-serif';

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

/** Words wrapped to a width (chips of "size × qty" here). */
function wrap(ctx: CanvasRenderingContext2D, parts: string[], width: number, gap: number): string[][] {
  const lines: string[][] = [[]];
  let x = 0;
  for (const p of parts) {
    const w = ctx.measureText(p).width + 28;
    if (x > 0 && x + w > width) { lines.push([]); x = 0; }
    lines[lines.length - 1].push(p);
    x += w + gap;
  }
  return lines;
}

interface Laid { block: PictureBlock; height: number; chipLines: string[][] }

export async function pictureSheets(title: string, date: string, round: number, blocks: PictureBlock[]): Promise<Blob[]> {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `600 30px ${FONT}`;
  const textX = PAD + PHOTO + 28;
  const textW = W - textX - PAD - 170;
  const laid: Laid[] = blocks.map((block) => {
    const chipLines = wrap(measure, block.sizes.map((s) => `${sizeForeign(s.size) || '—'}  ×${s.qty}`), textW, 12);
    return { block, chipLines, height: Math.max(MIN_BLOCK, 132 + chipLines.length * 54) };
  });

  // Pages: as many products as fit under MAX_HEIGHT.
  const pages: Laid[][] = [[]];
  let h = HEAD;
  for (const l of laid) {
    if (pages[pages.length - 1].length && h + l.height > MAX_HEIGHT - PAD) { pages.push([]); h = HEAD; }
    pages[pages.length - 1].push(l);
    h += l.height;
  }

  const images = new Map<string, HTMLImageElement | null>();
  await Promise.all(blocks.map(async (b) => { images.set(b.key, await loadImage(b.image)); }));
  const total = blocks.reduce((n, b) => n + b.qty, 0);
  const [y, m, d] = date.split('-');
  const out: Blob[] = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const height = HEAD + page.reduce((n, l) => n + l.height, 0) + PAD;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, height);

    // Header: warehouse, date, round, total — numbers and English/Chinese only.
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, HEAD - 24);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 54px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(title, PAD, 50);
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(`${d}/${m}/${y}  ·  Round ${round} 第${round}批`, PAD, 96);
    ctx.textAlign = 'right';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(`Total 合计 ${total}`, W - PAD, 50);
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(pages.length > 1 ? `Page ${pi + 1}/${pages.length}` : `${blocks.length} items 款`, W - PAD, 96);
    ctx.textAlign = 'left';

    let top = HEAD;
    for (const { block: b, height: bh, chipLines } of page) {
      // photo
      const img = images.get(b.key);
      const px = PAD, py = top + 20;
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(px, py, PHOTO, PHOTO);
      if (img) {
        const s = Math.max(PHOTO / img.naturalWidth, PHOTO / img.naturalHeight);
        const w = img.naturalWidth * s, h2 = img.naturalHeight * s;
        ctx.save();
        ctx.beginPath();
        ctx.rect(px, py, PHOTO, PHOTO);
        ctx.clip();
        ctx.drawImage(img, px + (PHOTO - w) / 2, py + (PHOTO - h2) / 2, w, h2);
        ctx.restore();
      } else {
        ctx.fillStyle = '#9ca3af';
        ctx.font = `600 26px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('No photo', px + PHOTO / 2, py + PHOTO / 2);
        ctx.textAlign = 'left';
      }
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, PHOTO, PHOTO);

      // code, SKU, colour
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#111827';
      ctx.font = `700 44px ${FONT}`;
      ctx.fillText(b.code, textX, top + 66, textW + 150);
      ctx.fillStyle = '#4b5563';
      ctx.font = `500 26px ${FONT}`;
      ctx.fillText(`${b.spu}${b.color ? `   ${colorForeign(b.color)}` : ''}`, textX, top + 106, textW + 150);

      // sizes × quantity
      ctx.font = `600 30px ${FONT}`;
      let cy = top + 128;
      for (const line of chipLines) {
        let cx = textX;
        for (const chip of line) {
          const w = ctx.measureText(chip).width + 28;
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

      // total for the product
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#111827';
      ctx.font = `800 72px ${FONT}`;
      ctx.fillText(`×${b.qty}`, W - PAD, top + 110);
      ctx.fillStyle = '#6b7280';
      ctx.font = `500 24px ${FONT}`;
      ctx.fillText('Qty 数量', W - PAD, top + 146);
      ctx.textAlign = 'left';

      top += bh;
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD, top);
      ctx.lineTo(W - PAD, top);
      ctx.stroke();
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('สร้างรูปไม่สำเร็จ');
    out.push(blob);
  }
  return out;
}

// ---- per order (Bigseller picking-list layout) ----

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
    ctx.fillText('No photo', x + size / 2, y + size / 2);
    ctx.textAlign = 'left';
  }
  ctx.strokeStyle = '#d1d5db';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, size, size);
}

/** "TikTok-TH-J&T Express" → "J&T Express". */
export function shortCarrier(c: string): string {
  return c.replace(/^(tiktok|shopee|lazada)-th-/i, '').trim();
}

const ORDER_HEAD = 64;
const ITEM_H = 196;
const ITEM_PHOTO = 168;
const ORDER_FOOT = 92;

export async function orderPictureSheets(title: string, date: string, round: number, orders: OrderBlock[]): Promise<Blob[]> {
  const heightOf = (o: OrderBlock) => ORDER_HEAD + o.items.length * ITEM_H + ORDER_FOOT;
  const pages: OrderBlock[][] = [[]];
  let h = HEAD;
  for (const o of orders) {
    if (pages[pages.length - 1].length && h + heightOf(o) > MAX_HEIGHT - PAD) { pages.push([]); h = HEAD; }
    pages[pages.length - 1].push(o);
    h += heightOf(o);
  }

  const srcs = [...new Set(orders.flatMap((o) => o.items.map((i) => i.image)).filter(Boolean))];
  const images = new Map<string, HTMLImageElement | null>();
  await Promise.all(srcs.map(async (src) => { images.set(src, await loadImage(src)); }));
  const pieces = orders.reduce((n, o) => n + o.qty, 0);
  const [y, m, d] = date.split('-');
  const out: Blob[] = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const height = HEAD + page.reduce((n, o) => n + heightOf(o), 0) + PAD;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, height);

    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, HEAD - 24);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.font = `700 54px ${FONT}`;
    ctx.fillText(title, PAD, 50);
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(`${d}/${m}/${y}  ·  Round ${round} 第${round}批`, PAD, 96);
    ctx.textAlign = 'right';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(`${orders.length} orders 单 · ${pieces} pcs 件`, W - PAD, 50);
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(pages.length > 1 ? `Page ${pi + 1}/${pages.length}` : '', W - PAD, 96);
    ctx.textAlign = 'left';

    let top = HEAD;
    for (const o of page) {
      // Order no. | carrier (#tracking)
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
        const tx = PAD + ITEM_PHOTO + 24, tw = W - tx - PAD - 150;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#111827';
        ctx.font = `700 36px ${FONT}`;
        ctx.fillText(it.sku, tx, iy + 52, tw);
        ctx.fillStyle = '#374151';
        ctx.font = `500 27px ${FONT}`;
        ctx.fillText(`${it.code}${it.color ? `  ·  ${colorForeign(it.color)}` : ''}`, tx, iy + 94, tw);
        ctx.fillStyle = '#111827';
        ctx.font = `700 30px ${FONT}`;
        ctx.fillText(`Size 尺码: ${sizeForeign(it.size) || '—'}`, tx, iy + 138, tw);
        ctx.fillStyle = '#9ca3af';
        ctx.font = `400 22px ${FONT}`;
        if (it.option) ctx.fillText(it.option, tx, iy + 172, tw);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#111827';
        ctx.font = `800 64px ${FONT}`;
        ctx.fillText(`×${it.qty}`, W - PAD, iy + 110);
        ctx.textAlign = 'left';
        iy += ITEM_H;
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(tx, iy); ctx.lineTo(W - PAD, iy); ctx.stroke();
      }

      // store + total, then the cut line
      ctx.textAlign = 'right';
      ctx.fillStyle = '#4b5563';
      ctx.font = `500 24px ${FONT}`;
      ctx.fillText(o.store, W - PAD, iy + 32, 600);
      ctx.fillStyle = '#111827';
      ctx.font = `700 30px ${FONT}`;
      ctx.fillText(`Total 合计: ${o.qty}`, W - PAD, iy + 68);
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

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('สร้างรูปไม่สำเร็จ');
    out.push(blob);
  }
  return out;
}
