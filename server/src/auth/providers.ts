/**
 * Provider registry for the Connect-account flow.
 *
 * Each channel declares what the owner is consenting to, so the UI can explain
 * it in Thai before they click, and so we never request more than we use.
 */
export type Channel = 'facebook' | 'tiktok' | 'shopee' | 'line';

export interface ScopeInfo {
  scope: string;
  label: string;          // what the owner sees, in plain Thai
  phase: 1 | 2 | 3 | 4 | 5;   // which project phase needs it
  needsReview: boolean;   // requires Meta App Review before it works on other people's accounts
}

export interface ProviderConfig {
  channel: Channel;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: ScopeInfo[];
  /** env vars that must be present for the real flow to work */
  requires: string[];
  /** what the owner picks after consenting */
  accountKinds: string[];
  implemented: boolean;
}

export const GRAPH_VERSION = 'v21.0';

export const PROVIDERS: Record<Channel, ProviderConfig> = {
  facebook: {
    channel: 'facebook',
    name: 'Facebook / Meta',
    authorizeUrl: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`,
    scopes: [
      { scope: 'pages_show_list', label: 'เห็นรายชื่อเพจที่คุณดูแล', phase: 1, needsReview: false },
      { scope: 'pages_read_engagement', label: 'อ่านโพสต์และยอด engagement ของเพจ', phase: 1, needsReview: true },
      { scope: 'read_insights', label: 'อ่านสถิติเพจ (reach, ผู้ติดตาม)', phase: 1, needsReview: true },
      { scope: 'ads_read', label: 'อ่านผลโฆษณา', phase: 1, needsReview: true },
      { scope: 'pages_manage_posts', label: 'โพสต์ลงเพจแทนคุณ', phase: 3, needsReview: true },
      { scope: 'ads_management', label: 'สร้างและปรับโฆษณา', phase: 4, needsReview: true },
      { scope: 'pages_messaging', label: 'ตอบแชทและคอมเมนต์', phase: 5, needsReview: true },
      { scope: 'business_management', label: 'เข้าถึง Business Manager', phase: 4, needsReview: true },
    ],
    requires: ['FB_APP_ID', 'FB_APP_SECRET'],
    accountKinds: ['page', 'ad_account'],
    implemented: true,
  },
  tiktok: {
    channel: 'tiktok',
    name: 'TikTok for Business',
    authorizeUrl: 'https://business-api.tiktok.com/portal/auth',
    tokenUrl: 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/',
    scopes: [
      { scope: 'ad.read', label: 'อ่านผลโฆษณา TikTok', phase: 1, needsReview: true },
      { scope: 'ad.manage', label: 'สร้างและปรับโฆษณา', phase: 4, needsReview: true },
      { scope: 'shop.read', label: 'อ่านสินค้าและออเดอร์ TikTok Shop', phase: 5, needsReview: true },
    ],
    requires: ['TIKTOK_APP_ID', 'TIKTOK_APP_SECRET'],
    accountKinds: ['advertiser', 'shop'],
    implemented: false,
  },
  shopee: {
    channel: 'shopee',
    name: 'Shopee Open Platform',
    authorizeUrl: 'https://partner.shopeemobile.com/api/v2/shop/auth_partner',
    tokenUrl: 'https://partner.shopeemobile.com/api/v2/auth/token/get',
    scopes: [
      { scope: 'product', label: 'อ่านและแก้รายการสินค้า', phase: 1, needsReview: false },
      { scope: 'order', label: 'อ่านออเดอร์เพื่อจับคู่ยอดขาย', phase: 1, needsReview: false },
      { scope: 'ads', label: 'อ่านและปรับ Shopee Ads', phase: 4, needsReview: false },
    ],
    requires: ['SHOPEE_PARTNER_ID', 'SHOPEE_PARTNER_KEY'],
    accountKinds: ['shop'],
    implemented: false,
  },
  line: {
    channel: 'line',
    name: 'LINE Official Account',
    authorizeUrl: 'https://access.line.me/oauth2/v2.1/authorize',
    tokenUrl: 'https://api.line.me/oauth2/v2.1/token',
    scopes: [
      { scope: 'profile', label: 'รู้ว่าใครเป็นผู้เชื่อมต่อ', phase: 1, needsReview: false },
      { scope: 'message:write', label: 'ส่งคำขออนุมัติและสรุปรายวัน', phase: 2, needsReview: false },
    ],
    requires: ['LINE_CHANNEL_ID', 'LINE_CHANNEL_SECRET'],
    accountKinds: ['official_account'],
    implemented: false,
  },
};

/** Scopes we actually request today, given how far the build has got. */
export function scopesForPhase(channel: Channel, maxPhase: number): string[] {
  return PROVIDERS[channel].scopes.filter((s) => s.phase <= maxPhase).map((s) => s.scope);
}

export function isConfigured(channel: Channel): boolean {
  return PROVIDERS[channel].requires.every((k) => Boolean(process.env[k]));
}

export function missingEnv(channel: Channel): string[] {
  return PROVIDERS[channel].requires.filter((k) => !process.env[k]);
}
