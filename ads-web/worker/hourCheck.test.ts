import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareHours, hourCheckText } from './hourCheck.ts';

const h = (hour: string, purchases: number, value = purchases * 450) => ({ hour, purchases, value });

test('26 Oct 2026: Monday 08–10 flagged, the rest of the day matches', () => {
  const meta = [h('08:00', 47), h('09:00', 81), h('10:00', 66), h('11:00', 8), h('14:00', 16), h('19:00', 26)];
  const ours = [h('08:00', 29), h('09:00', 9), h('10:00', 7), h('11:00', 7), h('14:00', 19), h('19:00', 27)];
  const r = compareHours(meta, ours);
  assert.deepEqual(r.flagged.map((x) => x.hour), ['08:00', '09:00', '10:00']);
  assert.equal(r.meta, 244);
  assert.equal(r.ours, 98);
  const text = hourCheckText({ date: '2026-10-26', source: 'stored', ...r })!;
  assert.match(text, /09 น\. Meta 81 \/ เรา 9/);
  assert.match(text, /ระบบอื่น/);
});

test('small gaps and late tags are not flagged; an ordinary day sends no text', () => {
  // 25 Oct: 20:00 Meta 74 vs ours 79; one-off hours with a single Meta purchase.
  const r = compareHours([h('10:00', 37), h('13:00', 1), h('20:00', 74)], [h('10:00', 37), h('20:00', 79)]);
  assert.equal(r.flagged.length, 0);
  assert.equal(hourCheckText({ date: '2026-10-25', source: 'stored', ...r }), null);
});

test('an hour with no sales of ours but many in Meta is flagged', () => {
  const r = compareHours([h('09:00', 12)], []);
  assert.deepEqual(r.flagged.map((x) => [x.hour, x.extra]), [['09:00', 12]]);
});
