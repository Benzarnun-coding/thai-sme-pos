import { test } from 'node:test';
import assert from 'node:assert/strict';
import { morningDecision } from './morningRun.ts';

const at = (bkk: string) => new Date(`2026-10-27T${bkk}:00+07:00`);
const run = (o: Parameters<typeof morningDecision>[0]) => { const d = morningDecision(o); return d.run ? d.trigger.split(':')[0] + (d.trigger.includes('13:00') ? ' 13:00' : d.trigger.includes('ไฟล์') ? ' file' : '') : null; };

test('switched off: only the 08:00 tick runs, as before', () => {
  assert.equal(run({ wait: false, now: at('08:00'), done: false, fileIn: false }), 'schedule');
  assert.equal(run({ wait: false, now: at('08:10'), done: false, fileIn: true }), null);
  assert.equal(run({ wait: false, now: at('08:00'), done: true, fileIn: false }), null);
});

test('waiting: runs at the first tick once the file is in, else at 13:00; once a day', () => {
  assert.equal(run({ wait: true, now: at('08:00'), done: false, fileIn: false }), null);
  assert.equal(run({ wait: true, now: at('10:50'), done: false, fileIn: true }), 'schedule file');   // 27 Oct: file in at 10:45
  assert.equal(run({ wait: true, now: at('11:00'), done: true, fileIn: true }), null);              // already ran at 10:50
  assert.equal(run({ wait: true, now: at('12:50'), done: false, fileIn: false }), null);
  assert.equal(run({ wait: true, now: at('13:00'), done: false, fileIn: false }), 'schedule 13:00'); // Sunday: no file
  assert.equal(run({ wait: true, now: at('08:00'), done: false, fileIn: true }), 'schedule file');  // file in before 08:00
});
