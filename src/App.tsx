import { useState, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { 
  BarChart3, 
  ShoppingCart, 
  Package, 
  TrendingUp, 
  LayoutDashboard, 
  Plus, 
  Minus,
  BrainCircuit,
  Coffee,
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
type View = 'POS' | 'Dashboard' | 'Stock' | 'Receipt';

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
  { id: 'beans', name: 'COFFEE BEANS', unit: 'G', amount: 4200, minThreshold: 1000, maxCapacity: 5000 },
  { id: 'milk', name: 'FRESH MILK', unit: 'ML', amount: 8500, minThreshold: 3000, maxCapacity: 12000 },
  { id: 'oatmilk', name: 'OAT MILK', unit: 'ML', amount: 1200, minThreshold: 1000, maxCapacity: 4000 },
  { id: 'chocolate', name: 'DARK CHOCO', unit: 'G', amount: 1800, minThreshold: 500, maxCapacity: 2000 },
  { id: 'butter', name: 'FRENCH BUTTER', unit: 'G', amount: 450, minThreshold: 500, maxCapacity: 3000 },
  { id: 'flour', name: 'PASTRY FLOUR', unit: 'G', amount: 9200, minThreshold: 2000, maxCapacity: 10000 },
];

const SALES_STATS = [
  { time: '08:00', amount: 450 }, { time: '10:00', amount: 1200 }, { time: '12:00', amount: 3100 },
  { time: '14:00', amount: 1850 }, { time: '16:00', amount: 2400 }, { time: '18:00', amount: 950 },
];

const CATEGORY_STATS = [
  { name: 'COFFEE', value: 4500 }, { name: 'BAKERY', value: 3200 },
  { name: 'DESSERT', value: 2100 }, { name: 'DRINKS', value: 1500 },
];

const MODIFIER_CATEGORIES: Record<string, ModifierCategory> = {
  milk: {
    id: 'milk', name: 'MILK OPTION', type: 'radio',
    options: [{ id: 'm-full', name: 'REGULAR', price: 0 }, { id: 'm-oat', name: 'OAT MILK', price: 20 }]
  },
  sweet: {
    id: 'sweet', name: 'SWEETNESS', type: 'radio',
    options: [{ id: 's0', name: '0%', price: 0 }, { id: 's50', name: '50%', price: 0 }, { id: 's100', name: '100%', price: 0 }]
  }
};

const MENU_ITEMS: MenuItem[] = [
  // --- Coffee ---
  { id: 'c1', name: 'ICED AMERICANO', description: 'Strong & Fresh', price: 45, category: 'Coffee', thumbnail: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?q=80&w=400&auto=format&fit=crop', modifiers: [MODIFIER_CATEGORIES.sweet] },
  { id: 'c2', name: 'HOT LATTE ART', description: 'Creamy Heart', price: 55, category: 'Coffee', thumbnail: 'https://images.unsplash.com/photo-1541167760496-162955ed8a9f?q=80&w=400&auto=format&fit=crop', modifiers: [MODIFIER_CATEGORIES.milk] },
  { id: 'c3', name: 'DIRTY COFFEE', description: 'Cold Milk & Hot Espresso', price: 95, category: 'Coffee', thumbnail: 'https://images.unsplash.com/photo-1559496417-e7f25cb247f3?q=80&w=400&auto=format&fit=crop' },
  { id: 'c4', name: 'CARAMEL MACCHIATO', description: 'Sweet & Silky', price: 75, category: 'Coffee', thumbnail: 'https://images.unsplash.com/photo-1485808191679-5f86510681a2?q=80&w=400&auto=format&fit=crop' },
  
  // --- Bakery ---
  { id: 'b1', name: 'ALMOND CROISSANT', description: 'Extra Flaky', price: 125, category: 'Bakery', thumbnail: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?q=80&w=400&auto=format&fit=crop' },
  { id: 'b2', name: 'BUTTER CROISSANT', description: 'French Butter', price: 85, category: 'Bakery', thumbnail: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=400&auto=format&fit=crop' },
  { id: 'b3', name: 'CHOCO LAVA CAKE', description: 'Warm & Melty', price: 145, category: 'Bakery', thumbnail: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?q=80&w=400&auto=format&fit=crop' },
  { id: 'b4', name: 'BLUEBERRY MUFFIN', description: 'Bursting with Berries', price: 75, category: 'Bakery', thumbnail: 'https://images.unsplash.com/photo-1558303420-f814d8a590f5?q=80&w=400&auto=format&fit=crop' },
  { id: 'b5', name: 'MATCHA BROWNIE', description: 'Rich & Fudgy', price: 90, category: 'Bakery', thumbnail: 'https://images.unsplash.com/photo-1515037893149-de7f840978e2?q=80&w=400&auto=format&fit=crop' },
  
  // --- Desserts & Drinks ---
  { id: 'd1', name: 'DUBAI TART', description: 'Viral Pistachio', price: 185, category: 'Dessert', thumbnail: 'https://images.unsplash.com/photo-1606312619070-d48b4c652a52?q=80&w=400&auto=format&fit=crop' },
  { id: 'd2', name: 'HONEY TOAST', description: 'Butter Overload', price: 165, category: 'Dessert', thumbnail: 'https://images.unsplash.com/photo-1484723088916-fe59a2df7151?q=80&w=400&auto=format&fit=crop' },
  { id: 't1', name: 'THAI MILK TEA', description: 'Signature Orange', price: 50, category: 'Drinks', thumbnail: 'https://images.unsplash.com/photo-1594266302456-9a528cc15f18?q=80&w=400&auto=format&fit=crop' },
  { id: 't2', name: 'STRAWBERRY SODA', description: 'Fizzy & Sweet', price: 65, category: 'Drinks', thumbnail: 'https://images.unsplash.com/photo-1546173159-319746d518e4?q=80&w=400&auto=format&fit=crop' },
];

const CATEGORIES = ['All', 'Coffee', 'Bakery', 'Dessert', 'Drinks'];

function App() {
  const [view, setView] = useState<View>('POS');
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
        <div className={`bg-white p-2 border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`}><Coffee size={24} /></div>
        <h1 style={headerFont} className="text-[10px] leading-tight text-black uppercase">Pixel<br/>Cafe</h1>
      </div>
      <nav className="flex flex-col gap-4">
        {[{ id: 'POS', label: 'TERMINAL', icon: <ShoppingCart /> }, { id: 'Dashboard', label: 'ANALYTICS', icon: <LayoutDashboard /> }, { id: 'Stock', label: 'INVENTORY', icon: <Package /> }].map(btn => (
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
        {view === 'POS' ? <POSView /> : view === 'Receipt' ? <ReceiptView /> : <div className="p-10 text-center"><p style={retroFont} className="text-3xl text-gray-400">"{view} VIEW COMING SOON..."</p></div>}
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
