/**
 * Writes server/data/LOCATION_SKU.sample.xlsx in the exact layout of Benz's
 * master catalog (title row 1, header row 2, data from row 3, one tab per
 * location) so the importer can be tested and the format is documented.
 * Codes below are placeholders — replace with the real file from the Windows PC.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import * as XLSX from 'xlsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../data/LOCATION_SKU.sample.xlsx');

const HEADER = ['ประเภท (รุ่น)', 'สี', 'ชื่อสินค้า (ตัวอย่าง)', 'ไซส์ที่มี', 'สต็อกรวม', 'ราคา (ช่วง)'];
const tabs: Record<string, (string | number)[][]> = {
  PK: [
    ['KB', 'BK', 'ยีนส์ทรงกระบอกเล็ก สีดำ', '28, 30, 32, 34, 36, 38, 40, 42, 44', 147, '199.0-199.0'],
    ['KB', 'MW', 'ยีนส์ทรงกระบอกเล็ก ฟอกกลาง', '30, 32, 34', 61, '199.0-199.0'],
    ['ST', 'MW', 'ยีนส์ผ้ายืด ใส่สบาย ฟอกกลาง', '28, 34, 36, 38, 40', 57, '247.5-299.0'],
    ['ST', 'DK', 'ยีนส์ผ้ายืด ใส่สบาย สีเข้ม', '32, 34', 13, '247.5-299.0'],
    ['CH', 'BE', 'ชิโน่สไตล์เกาหลี สีเบจ', '28, 30, 32, 34, 36, 38, 40', 73, '183.0-199.0'],
    ['DF', 'DK', 'ทรงเดฟเอวสูง สีเข้ม', '26, 28, 30, 32, 34, 36', 240, '233.0-249.0'],
    ['SP', 'BK', 'กางเกงผ้ายืดสปอร์ต สีดำ', 'free size', 64, '166.0-166.0'],
    ['SH', 'BK', 'ขาสั้นผ้าสี สีดำ', '28, 30, 32, 34, 36, 38, 40, 42, 44', 140, '166.0-189.0'],
    ['IT01', 'ZZ', 'สินค้าใหม่ยังไม่ตั้งรหัส', '30, 32', 10, ''],
  ],
  CM: [
    ['KB', 'BK', 'ยีนส์ทรงกระบอกเล็ก สีดำ', '30, 32, 34, 36', 40, '199.0-199.0'],
    ['SH', 'NV', 'ขาสั้นผ้าสี สีกรม', '30, 32, 34', 33, '166.0-189.0'],
  ],
};

const wb = XLSX.utils.book_new();
const summary: (string | number)[][] = [['สถานที่', 'จำนวนแถว']];
for (const [loc, rows] of Object.entries(tabs)) {
  const aoa = [[`LOCATION_SKU · ${loc}`], HEADER, ...rows];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), loc);
  summary.push([loc, rows.length]);
}
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'สรุป');
fs.writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
console.log('wrote', out);
