import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planTasks, VARIABLES } from './grokTasks.ts';

const promos = new Map([['801/3', '1 ตัว 189 · 3 ตัว 549']]);

test('no free slot, no task', () => {
  assert.deepEqual(planTasks({ free: 0, winners: [{ code: '801/3', set_id: 4, roas: 15 }], tried: new Map(), explore: [], promos }), []);
});

test('70% on the winner (one change each, untried only), the rest on new products', () => {
  const t = planTasks({ free: 6, winners: [{ code: '801/3', set_id: 4, roas: 15.08 }, { code: '801/3', set_id: 9, roas: 4 }], tried: new Map([['801/3', new Set(['offer3', 'untagged'])]]),
    explore: [{ code: '801/3', promo: '' }, { code: '444/1', promo: '' }, { code: 'E200', promo: '' }], promos });
  assert.deepEqual(t.map((x) => `${x.n} ${x.code} ${x.key} ${x.base_set}`), ['1 801/3 offer1 4', '2 801/3 back 4', '3 801/3 front 4', '4 801/3 single 4', '5 444/1 new null', '6 E200 new null']);
  assert.match(t[0].text, /ตัวตั้ง: ชุด#4 \(ROAS จริง 15\.1\) — เปลี่ยนอย่างเดียว: .*ราคาบนภาพ: 1 ตัว 189 · 3 ตัว 549/);
  assert.match(t[4].text, /ถามแม็กซ์ก่อน/);
});

test('no winner yet: only new products; a product with any picture is not "new"', () => {
  const t = planTasks({ free: 3, winners: [], tried: new Map([['e200', new Set(['untagged'])]]), explore: [{ code: 'E200', promo: '' }, { code: '444/1', promo: '' }], promos });
  assert.deepEqual(t.map((x) => `${x.code} ${x.key}`), ['444/1 new']);
});

test('explore runs out: winners take the remaining slots until their variables run out', () => {
  const t = planTasks({ free: 9, winners: [{ code: '801/3', set_id: 4, roas: 15 }], tried: new Map(), explore: [], promos });
  assert.equal(t.length, VARIABLES.length);
});

import { rankVariables } from './grokTasks.ts';
test('real results order the variables: winners first, ones that always lost are dropped', () => {
  // 2026-11-26 production: offer3 won once; offer1 / single / back / front each lost once
  assert.deepEqual(rankVariables([{ key: 'offer3', wins: 1, losses: 0 }, { key: 'back', wins: 0, losses: 1 }]).map((v) => v.key), ['offer3', 'offer1', 'front', 'single', 'back']);
  assert.deepEqual(rankVariables([{ key: 'back', wins: 0, losses: 2 }, { key: 'front', wins: 0, losses: 3 }]).map((v) => v.key), ['offer3', 'offer1', 'single']);
  assert.deepEqual(rankVariables().map((v) => v.key), VARIABLES.map((v) => v.key));
});

test('a new product starts in the format that really won; dead variables never become tasks', () => {
  const results = [{ key: 'offer3', wins: 1, losses: 0 }, { key: 'back', wins: 0, losses: 2 }];
  const t = planTasks({ free: 9, winners: [{ code: '801/3', set_id: 4, roas: 15 }], tried: new Map(), explore: [{ code: '444/1', promo: '' }], promos, results });
  assert.ok(!t.some((x) => x.key === 'back'));
  assert.equal(t[0].key, 'offer3');
  assert.match(t.find((x) => x.key === 'new')!.text, /ชนะในแอดทดสอบจริงมากที่สุด \(แพ็ก 3 ตัวเด่น\)/);
  // no win anywhere yet: the old default format
  assert.match(planTasks({ free: 1, winners: [], tried: new Map(), explore: [{ code: '444/1', promo: '' }], promos, results: [{ key: 'back', wins: 0, losses: 1 }] })[0].text, /นายแบบหันหลัง 2–3 สี/);
});
