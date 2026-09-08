import { useState, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import MarketingView from './marketing/MarketingView'
import { 
  BarChart3, 
  ShoppingCart, 
  Package, 
  TrendingUp, 
  LayoutDashboard, 
  Plus, 
  Minus,
  BrainCircuit,
  Shirt,
  X,
  Search,
  Menu as MenuIcon,
  ChevronRight,
  TrendingDown,
  Activity,
  Printer,
  CheckCircle,
  Clock
} from 'lucide-react'
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area,
  BarChart,
  Bar
} from 'recharts'

// --- Types ---
type View = 'POS' | 'Dashboard' | 'Stock' | 'Receipt' | 'Marketing';

interface Ingredient { id: string; name: string; unit: string; amount: number; minThreshold: number; maxCapacity: number; }
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

// --- Data & Constants ---
const INITIAL_STOCK: Ingredient[] = [
  { id: 'kb', name: 'กระบอกเล็ก สีดำ', unit: 'ตัว', amount: 208, minThreshold: 60, maxCapacity: 400 },
  { id: 'st', name: 'ผ้ายืด ใส่สบาย', unit: 'ตัว', amount: 70, minThreshold: 60, maxCapacity: 300 },
  { id: 'ch', name: 'ชิโน่สไตล์เกาหลี', unit: 'ตัว', amount: 73, minThreshold: 40, maxCapacity: 200 },
  { id: 'df', name: 'ทรงเดฟเอวสูง', unit: 'ตัว', amount: 240, minThreshold: 40, maxCapacity: 250 },
  { id: 'sp', name: 'ผ้ายืดสปอร์ต', unit: 'ตัว', amount: 105, minThreshold: 30, maxCapacity: 200 },
  { id: 'sh', name: 'ขาสั้นผ้าสี', unit: 'ตัว', amount: 237, minThreshold: 60, maxCapacity: 400 },
];

const SALES_STATS = [
  { time: '08:00', amount: 450 }, { time: '10:00', amount: 1200 }, { time: '12:00', amount: 3100 },
  { time: '14:00', amount: 1850 }, { time: '16:00', amount: 2400 }, { time: '18:00', amount: 950 },
];

const CATEGORY_STATS = [
  { name: 'ผู้ชาย', value: 62000 }, { name: 'ขาสั้น', value: 29000 },
  { name: 'ผู้หญิง', value: 12000 }, { name: 'ขายส่ง', value: 40000 },
];

const SIZES = ['28', '30', '32', '34', '36', '38', '40', '42', '44'];
const MODIFIER_CATEGORIES: Record<string, ModifierCategory> = {
  size: { id: 'size', name: 'ไซส์', type: 'radio', options: SIZES.map(z => ({ id: `z${z}`, name: z, price: 0 })) },
  sizeW: { id: 'sizeW', name: 'ไซส์', type: 'radio', options: ['26', '28', '30', '32', '34', '36'].map(z => ({ id: `w${z}`, name: z, price: 0 })) },
  color: { id: 'color', name: 'สี', type: 'radio', options: [{ id: 'c-bk', name: 'ดำ', price: 0 }, { id: 'c-nv', name: 'กรม', price: 0 }, { id: 'c-gy', name: 'เทา', price: 0 }] },
  wash: { id: 'wash', name: 'สี', type: 'radio', options: [{ id: 'w-mw', name: 'ฟอกกลาง', price: 0 }, { id: 'w-dk', name: 'สีเข้ม', price: 0 }] },
};

const IMG = (id: string) => `https://images.unsplash.com/${id}?q=80&w=400&auto=format&fit=crop`;
const MENU_ITEMS: MenuItem[] = [
  // --- ผู้ชาย ---
  { id: 'kb', name: 'ยีนส์ทรงกระบอกเล็ก สีดำ', description: '3 ตัว 550 · ไซส์ 28-44', price: 199, category: 'ผู้ชาย', thumbnail: IMG('photo-1542272604-787c3835535d'), modifiers: [MODIFIER_CATEGORIES.size] },
  { id: 'st', name: 'ยีนส์ผ้ายืด ใส่สบาย', description: '4 ตัว 990 ส่งฟรี · ไซส์ 28-44', price: 299, category: 'ผู้ชาย', thumbnail: IMG('photo-1541099649105-f69ad21f3246'), modifiers: [MODIFIER_CATEGORIES.wash, MODIFIER_CATEGORIES.size] },
  { id: 'ch', name: 'ชิโน่สไตล์เกาหลี', description: '3 ตัว 550 · ไซส์ 28-40', price: 199, category: 'ผู้ชาย', thumbnail: IMG('photo-1473966968600-fa801b869a1a'), modifiers: [MODIFIER_CATEGORIES.size] },
  { id: 'sp', name: 'กางเกงผ้ายืดสปอร์ต', description: '3 ตัว 499 · FREESIZE 28-36', price: 166, category: 'ผู้ชาย', thumbnail: IMG('photo-1552902865-b72c031ac5ea'), modifiers: [MODIFIER_CATEGORIES.color] },
  // --- ผู้หญิง ---
  { id: 'df', name: 'ทรงเดฟเอวสูง', description: '3 ตัว 699 · ไซส์ 26-36', price: 249, category: 'ผู้หญิง', thumbnail: IMG('photo-1584370848010-d7fe6bc767ec'), modifiers: [MODIFIER_CATEGORIES.sizeW] },
  // --- ขาสั้น ---
  { id: 'sh', name: 'ขาสั้นผ้าสี', description: '3 ตัว 499 · ไซส์ 28-44', price: 189, category: 'ขาสั้น', thumbnail: IMG('photo-1591195853828-11db59a44f6b'), modifiers: [MODIFIER_CATEGORIES.color, MODIFIER_CATEGORIES.size] },
  // --- โปร / ขายส่ง ---
  { id: 'b1g1', name: 'ยีนส์ฟอก โปร 1 แถม 1', description: '2 ตัว 490', price: 490, category: 'ขายส่ง', thumbnail: IMG('photo-1475178626620-a4d074967452'), modifiers: [MODIFIER_CATEGORIES.size] },
  { id: 'ws20', name: 'ชุดขายส่ง 20 ตัว คละแบบ', description: 'ตกตัวละ 200 · คละไซส์ 28-44', price: 4000, category: 'ขายส่ง', thumbnail: IMG('photo-1565084888279-aca607ecce0c') },
];

const CATEGORIES = ['All', 'ผู้ชาย', 'ผู้หญิง', 'ขาสั้น', 'ขายส่ง'];

function App() {
  const [view, setView] = useState<View>(() => {
    const h = window.location.hash.replace('#', '');
    return (['POS', 'Dashboard', 'Stock', 'Marketing'] as View[]).includes(h as View) ? (h as View) : 'POS';
  });
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<any[]>([]);
  const [lastOrder, setLastOrder] = useState<any>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [selectedItemForMod, setSelectedItemForMod] = useState<MenuItem | null>(null);
  const [currentMods, setCurrentMods] = useState<any[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);

  const pixelBorder = "border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]";
  const retroFont = { fontFamily: "'VT323', monospace" };
  const headerFont = { fontFamily: "'Press Start 2P', cursive" };

  const totalAmount = cart.reduce((s, i) => s + (i.totalPrice * i.quantity), 0);

  const handleAddToCart = (item: MenuItem, mods: any[]) => {
    const modPrice = mods.reduce((s, m) => s + m.price, 0);
    const cartId = `${item.id}-${mods.map(m => m.name).join('-')}`;
    setCart(prev => {
      const existing = prev.find(i => i.cartId === cartId);
      if (existing) return prev.map(i => i.cartId === cartId ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { ...item, cartId, totalPrice: item.price + modPrice, quantity: 1, modifiers: mods }];
    });
    setSelectedItemForMod(null);
    setCurrentMods([]);
  };

  const handleCompleteOrder = () => {
    const order = { id: `REC-${Math.floor(Math.random() * 9000) + 1000}`, items: [...cart], total: totalAmount, time: new Date().toLocaleTimeString() };
    setLastOrder(order);
    setCart([]);
    setShowPayment(false);
    setView('Receipt');
  };

  const POSView = () => (
    <div className="flex-grow flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
      <section className="flex-grow flex flex-col gap-4 overflow-hidden">
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)} style={retroFont} className={`px-6 py-2 ${pixelBorder} text-xl font-bold whitespace-nowrap ${activeCategory === cat ? 'bg-[#FF8400] text-white shadow-none translate-y-1' : 'bg-white'}`}>
              {cat.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto pb-24 pr-2 no-scrollbar">
          {MENU_ITEMS.filter(i => (activeCategory === 'All' || i.category === activeCategory) && i.name.toLowerCase().includes(searchQuery.toLowerCase())).map(item => (
            <button key={item.id} onClick={() => item.modifiers ? setSelectedItemForMod(item) : handleAddToCart(item, [])} className={`bg-white ${pixelBorder} flex flex-col text-left active:translate-y-1 active:shadow-none transition-all group`}>
              <div className="aspect-square border-b-4 border-black overflow-hidden relative">
                <img src={item.thumbnail} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                <div className="absolute top-2 right-2 bg-white border-2 border-black px-1 text-[10px] font-bold" style={retroFont}>{item.category}</div>
              </div>
              <div className="p-3 flex flex-col flex-grow">
                <h3 style={retroFont} className="text-xl font-black leading-none mb-1">{item.name}</h3>
                <p style={retroFont} className="text-sm text-gray-500 mb-2 truncate italic">{item.description}</p>
                <div className="mt-auto flex justify-between items-end">
                  <span style={retroFont} className="text-2xl font-black">{item.price}.-</span>
                  <div className="bg-[#6BCB77] border-2 border-black p-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"><Plus size={14} color="white"/></div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
      <aside className={`fixed lg:static inset-y-0 right-0 w-full sm:w-96 bg-[#F9F9F9] border-l-4 border-black flex flex-col z-50 transition-transform ${isCartOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}>
        <div className="p-6 border-b-4 border-black bg-[#4D96FF] text-white flex justify-between items-center">
          <span style={headerFont} className="text-[10px]">ORDER LIST</span>
          <button onClick={() => setIsCartOpen(false)} className="lg:hidden bg-white text-black p-1 border-2 border-black"><X size={16}/></button>
        </div>
        <div className="flex-grow p-4 overflow-y-auto flex flex-col gap-3 bg-[#F6F1E9] no-scrollbar">
          {cart.length === 0 ? <p style={retroFont} className="text-center mt-20 text-gray-400 text-2xl italic">CART IS EMPTY</p> : cart.map(item => (
            <div key={item.cartId} className={`bg-white p-3 ${pixelBorder} flex gap-3`}>
              <img src={item.thumbnail} className="w-12 h-12 border-2 border-black object-cover" />
              <div className="flex-grow">
                <div className="flex justify-between items-start">
                  <p style={retroFont} className="text-lg font-black leading-none">{item.name}</p>
                  <button onClick={() => setCart(prev => prev.filter(i => i.cartId !== item.cartId))} className="text-[#FF6B6B] font-bold">X</button>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <div className="flex items-center border-2 border-black p-0.5 gap-2">
                    <button onClick={() => setCart(prev => prev.map(i => i.cartId === item.cartId ? { ...i, quantity: Math.max(1, i.quantity - 1) } : i))} className="px-1 font-bold">-</button>
                    <span style={retroFont} className="text-lg font-black">{item.quantity}</span>
                    <button onClick={() => setCart(prev => prev.map(i => i.cartId === item.cartId ? { ...i, quantity: i.quantity + 1 } : i))} className="px-1 font-bold">+</button>
                  </div>
                  <p style={retroFont} className="text-xl font-bold">{item.totalPrice * item.quantity}.-</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-6 bg-black text-white">
          <div className="flex justify-between mb-4"><span style={retroFont} className="text-xl">TOTAL</span><span style={retroFont} className="text-4xl text-[#FFD93D]">{totalAmount}.-</span></div>
          <button disabled={cart.length === 0} onClick={() => setShowPayment(true)} style={headerFont} className="w-full py-4 bg-[#6BCB77] border-4 border-white shadow-[0_0_0_4px_rgba(0,0,0,1)] text-[10px] active:scale-95 transition-all">CHECKOUT</button>
        </div>
      </aside>
    </div>
  );

  const ReceiptView = () => (
    <div className="flex-grow flex items-center justify-center p-4 bg-[#F6F1E9] overflow-y-auto no-scrollbar">
      <div className={`bg-white w-full max-w-md ${pixelBorder} p-10 animate-in zoom-in duration-300 relative`}>
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#6BCB77] p-4 border-4 border-black rounded-full text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <CheckCircle size={40} />
        </div>
        <div className="text-center mt-6 border-b-4 border-black border-dashed pb-6">
          <h2 style={headerFont} className="text-xs mb-4">PAYMENT SUCCESS</h2>
          <p style={retroFont} className="text-2xl text-gray-400">{lastOrder?.id}</p>
          <div style={retroFont} className="flex justify-center gap-4 text-xl mt-2 text-gray-500">
            <span className="flex items-center gap-1"><Clock size={16}/> {lastOrder?.time}</span>
          </div>
        </div>
        <div className="py-8 flex flex-col gap-4 border-b-4 border-black border-dashed">
          {lastOrder?.items.map((item: any, idx: number) => (
            <div key={idx} className="flex justify-between" style={retroFont}>
              <span className="text-xl font-black">{item.quantity}x {item.name}</span>
              <span className="text-xl font-black">{item.totalPrice * item.quantity}.-</span>
            </div>
          ))}
        </div>
        <div className="py-6 flex justify-between items-end" style={retroFont}>
          <span className="text-2xl font-bold">TOTAL AMOUNT</span>
          <span className="text-5xl font-black text-[#FF8400]">{lastOrder?.total}.-</span>
        </div>
        <div className="flex flex-col gap-4 mt-6">
          <button onClick={() => window.print()} style={headerFont} className={`w-full py-4 bg-white text-black border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-[10px] flex items-center justify-center gap-3 active:shadow-none active:translate-y-1`}>
            <Printer size={20}/> PRINT RECEIPT
          </button>
          <button onClick={() => setView('POS')} style={headerFont} className={`w-full py-4 bg-black text-white border-4 border-white shadow-[0_0_0_4px_rgba(0,0,0,1)] text-[10px] active:scale-95`}>
            NEW ORDER
          </button>
        </div>
      </div>
    </div>
  );

  const Sidebar = () => (
    <aside className={`fixed lg:static inset-y-0 left-0 w-72 bg-[#FFD93D] p-6 z-50 border-r-4 border-black transition-transform transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
      <div className="flex items-center gap-4 mb-10">
        <div className={`bg-white p-2 border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`}><Shirt size={24} /></div>
        <h1 style={headerFont} className="text-[10px] leading-tight text-black uppercase">Climax<br/>PKjeans</h1>
      </div>
      <nav className="flex flex-col gap-4">
        {[{ id: 'POS', label: 'TERMINAL', icon: <ShoppingCart /> }, { id: 'Dashboard', label: 'ANALYTICS', icon: <LayoutDashboard /> }, { id: 'Stock', label: 'INVENTORY', icon: <Package /> }, { id: 'Marketing', label: 'MARKETING', icon: <BrainCircuit /> }].map(btn => (
          <button key={btn.id} onClick={() => { setView(btn.id as View); setIsSidebarOpen(false); }} style={retroFont} className={`p-4 text-2xl font-black text-left flex items-center gap-4 ${pixelBorder} ${view === btn.id ? 'bg-black text-white' : 'bg-white hover:bg-orange-50'}`}>
            {btn.icon} {btn.label}
          </button>
        ))}
      </nav>
    </aside>
  );

  return (
    <div className="h-screen w-screen flex bg-[#F6F1E9] text-black overflow-hidden">
      <Sidebar />
      <main className="flex-grow flex flex-col relative overflow-hidden">
        <header className="flex items-center justify-between p-4 bg-white border-b-4 border-black z-30">
          <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 bg-[#FFD93D] border-4 border-black"><MenuIcon /></button>
          <h2 style={headerFont} className="text-[8px] lg:text-[10px]">PIXEL POS v3.0</h2>
          <button onClick={() => setIsCartOpen(true)} className={`p-2 bg-[#4D96FF] text-white border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] relative`}>
            <ShoppingCart size={20} />
            {cart.length > 0 && <span style={retroFont} className="absolute -top-3 -right-3 bg-[#FF6B6B] border-2 border-black px-1 text-lg font-bold">{cart.length}</span>}
          </button>
        </header>
        {view === 'POS' ? <POSView /> : view === 'Receipt' ? <ReceiptView /> : view === 'Marketing' ? <MarketingView /> : <div className="p-10 text-center"><p style={retroFont} className="text-3xl text-gray-400">"{view} VIEW COMING SOON..."</p></div>}
      </main>

      {showPayment && (
        <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4">
          <div className={`bg-white w-full max-w-sm ${pixelBorder} text-center overflow-hidden animate-in zoom-in duration-200`}>
            <div className="bg-black p-6 text-white border-b-4 border-black">
              <h3 style={headerFont} className="text-[8px] mb-2 text-[#FFD93D]">PAYMENT</h3>
              <h3 style={retroFont} className="text-6xl font-black">฿{totalAmount}</h3>
            </div>
            <div className="p-8 flex flex-col items-center">
              <div className={`p-2 bg-white border-4 border-black mb-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]`}><QRCodeSVG value={`PAY_${totalAmount}`} size={160} /></div>
              <button onClick={handleCompleteOrder} style={headerFont} className="w-full py-4 bg-[#6BCB77] text-white border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-[8px] active:translate-y-1">PAID</button>
              <button onClick={() => setShowPayment(false)} style={retroFont} className="mt-4 text-gray-400 text-xl uppercase underline">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {selectedItemForMod && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-end lg:items-center justify-center p-0 lg:p-4">
          <div className={`bg-white w-full max-w-md ${pixelBorder} p-8 lg:rounded-none rounded-t-[3rem] relative animate-in slide-in-from-bottom duration-300`}>
            <div className="flex gap-6 items-center mb-8 border-b-4 border-black pb-6">
              <img src={selectedItemForMod.thumbnail} className="w-20 h-20 border-4 border-black object-cover shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" />
              <h3 style={retroFont} className="text-3xl font-black">{selectedItemForMod.name}</h3>
            </div>
            <div className="flex flex-col gap-8 mb-10 max-h-60 overflow-y-auto pr-2 no-scrollbar">
              {selectedItemForMod.modifiers?.map(cat => (
                <div key={cat.id}>
                  <p style={headerFont} className="text-[8px] mb-4 uppercase tracking-tighter">{cat.name}</p>
                  <div className="grid grid-cols-2 gap-3">
                    {cat.options.map(opt => {
                      const isSel = currentMods.some(m => m.name === opt.name);
                      return (
                        <button key={opt.id} onClick={() => {
                          if (cat.type === 'radio') setCurrentMods(prev => [...prev.filter(m => !cat.options.some(o => o.name === m.name)), opt]);
                          else setCurrentMods(prev => isSel ? prev.filter(m => m.name !== opt.name) : [...prev, opt]);
                        }} style={retroFont} className={`p-4 border-4 border-black text-left text-2xl font-bold transition-all ${isSel ? 'bg-[#FFD93D] translate-y-1 shadow-none' : 'bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'}`}>
                          {opt.name} {opt.price > 0 && `(+${opt.price})`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => handleAddToCart(selectedItemForMod, currentMods)} style={headerFont} className="w-full py-6 bg-black text-white border-4 border-white shadow-[0_0_0_4px_rgba(0,0,0,1)] text-[10px]">ADD TO ORDER</button>
            <button onClick={() => setSelectedItemForMod(null)} className="absolute top-6 right-6 text-black font-black text-3xl">×</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
