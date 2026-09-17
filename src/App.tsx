import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import MarketingView from './marketing/MarketingView'
import StudioView from './studio/StudioView'
import ReportView from './report/ReportView'
import OfficeView from './office/OfficeView'
import {
  ShoppingCart,
  Package,
  LayoutDashboard,
  Plus,
  BrainCircuit,
  Sparkles,
  FileText,
  Building2,
  Shirt,
  X,
  Menu as MenuIcon,
  Printer,
  CheckCircle,
  Clock,
} from 'lucide-react'

// --- Types ---
type View = 'POS' | 'Dashboard' | 'Stock' | 'Receipt' | 'Marketing' | 'Studio' | 'Report' | 'Office';

interface Modifier { id: string; name: string; price: number; }
interface ModifierCategory { id: string; name: string; options: Modifier[]; type: 'radio' | 'checkbox' }
interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  thumbnail: string;
  modifiers?: ModifierCategory[];
}
interface CartLine extends MenuItem { cartId: string; totalPrice: number; quantity: number; modifiers2: Modifier[] }
interface Order { id: string; items: CartLine[]; total: number; time: string }

// --- Data & Constants ---
const SIZES = ['28', '30', '32', '34', '36', '38', '40', '42', '44'];
const MODIFIER_CATEGORIES: Record<string, ModifierCategory> = {
  size: { id: 'size', name: 'ไซส์', type: 'radio', options: SIZES.map(z => ({ id: `z${z}`, name: z, price: 0 })) },
  sizeW: { id: 'sizeW', name: 'ไซส์', type: 'radio', options: ['26', '28', '30', '32', '34', '36'].map(z => ({ id: `w${z}`, name: z, price: 0 })) },
  color: { id: 'color', name: 'สี', type: 'radio', options: [{ id: 'c-bk', name: 'ดำ', price: 0 }, { id: 'c-nv', name: 'กรม', price: 0 }, { id: 'c-gy', name: 'เทา', price: 0 }] },
  wash: { id: 'wash', name: 'สี', type: 'radio', options: [{ id: 'w-mw', name: 'ฟอกกลาง', price: 0 }, { id: 'w-dk', name: 'สีเข้ม', price: 0 }] },
};

/**
 * Product thumbnails are drawn inline rather than fetched.
 *
 * The published demo runs under a strict CSP that blocks remote images, and a
 * shop photo is not the point of this screen anyway — a denim swatch that always
 * renders beats a broken-image icon.
 */
const IMG = (tone: string, cut: 'long' | 'short') => {
  const legs = cut === 'long'
    ? 'M30 46h40l-3 74h-14l-3-46-3 46H33z'
    : 'M30 46h40l-3 38h-14l-3-14-3 14H33z';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" fill="${tone}"/>
    <g fill="none" stroke="rgba(255,255,255,.34)" stroke-width="1.6">
      <path d="${legs}" fill="rgba(255,255,255,.13)"/>
      <path d="M30 46h40" /><path d="M50 52v14" />
    </g>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\s+/g, ' '))}`;
};
const MENU_ITEMS: MenuItem[] = [
  // --- ผู้ชาย ---
  { id: 'kb', name: 'ยีนส์ทรงกระบอกเล็ก สีดำ', description: '3 ตัว 550 · ไซส์ 28-44', price: 199, category: 'ผู้ชาย', thumbnail: IMG('#2f3a5f', 'long'), modifiers: [MODIFIER_CATEGORIES.size] },
  { id: 'st', name: 'ยีนส์ผ้ายืด ใส่สบาย', description: '4 ตัว 990 ส่งฟรี · ไซส์ 28-44', price: 299, category: 'ผู้ชาย', thumbnail: IMG('#4a5f8a', 'long'), modifiers: [MODIFIER_CATEGORIES.wash, MODIFIER_CATEGORIES.size] },
  { id: 'ch', name: 'ชิโน่สไตล์เกาหลี', description: '3 ตัว 550 · ไซส์ 28-40', price: 199, category: 'ผู้ชาย', thumbnail: IMG('#6b6a5a', 'long'), modifiers: [MODIFIER_CATEGORIES.size] },
  { id: 'sp', name: 'กางเกงผ้ายืดสปอร์ต', description: '3 ตัว 499 · FREESIZE 28-36', price: 166, category: 'ผู้ชาย', thumbnail: IMG('#3d5a55', 'long'), modifiers: [MODIFIER_CATEGORIES.color] },
  // --- ผู้หญิง ---
  { id: 'df', name: 'ทรงเดฟเอวสูง', description: '3 ตัว 699 · ไซส์ 26-36', price: 249, category: 'ผู้หญิง', thumbnail: IMG('#5b4a6b', 'long'), modifiers: [MODIFIER_CATEGORIES.sizeW] },
  // --- ขาสั้น ---
  { id: 'sh', name: 'ขาสั้นผ้าสี', description: '3 ตัว 499 · ไซส์ 28-44', price: 189, category: 'ขาสั้น', thumbnail: IMG('#7a6250', 'short'), modifiers: [MODIFIER_CATEGORIES.color, MODIFIER_CATEGORIES.size] },
  // --- โปร / ขายส่ง ---
  { id: 'b1g1', name: 'ยีนส์ฟอก โปร 1 แถม 1', description: '2 ตัว 490', price: 490, category: 'ขายส่ง', thumbnail: IMG('#5c7192', 'long'), modifiers: [MODIFIER_CATEGORIES.size] },
  { id: 'ws20', name: 'ชุดขายส่ง 20 ตัว คละแบบ', description: 'ตกตัวละ 200 · คละไซส์ 28-44', price: 4000, category: 'ขายส่ง', thumbnail: IMG('#3b4668', 'long') },
];

const CATEGORIES = ['ทั้งหมด', 'ผู้ชาย', 'ผู้หญิง', 'ขาสั้น', 'ขายส่ง'];
const NAV: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: 'POS', label: 'ขายหน้าร้าน', icon: <ShoppingCart size={18} /> },
  { id: 'Dashboard', label: 'ภาพรวม', icon: <LayoutDashboard size={18} /> },
  { id: 'Stock', label: 'สต็อก', icon: <Package size={18} /> },
  { id: 'Marketing', label: 'การตลาด', icon: <BrainCircuit size={18} /> },
  { id: 'Office', label: 'ออฟฟิศ', icon: <Building2 size={18} /> },
  { id: 'Studio', label: 'ระบบหลังบ้าน', icon: <Sparkles size={18} /> },
  { id: 'Report', label: 'รายงาน', icon: <FileText size={18} /> },
];

const ROUTED: View[] = ['POS', 'Dashboard', 'Stock', 'Marketing', 'Studio', 'Report', 'Office'];
const viewFromHash = (): View | null => {
  const h = window.location.hash.replace('#', '').split('?')[0];
  return ROUTED.includes(h as View) ? (h as View) : null;
};

const baht = (n: number) => '฿' + n.toLocaleString('th-TH');
/** A receipt number and time; lives outside the component so React's purity lint sees no side effect in render. */
const makeOrder = (items: CartLine[], total: number): Order =>
  ({ id: `REC-${Math.floor(Math.random() * 9000) + 1000}`, items, total, time: new Date().toLocaleTimeString('th-TH') });

/* ---------------------------------------------------------------- sidebar */

function Sidebar({ view, onPick, open }: { view: View; onPick: (v: View) => void; open: boolean }) {
  return (
    <aside
      className={`fixed lg:static inset-y-0 left-0 w-64 z-50 flex flex-col p-4 transition-transform ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
    >
      <div className="flex items-center gap-3 mb-8 px-2 pt-2">
        <div className="w-10 h-10 rounded-xl grid place-items-center flex-none" style={{ background: 'rgba(255,255,255,.14)' }}>
          <Shirt size={20} />
        </div>
        <div className="min-w-0">
          <div className="t-head text-[15px] leading-tight truncate" style={{ color: 'var(--brand-ink)' }}>Climax</div>
          <div className="text-xs opacity-70 truncate">by PKjeans</div>
        </div>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map(btn => {
          const on = view === btn.id;
          return (
            <button
              key={btn.id}
              onClick={() => onPick(btn.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-[15px] transition-colors whitespace-nowrap"
              style={on
                ? { background: 'rgba(255,255,255,.17)', color: 'var(--brand-ink)', fontWeight: 500, boxShadow: 'inset 3px 0 0 var(--accent)' }
                : { color: 'var(--brand-ink)', opacity: 0.74 }}
            >
              {btn.icon} {btn.label}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto px-3 pb-2 text-xs opacity-55 leading-relaxed">
        LoopDesk v1<br />ข้อมูลตัวอย่าง
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------- POS */

function POSView({ items, cart, onPick, onQty, onRemove, onCheckout, cartOpen, closeCart }: {
  items: MenuItem[];
  cart: CartLine[];
  onPick: (i: MenuItem) => void;
  onQty: (cartId: string, delta: number) => void;
  onRemove: (cartId: string) => void;
  onCheckout: () => void;
  cartOpen: boolean;
  closeCart: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState('ทั้งหมด');
  const total = cart.reduce((s, i) => s + i.totalPrice * i.quantity, 0);
  const shown = items.filter(i => activeCategory === 'ทั้งหมด' || i.category === activeCategory);

  return (
    <div className="flex-grow flex flex-col lg:flex-row gap-5 p-4 lg:p-6 overflow-hidden">
      <section className="flex-grow flex flex-col gap-4 overflow-hidden">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={`btn btn-sm whitespace-nowrap ${activeCategory === cat ? 'btn-primary' : ''}`}>
              {cat}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto pb-6 pr-1 no-scrollbar">
          {shown.map(item => (
            <button key={item.id} onClick={() => onPick(item)}
              className="panel overflow-hidden flex flex-col text-left transition-transform hover:-translate-y-0.5 group">
              <div className="aspect-square overflow-hidden relative" style={{ borderBottom: '1px solid var(--line)' }}>
                <img src={item.thumbnail} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                <span className="chip chip-brand absolute top-2 right-2">{item.category}</span>
              </div>
              <div className="p-3 flex flex-col flex-grow">
                <h3 className="t-head text-[15px] leading-snug mb-0.5">{item.name}</h3>
                <p className="t-label truncate">{item.description}</p>
                <div className="mt-auto pt-3 flex justify-between items-center">
                  <span className="t-num text-xl">{baht(item.price)}</span>
                  <span className="w-7 h-7 rounded-lg grid place-items-center flex-none"
                    style={{ background: 'var(--brand-soft)', color: 'var(--brand-text)' }}><Plus size={15} /></span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <aside
        className={`fixed lg:static inset-y-0 right-0 w-full sm:w-96 lg:w-80 flex flex-col z-50 transition-transform ${cartOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}
        style={{ background: 'var(--panel)', borderLeft: '1px solid var(--line)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <h3 className="t-head text-[15px]">ตะกร้า</h3>
          <button onClick={closeCart} className="btn btn-sm lg:hidden" aria-label="ปิดตะกร้า"><X size={15} /></button>
        </div>

        <div className="flex-grow p-4 overflow-y-auto flex flex-col gap-3 no-scrollbar" style={{ background: 'var(--panel-2)' }}>
          {cart.length === 0
            ? <p className="t-sub text-center mt-16" style={{ color: 'var(--muted)' }}>ยังไม่มีสินค้าในตะกร้า</p>
            : cart.map(item => (
              <div key={item.cartId} className="panel panel-pad !p-3 flex gap-3">
                <img src={item.thumbnail} alt="" className="w-12 h-12 rounded-lg object-cover flex-none" />
                <div className="flex-grow min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <p className="text-sm font-medium leading-snug">{item.name}</p>
                    <button onClick={() => onRemove(item.cartId)} aria-label="ลบ"
                      className="flex-none" style={{ color: 'var(--muted)' }}><X size={15} /></button>
                  </div>
                  {item.modifiers2.length > 0 && (
                    <div className="t-label">{item.modifiers2.map(m => m.name).join(' · ')}</div>
                  )}
                  <div className="flex justify-between items-center mt-2">
                    <div className="flex items-center gap-1 rounded-lg" style={{ border: '1px solid var(--line-2)' }}>
                      <button onClick={() => onQty(item.cartId, -1)} className="px-2 leading-none py-1" aria-label="ลดจำนวน">−</button>
                      <span className="t-num text-sm w-5 text-center">{item.quantity}</span>
                      <button onClick={() => onQty(item.cartId, 1)} className="px-2 leading-none py-1" aria-label="เพิ่มจำนวน">+</button>
                    </div>
                    <p className="t-num text-[15px]">{baht(item.totalPrice * item.quantity)}</p>
                  </div>
                </div>
              </div>
            ))}
        </div>

        <div className="p-5" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="flex justify-between items-baseline mb-4">
            <span className="t-sub">ยอดรวม</span>
            <span className="t-num text-3xl">{baht(total)}</span>
          </div>
          <button disabled={cart.length === 0} onClick={onCheckout} className="btn btn-primary btn-lg">ชำระเงิน</button>
        </div>
      </aside>
    </div>
  );
}

/* ---------------------------------------------------------------- receipt */

function ReceiptView({ order, onNew }: { order: Order | null; onNew: () => void }) {
  return (
    <div className="flex-grow flex items-start justify-center p-4 lg:p-8 overflow-y-auto no-scrollbar">
      <div className="panel w-full max-w-md p-8 mt-8 relative">
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full grid place-items-center"
          style={{ background: 'var(--good)', color: '#fff', boxShadow: 'var(--shadow)' }}>
          <CheckCircle size={24} />
        </div>
        <div className="text-center pt-4 pb-6" style={{ borderBottom: '1px dashed var(--line-2)' }}>
          <h2 className="t-head text-lg">ชำระเงินสำเร็จ</h2>
          <p className="t-mono text-sm mt-1" style={{ color: 'var(--muted)' }}>{order?.id}</p>
          <p className="t-label flex items-center justify-center gap-1 mt-1"><Clock size={13} /> {order?.time}</p>
        </div>
        <div className="py-5 flex flex-col gap-2.5" style={{ borderBottom: '1px dashed var(--line-2)' }}>
          {order?.items.map((item, idx) => (
            <div key={idx} className="flex justify-between gap-3 text-sm">
              <span><span className="t-num">{item.quantity}×</span> {item.name}</span>
              <span className="t-num whitespace-nowrap">{baht(item.totalPrice * item.quantity)}</span>
            </div>
          ))}
        </div>
        <div className="py-5 flex justify-between items-baseline">
          <span className="t-sub">ยอดรวม</span>
          <span className="t-num text-4xl" style={{ color: 'var(--brand-text)' }}>{baht(order?.total ?? 0)}</span>
        </div>
        <div className="flex flex-col gap-2.5">
          <button onClick={() => window.print()} className="btn btn-lg"><Printer size={17} /> พิมพ์ใบเสร็จ</button>
          <button onClick={onNew} className="btn btn-primary btn-lg">เริ่มบิลใหม่</button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- app */

function App() {
  const [view, setView] = useState<View>(() => viewFromHash() ?? 'POS');
  // Screens link to each other by hash (the office opens a box in the back office), so follow it.
  useEffect(() => {
    const onHash = () => { const v = viewFromHash(); if (v) setView(v); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [selectedItemForMod, setSelectedItemForMod] = useState<MenuItem | null>(null);
  const [currentMods, setCurrentMods] = useState<Modifier[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);

  const totalAmount = cart.reduce((s, i) => s + i.totalPrice * i.quantity, 0);

  const addToCart = (item: MenuItem, mods: Modifier[]) => {
    const modPrice = mods.reduce((s, m) => s + m.price, 0);
    const cartId = `${item.id}-${mods.map(m => m.name).join('-')}`;
    setCart(prev => {
      const existing = prev.find(i => i.cartId === cartId);
      if (existing) return prev.map(i => i.cartId === cartId ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { ...item, cartId, totalPrice: item.price + modPrice, quantity: 1, modifiers2: mods }];
    });
    setSelectedItemForMod(null);
    setCurrentMods([]);
  };

  const completeOrder = () => {
    setLastOrder(makeOrder([...cart], totalAmount));
    setCart([]);
    setShowPayment(false);
    setView('Receipt');
  };

  return (
    <div className="h-screen w-screen flex overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      <Sidebar view={view} open={isSidebarOpen} onPick={(v) => { setView(v); setIsSidebarOpen(false); }} />

      <main className="flex-grow flex flex-col relative overflow-hidden">
        <header className="flex items-center justify-between gap-3 px-4 lg:px-6 py-3 z-30"
          style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
          <button onClick={() => setIsSidebarOpen(true)} className="btn btn-sm lg:hidden" aria-label="เมนู"><MenuIcon size={16} /></button>
          <h2 className="t-head text-[15px] truncate">{NAV.find(n => n.id === view)?.label ?? 'ใบเสร็จ'}</h2>
          <button onClick={() => setIsCartOpen(true)} className="btn btn-sm lg:hidden relative" aria-label="ตะกร้า">
            <ShoppingCart size={16} />
            {cart.length > 0 && <span className="chip chip-brand absolute -top-2 -right-2 px-1.5">{cart.length}</span>}
          </button>
        </header>

        {view === 'POS' ? (
          <POSView
            items={MENU_ITEMS}
            cart={cart}
            cartOpen={isCartOpen}
            closeCart={() => setIsCartOpen(false)}
            onPick={(item) => item.modifiers ? setSelectedItemForMod(item) : addToCart(item, [])}
            onQty={(cartId, delta) => setCart(prev => prev.map(i => i.cartId === cartId ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i))}
            onRemove={(cartId) => setCart(prev => prev.filter(i => i.cartId !== cartId))}
            onCheckout={() => setShowPayment(true)}
          />
        ) : view === 'Receipt' ? (
          <ReceiptView order={lastOrder} onNew={() => setView('POS')} />
        ) : view === 'Marketing' ? (
          <MarketingView />
        ) : view === 'Studio' ? (
          <StudioView />
        ) : view === 'Report' ? (
          <ReportView />
        ) : view === 'Office' ? (
          <OfficeView />
        ) : (
          <div className="p-10 text-center t-sub" style={{ color: 'var(--muted)' }}>
            หน้า “{NAV.find(n => n.id === view)?.label}” ยังไม่เปิดใช้งานในเวอร์ชันนี้
          </div>
        )}
      </main>

      {showPayment && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(11,14,24,.6)' }}>
          <div className="panel w-full max-w-sm text-center overflow-hidden">
            <div className="p-6" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
              <p className="text-xs opacity-75">ยอดที่ต้องชำระ</p>
              <p className="t-num text-4xl mt-1">{baht(totalAmount)}</p>
            </div>
            <div className="p-7 flex flex-col items-center">
              <div className="p-3 rounded-2xl mb-5" style={{ background: '#fff', boxShadow: 'var(--shadow)' }}>
                <QRCodeSVG value={`PAY_${totalAmount}`} size={150} />
              </div>
              <button onClick={completeOrder} className="btn btn-good btn-lg">รับเงินแล้ว</button>
              <button onClick={() => setShowPayment(false)} className="t-sub mt-3" style={{ color: 'var(--muted)' }}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {selectedItemForMod && (
        <div className="fixed inset-0 z-[100] flex items-end lg:items-center justify-center" style={{ background: 'rgba(11,14,24,.6)' }}>
          <div className="panel w-full max-w-md p-6 relative rounded-b-none lg:rounded-[var(--r)]">
            <button onClick={() => setSelectedItemForMod(null)} aria-label="ปิด"
              className="btn btn-sm absolute top-4 right-4"><X size={15} /></button>
            <div className="flex gap-4 items-center mb-5 pb-5" style={{ borderBottom: '1px solid var(--line)' }}>
              <img src={selectedItemForMod.thumbnail} alt="" className="w-16 h-16 rounded-xl object-cover flex-none" />
              <div className="min-w-0">
                <h3 className="t-head text-[16px] leading-snug">{selectedItemForMod.name}</h3>
                <p className="t-label">{selectedItemForMod.description}</p>
              </div>
            </div>
            <div className="flex flex-col gap-5 mb-6 max-h-64 overflow-y-auto no-scrollbar">
              {selectedItemForMod.modifiers?.map(cat => (
                <div key={cat.id}>
                  <p className="t-label mb-2">{cat.name}</p>
                  <div className="flex flex-wrap gap-2">
                    {cat.options.map(opt => {
                      const isSel = currentMods.some(m => m.name === opt.name);
                      return (
                        <button key={opt.id} className={`btn btn-sm ${isSel ? 'btn-primary' : ''}`}
                          onClick={() => {
                            if (cat.type === 'radio') setCurrentMods(prev => [...prev.filter(m => !cat.options.some(o => o.name === m.name)), opt]);
                            else setCurrentMods(prev => isSel ? prev.filter(m => m.name !== opt.name) : [...prev, opt]);
                          }}>
                          {opt.name}{opt.price > 0 && ` (+${opt.price})`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => addToCart(selectedItemForMod, currentMods)} className="btn btn-primary btn-lg">ใส่ตะกร้า</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
