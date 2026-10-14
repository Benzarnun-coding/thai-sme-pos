import assert from 'node:assert/strict';
import { test } from 'node:test';
import { familyOf, nameHasFamily, postIdeas, type FamilyStats } from './postIdeas.ts';

test('product family from the Page365 item name', () => {
  assert.deepEqual(familyOf('501/2  ยีนส์กระบอกเล็กผ้าไม่ยืดสีกรม Ni9'), { family: '501', label: 'ยีนส์กระบอกเล็กผ้าไม่ยืด' });
  assert.equal(familyOf('NI9-2 ขาสั้นสีกรม')?.family, 'NI9');
  assert.equal(familyOf('16-4 ขาสั้นชิโน่สีดำ')?.family, '16');
  assert.equal(familyOf('009-1 กางเกงยีนส์ขาสั้นสีกรม')?.family, '009');
  assert.equal(familyOf('ไม่มีรหัส'), null);
});

test('campaign names match a family code on its own', () => {
  assert.ok(nameHasFamily('โพสผี : 501/1 3ตัว599 #1 ฿100', '501'));
  assert.ok(nameHasFamily('ni9 ผ้าสี 3ตัว499 ฿400', 'NI9'));
  assert.ok(!nameHasFamily('แอดผี : E200 1ตัว199 - 1600', '16'));
  assert.ok(!nameHasFamily('REV 801 - กระบอกยืด', '80'));
  assert.ok(!nameHasFamily('โพสผี : 501 กระบอกไม่ยืด 1 ตัว 199 ฿200', '200'));
  assert.ok(!nameHasFamily('444/1 ขาสั้น 3ตัว700 -50฿ V2', '50'));
  assert.ok(nameHasFamily('แอดผี : E200 1ตัว199 - 1200', '200'));
});

const fam = (o: Partial<FamilyStats>): FamilyStats => ({ family: 'X', label: '', pieces: 0, organic_pieces: 0, orders: 0, revenue: 0, net_before_ads: 0, campaigns: [], own_campaign: false, spend: 0, ad_revenue: 0, roas: null, promos: [], ...o });

test('ideas: winners get new posts, sellers without ads get a test, losers wait', () => {
  const ideas = postIdeas([
    fam({ family: 'NI9', pieces: 120, spend: 5000, roas: 5 }),
    fam({ family: '301', pieces: 30, organic_pieces: 10 }),
    fam({ family: '801', pieces: 40, spend: 3000, roas: 2 }),
    fam({ family: '444', pieces: 50, spend: 3000, roas: 3, own_campaign: true }),
  ], 2.8, 14);
  assert.deepEqual(ideas.map((i) => `${i.kind}:${i.family}`), ['scale:NI9', 'untapped:301', 'hold:801']);
});
