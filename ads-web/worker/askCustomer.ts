// ไอเดีย #22 (dry run only): what to ask a customer who gave an incomplete address or a bad phone number.
// Pure functions: they decide WHAT is missing and the wording. Nothing here sends anything — sending to
// customers ships switched off and needs Benz's go-ahead (CLAUDE.md), and the sending route is still an open question.

import type { ReadAddress } from './addressReader.ts';

export type AddressPart = 'street' | 'subdistrict' | 'district' | 'province' | 'postal_code';
const LABEL: Record<AddressPart, string> = {
  street: 'บ้านเลขที่/หมู่/ซอย/ถนน', subdistrict: 'ตำบล/แขวง', district: 'อำเภอ/เขต', province: 'จังหวัด', postal_code: 'รหัสไปรษณีย์',
};

/** Parts of the address the chat did not give, in the order a customer writes them. */
export function missingAddressParts(a: Pick<ReadAddress, AddressPart>): AddressPart[] {
  return (Object.keys(LABEL) as AddressPart[]).filter((k) => !a[k]?.trim());
}

/** Thai phone: mobile 10 digits (06/08/09), or landline 9 digits (02, 03x–07x). Returns a short reason when wrong, else null. */
export function phoneProblem(phone: string): string | null {
  const d = phone.replace(/[\s-]/g, '');
  if (!d) return 'ไม่มีเบอร์';
  if (!/^\d+$/.test(d)) return 'มีตัวอักษรที่ไม่ใช่ตัวเลข';
  if (/^0[689]\d{8}$/.test(d)) return null;
  if (/^0[2-7]\d{7}$/.test(d)) return null;
  return 'เบอร์ไม่ครบหรือขึ้นต้นไม่ถูก';
}

/** The message to the customer, or null when nothing is missing. */
export function askMessage(a: Pick<ReadAddress, AddressPart | 'phone'>): string | null {
  const parts = missingAddressParts(a).map((k) => LABEL[k]);
  const phoneBad = a.phone.trim() ? phoneProblem(a.phone) : null; // no phone at all is Page365's job, not asked here
  const lines: string[] = [];
  if (parts.length) lines.push(`ที่อยู่ยังขาด ${parts.join(', ')} รบกวนขอเพิ่มด้วยนะคะ`);
  if (phoneBad) lines.push('เบอร์โทรไม่ถูกต้อง รบกวนขอเบอร์โทรเพิ่มเติมด้วยนะคะ');
  return lines.length ? lines.join('\n') : null;
}

/** Ask once: false if the shop already asked this customer for this (no repeat — it would look like spam). */
export function shouldAsk(alreadyAskedAt: string | null): boolean {
  return alreadyAskedAt === null;
}
