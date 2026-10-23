import assert from 'node:assert/strict';
import { test } from 'node:test';
import { botErrors, botRateText } from './chatInsights.ts';

test('the "บอทพลาด: N" line is read and taken out of the post', () => {
  assert.deepEqual(botErrors('**⚠️ ต้องดู** ลูกค้า 3\n\nบอทพลาด: 4'), { n: 4, text: '**⚠️ ต้องดู** ลูกค้า 3' });
  assert.deepEqual(botErrors('สรุป\n**บอทพลาด:** 0 คน'), { n: 0, text: 'สรุป' });
  assert.deepEqual(botErrors('ไม่มีบรรทัดนับ'), { n: null, text: 'ไม่มีบรรทัดนับ' });
});

test('7-day rate per 100 chats vs the 7 days before', () => {
  const d = (day: string, errors: number, customers: number) => ({ day, errors, customers });
  const days = [
    d('2026-10-23', 2, 50), d('2026-10-22', 3, 50), d('2026-10-20', 0, 100), // this week: 5 / 200 = 2.5
    d('2026-10-16', 6, 100), d('2026-10-14', 4, 100), d('2026-10-12', 2, 100), // week before: 12 / 300 = 4.0
    d('2026-10-09', 50, 50), // older than 14 days: ignored
  ];
  assert.equal(botRateText(days, '2026-10-23'), '📉 **บอทพลาดต่อ 100 แชท (7 วัน):** 2.5 · สัปดาห์ก่อน 4.0 ✅ ดีขึ้น (มีข้อมูล 3 วัน)');
  assert.match(botRateText(days.slice(0, 2), '2026-10-23'), /กำลังเก็บข้อมูล \(2\/7 วัน\)/);
  assert.match(botRateText(days.slice(0, 3), '2026-10-23'), /ยังไม่มีสัปดาห์ก่อนให้เทียบ/);
});
