// Componentes base compartilhados
import React, { createContext, useContext, useEffect, useState } from 'react'

// ---- Toasts ----
type Toast = { id: number; text: string; err?: boolean }
const ToastCtx = createContext<{ toast: (t: string, err?: boolean) => void }>({ toast: () => {} })
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const toast = (text: string, err = false) => { const id = Date.now() + Math.random(); setList(l => [...l, { id, text, err }]); setTimeout(() => setList(l => l.filter(t => t.id !== id)), err ? 6000 : 3500) }
  return <ToastCtx.Provider value={{ toast }}>{children}<div className="toast-wrap">{list.map(t => <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>{t.text}</div>)}</div></ToastCtx.Provider>
}

// ---- Modal ----
export function Modal({ title, onClose, children, footer, size }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; size?: 'lg' }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return <div className="modal-bg" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className={'modal' + (size ? ' ' + size : '')}>
      <div className="mh"><h2>{title}</h2><button className="btn g icon" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button></div>
      <div className="mb">{children}</div>
      {footer && <div className="mf">{footer}</div>}
    </div>
  </div>
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: React.ReactNode }) {
  return <label className="row" style={{ cursor: 'pointer' }}><button type="button" className={'tog' + (on ? '' : ' off')} onClick={() => onChange(!on)} aria-pressed={on} />{label && <span>{label}</span>}</label>
}

export function Pill({ kind = 'dim', children }: { kind?: 'ok' | 'warn' | 'crit' | 'info' | 'win' | 'dim'; children: React.ReactNode }) { return <span className={'pill ' + kind}>{children}</span> }

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}{action && <div style={{ marginTop: 14 }}>{action}</div>}</div>
}

export function Spinner() { return <span className="spinner" /> }

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return <div className="seg">{options.map(o => <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return <div className="field"><label>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>
}

export function Avatar({ name, size }: { name?: string; size?: 'sm' | 'lg' }) {
  const ini = (name || '?').split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase()
  return <div className={'av' + (size ? ' ' + size : '')}>{ini}</div>
}

// ---- Ícones (linha, 24px) ----
const ICONS: Record<string, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" />,
  funnel: <><circle cx="5" cy="6" r="2.5" /><circle cx="19" cy="12" r="2.5" /><circle cx="5" cy="18" r="2.5" /><path d="M7.5 6h4a3 3 0 0 1 3 3v0a3 3 0 0 0 3 3h-1M7.5 18h4a3 3 0 0 0 3-3v0a3 3 0 0 1 3-3" /></>,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  send: <path d="M3 11l18-7-7 18-2-8-9-3z" />,
  template: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h5" /></>,
  users: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6L9 17l-5-5" />,
  refresh: <><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  play: <path d="M6 4l14 8-14 8z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  upload: <><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 20h16" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3z" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  reply: <path d="M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v2" />,
  branch: <><circle cx="6" cy="5" r="2.5" /><circle cx="18" cy="12" r="2.5" /><circle cx="6" cy="19" r="2.5" /><path d="M6 7.5v9M8 6l7.5 5M8 18l7.5-5" /></>,
  tag: <><path d="M20 12l-8 8-9-9V4h7l10 8z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  button: <><rect x="3" y="7" width="18" height="10" rx="3" /><path d="M8 12h8" /></>,
  var: <path d="M4 18c3 0 4-12 8-12s5 12 8 12M4 6l16 12" />,
  dots: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  download: <><path d="M12 4v12M6 10l6 6 6-6" /><path d="M4 20h16" /></>,
  more: <path d="M6 9l6 6 6-6" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 18h.01" /></>,
  zap: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  log: <><path d="M4 4h16v16H4z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M13 3h6v18h-6" /></>
}
export function Icon({ name, size = 17 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICONS[name] || null}</svg>
}

export function ConfirmButton({ onConfirm, children, className = 'btn danger sm', label = 'Confirmar?' }: { onConfirm: () => void; children: React.ReactNode; className?: string; label?: string }) {
  const [arm, setArm] = useState(false)
  useEffect(() => { if (!arm) return; const t = setTimeout(() => setArm(false), 3000); return () => clearTimeout(t) }, [arm])
  return <button className={className} onClick={() => { if (arm) { onConfirm(); setArm(false) } else setArm(true) }}>{arm ? label : children}</button>
}

export function CopyButton({ text }: { text: string }) {
  const { toast } = useToast()
  return <button className="btn g sm icon" title="Copiar" onClick={() => { navigator.clipboard.writeText(text); toast('Copiado') }}><Icon name="copy" size={14} /></button>
}
