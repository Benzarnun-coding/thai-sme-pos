// Shared UI: in-app confirm dialog and toasts (instead of the browser's confirm/alert), modal, side drawer, icons.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---- confirm + toast ----

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = red button (stop, budget down on many); primary otherwise */
  tone?: 'primary' | 'danger';
}

type Toast = { id: number; text: string; tone: 'ok' | 'bad' | 'info' };

interface Ui {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  toast: (text: string, tone?: Toast['tone']) => void;
}

const UiContext = createContext<Ui>({ confirm: async () => false, toast: () => {} });
export const useUi = () => useContext(UiContext);

export function UiProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), []);
  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 8000 : 4000);
  }, []);

  const close = (v: boolean) => { pending?.resolve(v); setPending(null); };

  return (
    <UiContext.Provider value={{ confirm, toast }}>
      {children}
      {pending && (
        <Overlay onClose={() => close(false)} center>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
            <h2 id="dlg-title">{pending.title}</h2>
            {pending.body && <div className="dialog-body">{pending.body}</div>}
            <div className="dialog-actions">
              <button className="ghost" onClick={() => close(false)}>{pending.cancelLabel ?? 'ยกเลิก'}</button>
              <button className={pending.tone === 'danger' ? 'danger-solid' : 'primary'} autoFocus onClick={() => close(true)}>
                {pending.confirmLabel ?? 'ยืนยัน'}
              </button>
            </div>
          </div>
        </Overlay>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>{t.text}</div>
        ))}
      </div>
    </UiContext.Provider>
  );
}

// ---- overlays ----

function Overlay({ children, onClose, center, side }: { children: ReactNode; onClose: () => void; center?: boolean; side?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  return (
    <div className={`overlay ${center ? 'center' : ''} ${side ? 'side' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <Overlay onClose={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="ปิด"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </Overlay>
  );
}

export function Drawer({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  return (
    <Overlay onClose={onClose} side>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={label}>{children}</aside>
    </Overlay>
  );
}

// ---- icons (inline, 20×20 stroke) ----

const PATHS: Record<string, string> = {
  x: 'M5 5l10 10M15 5L5 15',
  search: 'M9 15a6 6 0 100-12 6 6 0 000 12zM13.5 13.5L17 17',
  refresh: 'M16 10a6 6 0 11-1.8-4.3M16 3v4h-4',
  chevron: 'M8 5l5 5-5 5',
  back: 'M12 5l-5 5 5 5',
  bulb: 'M7.5 14h5M8 17h4M10 3a5 5 0 00-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 00-3-9z',
  play: 'M6 4l10 6-10 6z',
  clock: 'M10 17a7 7 0 100-14 7 7 0 000 14zM10 6v4l3 2',
  up: 'M10 16V4M5 9l5-5 5 5',
  down: 'M10 4v12M5 11l5 5 5-5',
  pause: 'M7 4v12M13 4v12',
  move: 'M4 10h11M11 6l4 4-4 4',
  check: 'M4 10l4 4 8-8',
  dots: 'M5 10h.01M10 10h.01M15 10h.01',
  sliders: 'M4 6h8M15 6h1M4 14h2M9 14h7M13 4v4M7 12v4',
  sort: 'M6 4v12M3 13l3 3 3-3M14 16V4M11 7l3-3 3 3',
  info: 'M10 17a7 7 0 100-14 7 7 0 000 14zM10 9v4M10 6.5h.01',
  eyeoff: 'M3 3l14 14M8.5 8.6a2 2 0 002.9 2.8M6.2 6.3C4.6 7.3 3.5 8.7 3 10c1.2 3 4 5 7 5 1.4 0 2.7-.4 3.8-1.1M9 5.1c.3 0 .7-.1 1-.1 3 0 5.8 2 7 5-.4 1-1 1.9-1.7 2.7',
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

/** On/off switch for Meta status; asks first because it changes a live ad. */
export function StatusSwitch({ name, status, disabled, onToggle }: {
  name: string; status: string; disabled?: boolean; onToggle: (s: 'ACTIVE' | 'PAUSED') => Promise<void>;
}) {
  const { confirm } = useUi();
  const on = status === 'ACTIVE';
  return (
    <button
      className={`switch ${on ? 'on' : ''}`}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      aria-label={on ? `${name}: เปิดอยู่ — กดเพื่อหยุด` : `${name}: หยุดอยู่ — กดเพื่อเปิด`}
      title={on ? 'เปิดอยู่' : 'หยุดอยู่'}
      onClick={async (e) => {
        e.stopPropagation();
        const next = on ? 'PAUSED' : 'ACTIVE';
        const ok = await confirm({
          title: next === 'PAUSED' ? 'หยุดโฆษณานี้?' : 'เปิดโฆษณานี้?',
          body: <><p className="clip-wrap"><b>{name}</b></p><p className="muted">{next === 'PAUSED' ? 'โฆษณาจะหยุดใช้เงินทันทีบน Meta' : 'โฆษณาจะเริ่มใช้เงินทันทีบน Meta'}</p></>,
          confirmLabel: next === 'PAUSED' ? 'หยุดเลย' : 'เปิดเลย',
          tone: next === 'PAUSED' ? 'danger' : 'primary',
        });
        if (ok) await onToggle(next);
      }}
    >
      <span />
    </button>
  );
}

/** Wraps an async action with busy state and an error toast. */
export function useAction() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok, 'ok');
      return true;
    } catch (e: any) {
      toast(e?.message ?? String(e), 'bad');
      return false;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}
