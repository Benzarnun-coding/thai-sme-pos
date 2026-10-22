import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupPosts } from './studio.ts';
import type { ActiveAdPost } from '../../ads-engine/src/meta.ts';

const ad = (id: string, story: string | null, campaign: string, spend: number, value: number, message = ''): ActiveAdPost => ({
  ad_id: id, ad_name: id, campaign_id: `c${campaign}`, campaign_name: campaign, adset_id: 's', story_id: story, creative_id: `cr${id}`,
  message, image_url: message ? `https://x.fbcdn.net/${id}.jpg` : null, permalink: null, post_read: true,
  stats: { spend, impressions: 100, purchases: 1, purchase_value: value, messages: 2 },
});

test('ads using one post become one row with summed numbers; product code from the campaign name, longest first', () => {
  const out = groupPosts([
    ad('1', 'p1', 'โพสผี : 5011 กระบอก 1 ตัว 189', 100, 300, 'แคปชัน A'),
    ad('2', 'p1', 'โพสผี : 5011 V2', 50, 200),
    ad('3', null, 'E200 ขาสั้น', 10, 0, 'แคปชัน B'),
  ], ['501', '5011', '200']);
  assert.equal(out.length, 2);
  const p1 = out.find((p) => p.key === 'p1')!;
  assert.equal(p1.spend, 150); assert.equal(p1.purchase_value, 500); assert.equal(p1.ads.length, 2);
  assert.equal(p1.message, 'แคปชัน A'); assert.equal(p1.code, '5011');
  const other = out.find((p) => p.key === 'creative:cr3')!;
  assert.equal(other.code, '200');
});

test('campaign names that say only the model get its first sub-model; hyphens between letters and digits ignored', async () => {
  const { modelOf } = await import('./studio.ts');
  assert.equal(modelOf('801/1'), '801'); assert.equal(modelOf('Ni9-1'), 'Ni9'); assert.equal(modelOf('SH-004'), 'SH-004'); assert.equal(modelOf('444'), '444');
  const out = groupPosts([
    ad('1', 'p1', 'REV 801 - กระบอกยืด 3 ตัว 799', 10, 0), ad('2', 'p2', 'โปรลับ Ni9 ผ้าสี', 10, 0),
    ad('3', 'p3', 'SH004 เสื้อ', 10, 0), ad('4', 'p4', 'โพสผี 444/1 ขาสั้น', 10, 0), ad('5', 'p5', 'ขาสั้น 16 นิ้ว', 10, 0),
  ], ['801/2', '801/1', 'Ni9-1', 'SH-004', '444/1', '444']);
  assert.deepEqual(out.map((p) => p.code), ['801/2', 'Ni9-1', 'SH-004', '444/1', '']);
});
