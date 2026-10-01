import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CompetitorAd } from '../web/src/api.ts';
import { adLibraryUrl, angleCounts, daysRunning, pricePerPiece, trend } from '../web/src/competitorAnalysis.ts';

const ad = (over: Partial<CompetitorAd>): CompetitorAd => ({
  id: 'a', competitor_id: 'c', library_url: '', started_at: null, last_seen: null, status: 'active', format: '',
  promo: '', hook: '', notes: '', section_id: null, created_at: '', ...over,
});

test('price per piece from promo text: cheapest tier, "ตัวละ", nothing', () => {
  assert.equal(pricePerPiece('1 ตัว 199 / 3 ตัว 499 ส่งฟรี'), 499 / 3);
  assert.equal(pricePerPiece('ตัวละ 159 เท่านั้น'), 159);
  assert.equal(pricePerPiece('ลด 50% วันนี้'), null);
});

test('days running: to today while active, to last seen once stopped', () => {
  assert.equal(daysRunning(ad({ started_at: '2026-09-01' }), '2026-10-01'), 30);
  assert.equal(daysRunning(ad({ started_at: '2026-09-01', status: 'stopped', last_seen: '2026-09-11' }), '2026-10-01'), 10);
  assert.equal(daysRunning(ad({})), null);
});

test('selling angles are counted once per ad', () => {
  const counts = angleCounts([ad({ promo: '3 ตัว 499 ส่งฟรี', hook: 'ส่งฟรีทั่วไทย เก็บปลายทาง' }), ad({ hook: 'รีวิวจากลูกค้าจริง' })]);
  assert.deepEqual(counts.find((c) => c.label === 'ส่งฟรี')?.count, 1);
  assert.deepEqual(counts.find((c) => c.label === 'รีวิว / ลูกค้าจริง')?.count, 1);
});

test('trend compares the latest two checks; Ad Library link by page id or name', () => {
  const t = trend([
    { id: 1, competitor_id: 'c', checked_at: '2026-09-20T00:00:00Z', active_ads: 8, note: '' },
    { id: 2, competitor_id: 'c', checked_at: '2026-09-27T00:00:00Z', active_ads: 12, note: '' },
  ], 'c');
  assert.deepEqual([t?.now.active_ads, t?.before?.active_ads], [12, 8]);
  assert.match(adLibraryUrl({ name: 'x', page_id: '12345' }), /view_all_page_id=12345/);
  assert.match(adLibraryUrl({ name: 'ร้าน ยีนส์', page_id: '' }), /q=%E0/);
});
