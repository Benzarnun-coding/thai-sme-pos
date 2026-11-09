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
