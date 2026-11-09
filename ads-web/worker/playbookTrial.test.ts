import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trialMessage, verdict, TRIAL_PAIRS, TRIAL_WIN } from './playbookTrial.ts';

test('a trial is decided only at 20 pairs; the draft needs >= 55% to go live', () => {
  assert.equal(TRIAL_PAIRS, 20);
  assert.equal(TRIAL_WIN, 0.55);
  assert.equal(verdict(19, 19), null);
  assert.equal(verdict(20, 11), 'won');
  assert.equal(verdict(20, 10), 'lost');
  assert.equal(verdict(21, 12), 'won'); // 57%
  assert.equal(verdict(22, 12), 'lost'); // 54.5%
});

test('Discord note says what happened and how to undo', () => {
  assert.match(trialMessage({ id: 9, result: 'won', pairs: 20, wins: 13 }, 'https://x.dev'), /ชนะ.*13\/20.*65%[\s\S]*ย้อนกลับฉบับก่อน/);
  assert.match(trialMessage({ id: 9, result: 'lost', pairs: 20, wins: 8 }, 'https://x.dev'), /แพ้.*8\/20.*≥ 55%[\s\S]*studio\/train/);
});

import { parseVerdicts, trialPairs } from './playbookTrial.ts';

test('AI judge pairs: 4 products × 5 per side give 20 distinct draft-vs-live pairs, spread over products', () => {
  const cands = ['a', 'b', 'c', 'd'].flatMap((code, p) => Array.from({ length: 10 }, (_, i) => ({ id: p * 100 + i, code, text: 't', playbook_id: i < 5 ? 9 : null })));
  const seen = new Set<string>();
  const first = trialPairs(cands, 9, seen, 5);
  assert.deepEqual(new Set(first.slice(0, 4).map(([a]) => a.code)), new Set(['a', 'b', 'c', 'd']));
  const rest = trialPairs(cands, 9, seen, 100);
  const all = [...first, ...rest];
  assert.ok(all.length >= 20);
  assert.ok(all.every(([d, l]) => d.playbook_id === 9 && l.playbook_id === null && d.code === l.code));
  assert.equal(new Set(all.map(([a, b]) => `${a.id}:${b.id}`)).size, all.length);
});

test('two products still reach 20 pairs (shifted pairings)', () => {
  const cands = ['a', 'b'].flatMap((code, p) => Array.from({ length: 10 }, (_, i) => ({ id: p * 100 + i, code, text: 't', playbook_id: i < 5 ? 9 : null })));
  assert.ok(trialPairs(cands, 9, new Set(), 100).length >= 20);
});

test('verdicts: one per pair, A/B only, unknown reason → better', () => {
  const v = parseVerdicts('ผล:\n[{"pair":1,"winner":"a","reason":"boring"},{"pair":1,"winner":"B"},{"pair":2,"winner":"B","reason":"xx"},{"pair":3,"winner":"C"},{"pair":9,"winner":"A"}]', 3);
  assert.deepEqual(v, [{ pair: 1, winner: 'A', reason: 'boring' }, { pair: 2, winner: 'B', reason: 'better' }]);
  assert.deepEqual(parseVerdicts('no json', 2), []);
});
