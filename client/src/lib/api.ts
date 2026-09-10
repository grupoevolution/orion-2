// Cliente da API do Orion
export class ApiError extends Error { status: number; code?: any; details?: any; errors?: string[]
  constructor(msg: string, status: number, extra: any = {}) { super(msg); this.status = status; Object.assign(this, extra) } }

async function req<T = any>(method: string, url: string, body?: any): Promise<T> {
  const isForm = body instanceof FormData
  const res = await fetch('/api' + url, { method, headers: isForm || !body ? {} : { 'Content-Type': 'application/json' }, body: isForm ? body : body ? JSON.stringify(body) : undefined, credentials: 'include' })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth')) window.dispatchEvent(new Event('orion:unauth'))
    throw new ApiError(data?.error || (data?.errors ? data.errors.join(' ') : `Erro ${res.status}`), res.status, data || {})
  }
  return data
}

export const api = {
  get: <T = any>(u: string) => req<T>('GET', u),
  post: <T = any>(u: string, b?: any) => req<T>('POST', u, b),
  put: <T = any>(u: string, b?: any) => req<T>('PUT', u, b),
  del: <T = any>(u: string) => req<T>('DELETE', u),
  upload: <T = any>(u: string, file: File, extra: Record<string, any> = {}) => { const fd = new FormData(); fd.append('file', file); for (const [k, v] of Object.entries(extra)) fd.append(k, String(v)); return req<T>('POST', u, fd) }
}

// SSE em tempo real
export function subscribe(handlers: Partial<Record<'message' | 'status' | 'templates' | 'run', (d: any) => void>>) {
  const es = new EventSource('/api/events', { withCredentials: true })
  for (const [k, fn] of Object.entries(handlers)) es.addEventListener(k, (e: any) => { try { fn!(JSON.parse(e.data)) } catch {} })
  return () => es.close()
}

export const fmtMoney = (v: any) => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
export const fmtNum = (v: any) => Number(v || 0).toLocaleString('pt-BR')
export const fmtPct = (a: number, b: number) => b ? (a / b * 100).toFixed(1).replace('.', ',') + '%' : '—'
export const fmtPhone = (p: string) => { if (!p) return ''; if (p.startsWith('55') && p.length === 13) return `+55 (${p.slice(2, 4)}) ${p.slice(4, 9)}-${p.slice(9)}`; return '+' + p }
export const fmtTime = (d: any) => d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
export const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''
export const fmtDateTime = (d: any) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
export const fmtRel = (d: any) => { if (!d) return ''; const diff = (Date.now() - new Date(d).getTime()) / 1000; if (diff < 60) return 'agora'; if (diff < 3600) return `${Math.floor(diff / 60)} min`; if (diff < 86400) return `${Math.floor(diff / 3600)}h`; if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`; return fmtDate(d) }
export const initials = (n?: string) => (n || '?').split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase()
export const fmtDuration = (s: number) => { if (!s) return '0s'; if (s < 60) return `${s}s`; if (s < 3600) return `${Math.round(s / 60)} min`; if (s < 86400) return `${(s / 3600).toFixed(s % 3600 ? 1 : 0)}h`; return `${(s / 86400).toFixed(s % 86400 ? 1 : 0)}d` }
export const fmtWindow = (exp: any) => { if (!exp) return null; const ms = new Date(exp).getTime() - Date.now(); if (ms <= 0) return null; const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3); return `${h}h ${String(m).padStart(2, '0')}m` }
