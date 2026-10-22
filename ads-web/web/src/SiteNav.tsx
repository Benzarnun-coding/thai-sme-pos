import type { MouseEvent } from 'react';

/** The standalone pages, in the order the strip shows them. "/" is the ads dashboard (home). */
const PAGES = [
  ['/', 'แอด'],
  ['/catalog', 'แคตตาล็อก'],
  ['/catalog/orders', 'สั่งของ'],
  ['/catalog/sales', 'ยอดขาย (ชิ้น)'],
  ['/catalog/profit', 'กำไร'],
  ['/catalog/stock', 'สต็อก'],
  ['/catalog/todo', 'งานค้าง'],
  ['/gosell', 'GoSell'],
  ['/botkb', 'คลังคำตอบบอท'],
  ['/requests', 'ไอเดียเว็บ'],
  ['/studio/posts', 'โพสต์ที่ยิงอยู่'],
  ['/studio', 'วัตถุดิบ'],
  ['/studio/train', 'ห้องฝึก'],
] as const;

export type SitePath = (typeof PAGES)[number][0];

/** Same strip of links on every page, so moving between them never needs a typed URL. */
export function SiteNav({ current }: { current: SitePath }) {
  return (
    <nav className="site-nav" aria-label="หน้าต่างๆ">
      {PAGES.map(([href, label]) => (
        <a key={href} href={href} className={href === current ? 'on' : ''} aria-current={href === current ? 'page' : undefined}>{label}</a>
      ))}
    </nav>
  );
}

/** The square logo top-left: always leads back to the home page. */
export function HomeLogo({ text, onClick }: { text: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  return <a className="logo" href="/" title="กลับหน้าแรก" aria-label="กลับหน้าแรก" onClick={onClick}>{text}</a>;
}
