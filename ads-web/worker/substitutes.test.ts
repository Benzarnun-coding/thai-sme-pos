import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSubstitute, subKey } from './substitutes.ts';

test('subKey: upper case, "-" as "/"', () => {
  assert.equal(subKey(' 801-1 '), '801/1');
  assert.equal(subKey('ni9-3'), 'NI9/3');
});

test('checkSubstitute: both codes, valid, not the same model', () => {
  assert.deepEqual(checkSubstitute('801/1', '501-5'), { code: '801/1', sub: '501/5' });
  assert.ok('error' in checkSubstitute('801/1', ''));
  assert.ok('error' in checkSubstitute('801/1', '801-1'));
  assert.ok('error' in checkSubstitute('801/1 ไซส์ 32', '501/5'));
});
