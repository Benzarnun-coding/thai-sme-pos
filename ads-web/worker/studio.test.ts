import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOOKS, parseCaptions } from './studio.ts';

test('captions: JSON inside chatter is read, unknown hooks fall back, empty texts dropped', () => {
  const out = parseCaptions('นี่คือแคปชัน:\n[{"hook":"price","text":"ยีนส์ 189"},{"hook":"xx","text":"ใส่ไปไหนก็ได้"},{"hook":"sizes","text":""}]\nจบ');
  assert.deepEqual(out, [{ hook: 'price', text: 'ยีนส์ 189' }, { hook: 'lifestyle', text: 'ใส่ไปไหนก็ได้' }]);
  assert.ok(Object.keys(HOOKS).includes('lifestyle'));
});

test('captions: no array → a clear error', () => {
  assert.throws(() => parseCaptions('ขอโทษค่ะ เขียนไม่ได้'), /JSON/);
});
