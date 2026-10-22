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

test('captions: the agent may not tag its own caption as a real post', () => {
  assert.deepEqual(parseCaptions('[{"hook":"real","text":"x"}]'), [{ hook: 'lifestyle', text: 'x' }]);
});

test('image check: numbers clamped, unknown verdict → check, missing style → null', async () => {
  const { parseImageCheck } = await import('./studio.ts');
  const c = parseImageCheck('ok {"product_match": 14, "looks_fake": -2, "verdict": "great", "summary": "x", "text_readable": false}');
  assert.equal(c.product_match, 10); assert.equal(c.looks_fake, 0); assert.equal(c.verdict, 'check'); assert.equal(c.style_match, null); assert.equal(c.text_readable, false);
});

test('image tags: only known dimensions and values are kept', async () => {
  const { cleanTags } = await import('./studio.ts');
  assert.deepEqual(cleanTags({ subject: 'worn', text: 'huge', background: 'plain_dark', mood: 'happy' }), { subject: 'worn', background: 'plain_dark' });
  assert.deepEqual(cleanTags(null), {});
});
