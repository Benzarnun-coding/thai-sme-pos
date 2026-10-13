// Picture order sheets for suppliers who do not read Thai (the China warehouse CN): one PNG per page, each product
// with its photo, code, SKU, colour in English/Chinese and sizes × quantity — no Thai text needed to pick the order.
// Drawn on a canvas in the browser; photos from other sites come through /api/catalog/image-proxy so the canvas
// can still be exported.

import { colorForeign } from './catalog.ts';
import { sizeForeign, type PictureBlock } from './purchase.ts';

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
