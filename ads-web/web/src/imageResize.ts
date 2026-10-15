// Shrinks a picture in the browser before upload, so a phone photo (3–5 MB) becomes ~100 KB and the free plan's
// D1 can hold thousands of them. Rotation from the camera's EXIF is applied by createImageBitmap.

export async function resizeImage(file: Blob, maxSide: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('เปิดรูปนี้ไม่ได้ (รองรับ JPEG, PNG, WebP)');
  });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // transparent PNGs become white, not black, as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('ย่อรูปไม่สำเร็จ');
  return blob;
}

/** Card thumbnail + large picture for the product view. */
export async function productPictures(file: Blob): Promise<{ thumb: Blob; full: Blob }> {
  const [thumb, full] = await Promise.all([resizeImage(file, 400, 0.8), resizeImage(file, 1200, 0.85)]);
  return { thumb, full: full.size > 1_400_000 ? await resizeImage(file, 1000, 0.7) : full };
}
