// Stock places that are one catalog tab each (Moss, idea #25): the shops' own tabs AR / BB / BBW / BT / GG / CM / CN.
// No starting balance and no fixed product list: stock is typed with "รับของเข้า" / "ปรับยอด" for any SKU of the tab
// (BB counts every BB supplier as one place), and rows of that tab on the order sheets cut it.

export const SHOP_LOCS = ['ar', 'bb', 'bbw', 'bt', 'gg', 'cm', 'cn'] as const;
export type ShopLoc = (typeof SHOP_LOCS)[number];
export const SHOP_LABEL: Record<ShopLoc, string> = { ar: 'AR', bb: 'BB (ทุกร้าน)', bbw: 'BBW', bt: 'BT', gg: 'GG', cm: 'Clima (CM)', cn: 'CN' };
export const isShopLoc = (loc: string): loc is ShopLoc => (SHOP_LOCS as readonly string[]).includes(loc);
/** The catalog tab (and the line's `tab` on a saved round) a shop place stands for. */
export const shopTab = (loc: ShopLoc) => loc.toUpperCase();
export const shopLocOfTab = (tab: string): ShopLoc | null => { const l = tab.toLowerCase(); return isShopLoc(l) ? l : null; };
