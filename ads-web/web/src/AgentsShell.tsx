// Entry for /command?view=agents (CommandApp picks it): loads AgentsPage as its own chunk, so the dashboard never
// downloads the list code, and shows a skeleton while it downloads, or a retry banner if the chunk can't be fetched.
import { Component, lazy, Suspense, type ReactNode } from 'react';
import './command.css';

const AgentsPage = lazy(() => import('./AgentsPage.tsx'));

function Loading() {
  return (
    <div className="cc" aria-busy="true">
      <header className="cc-top">
        <a className="cc-btn" href="/command" aria-label="กลับไป Command Center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></a>
        <div className="cc-grow"><h1><b>ทีม</b> Agent</h1><p>อ่านอย่างเดียว</p></div>
      </header>
      <main>
        <div className="cc-sec"><div className="cc-sk" style={{ height: 132 }} /></div>
        {[0, 1, 2].map((i) => <div key={i} className="cc-sk" style={{ height: 64, marginBottom: 8 }} />)}
      </main>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error('agents page failed to load', e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="cc"><main style={{ paddingTop: 16 }}>
        <div className="cc-banner cc-err" role="alert">
          <span><b>โหลดรายการ agent ไม่ได้</b><br />เช็กอินเทอร์เน็ตแล้วกดลองใหม่</span>
          <button className="cc-btn" type="button" onClick={() => location.reload()}>ลองใหม่</button>
        </div>
      </main></div>
    );
  }
}

export function AgentsEntry() {
  return <Boundary><Suspense fallback={<Loading />}><AgentsPage /></Suspense></Boundary>;
}
