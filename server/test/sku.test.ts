import { describe, expect, it } from 'vitest';
import { buildSku, parseSku, sortSizes } from '../src/catalog/sku.js';
import { parseCsv } from '../src/catalog/import.js';

describe('parseSku', () => {
  it('parses [ประเภท]-[สถานที่]-[สี]-[ขนาด]', () => {
    expect(parseSku('KB-PK-BK-32')).toEqual({ sku: 'KB-PK-BK-32', type: 'KB', location: 'PK', color: 'BK', size: '32' });
  });
  it('folds extra dashes into the type', () => {
    expect(parseSku('kb-slim-cm-mw-34').type).toBe('KB-SLIM');
    expect(parseSku('kb-slim-cm-mw-34').location).toBe('CM');
  });
  it('rejects malformed skus', () => {
    expect(() => parseSku('KB-PK-32')).toThrow(/4 parts/);
  });
  it('round-trips through buildSku', () => {
    const p = parseSku('SH-PK-NV-30');
    expect(buildSku(p)).toBe('SH-PK-NV-30');
  });
});

describe('sortSizes', () => {
  it('sorts numeric sizes numerically and keeps FS last', () => {
    expect(sortSizes(['34', '28', 'FS', '30'])).toEqual(['28', '30', '34', 'FS']);
  });
});

describe('parseCsv', () => {
  it('maps thai and english headers', () => {
    const rows = parseCsv('รหัสสินค้า,ชื่อสินค้า,ราคา,คงเหลือ\nKB-PK-BK-32,"ยีนส์, กระบอกเล็ก","199",12\n');
    expect(rows).toEqual([{ sku: 'KB-PK-BK-32', name: 'ยีนส์, กระบอกเล็ก', category: undefined, price: 199, qty: 12, set_qty: undefined, set_price: undefined }]);
  });
  it('requires sku and name columns', () => {
    expect(() => parseCsv('a,b\n1,2')).toThrow(/sku and name/);
  });
});
