import React, { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { api, subscribe } from './lib/api'
import { ToastProvider, Icon, useToast } from './components/ui'
import Dashboard from './pages/Dashboard'
import Inbox from './pages/Inbox'
import Funnels from './pages/Funnels'
import FunnelBuilder from './pages/FunnelBuilder'
import Automations from './pages/Automations'
import Campaigns from './pages/Campaigns'
import Templates from './pages/Templates'
import Contacts from './pages/Contacts'
import Numbers from './pages/Numbers'
import Settings from './pages/Settings'

const NAV = [
  { to: '/', icon: 'dashboard', label: 'Dashboard', end: true },
  { to: '/conversas', icon: 'chat', label: 'Conversas', badge: true },
  { lbl: 'Automação' },
  { to: '/funis', icon: 'funnel', label: 'Funis' },
  { to: '/automacoes', icon: 'bolt', label: 'Automações' },
  { to: '/campanhas', icon: 'send', label: 'Campanhas' },
  { to: '/templates', icon: 'template', label: 'Templates' },
  { lbl: 'Dados' },
  { to: '/contatos', icon: 'users', label: 'Contatos' },
  { to: '/numeros', icon: 'phone', label: 'Números' },
  { to: '/configuracoes', icon: 'settings', label: 'Configurações' }
]

function Login({ onOk }: { onOk: (u: any) => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { onOk(await api.post('/auth/login', { email, password })) } catch (e: any) { setErr(e.message) } finally { setBusy(false) } }
  return <div className="login"><form className="card" onSubmit={submit}>
    <div className="brand" style={{ padding: '0 0 22px' }}><i>O</i>Orion<small>2.0</small></div>
    <div className="field"><label>E-mail</label><input className="inp" type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus /></div>
    <div className="field"><label>Senha</label><input className="inp" type="password" value={password} onChange={e => setPassword(e.target.value)} /></div>
    {err && <p style={{ color: 'var(--crit)', fontSize: 13, margin: '0 0 12px' }}>{err}</p>}
    <button className="btn p" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
  </form></div>
}

function Shell({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [numbers, setNumbers] = useState<any[]>([])
  const [unread, setUnread] = useState(0)
  const { toast } = useToast()
  const load = () => { api.get('/stats/numbers').then(setNumbers).catch(() => {}); api.get('/conversations?filter=unread&limit=100').then((r: any[]) => setUnread(r.reduce((s, c) => s + (c.unread || 0), 0))).catch(() => {}) }
  useEffect(() => { load(); const t = setInterval(load, 60000); const off = subscribe({ message: d => { if (d.message?.direction === 'in') { setUnread(u => u + 1) } } }); return () => { clearInterval(t); off() } }, [])
  const q: Record<string, string> = { GREEN: '', YELLOW: 'w', RED: 'c', UNKNOWN: 'd' }
  return <div className="app">
    <aside className="side">
      <div className="brand"><i>O</i>Orion<small>2.0</small></div>
      <nav className="nav">
        {NAV.map((n, i) => n.lbl ? <div key={i} className="lbl">{n.lbl}</div> :
          <NavLink key={n.to} to={n.to!} end={n.end} className={({ isActive }) => isActive ? 'on' : ''}><Icon name={n.icon!} />{n.label}{n.badge && unread > 0 && <span className="badge">{unread}</span>}</NavLink>)}
      </nav>
      <div className="foot">
        {numbers.length === 0 && <div className="num-health"><span className="dot d" />Nenhum número conectado</div>}
        {numbers.slice(0, 4).map(n => <div key={n.id} className="num-health" title={n.last_error || ''}><span className={'dot ' + (n.status !== 'active' ? 'c' : q[n.quality_rating] ?? 'd')} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</span><span className="mono" style={{ marginLeft: 'auto', fontSize: 11 }}>{n.template_sent_today}/{n.daily_cap || { TIER_250: 250, TIER_1K: '1k', TIER_10K: '10k', TIER_100K: '100k', TIER_UNLIMITED: '∞' }[n.messaging_limit as string] || '?'}</span></div>)}
        <div className="row between" style={{ marginTop: 4 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{user.email}</span><button className="btn g sm icon" title="Sair" onClick={onLogout}><Icon name="logout" size={14} /></button></div>
      </div>
    </aside>
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/conversas" element={<Inbox />} />
      <Route path="/conversas/:id" element={<Inbox />} />
      <Route path="/funis" element={<Funnels />} />
      <Route path="/funis/:id" element={<FunnelBuilder />} />
      <Route path="/automacoes" element={<Automations />} />
      <Route path="/campanhas" element={<Campaigns />} />
      <Route path="/campanhas/:id" element={<Campaigns />} />
      <Route path="/templates" element={<Templates />} />
      <Route path="/contatos" element={<Contacts />} />
      <Route path="/contatos/:id" element={<Contacts />} />
      <Route path="/numeros" element={<Numbers />} />
      <Route path="/configuracoes" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  </div>
}

export default function App() {
  const [user, setUser] = useState<any>(undefined)
  useEffect(() => { api.get('/auth/me').then(setUser).catch(() => setUser(null)); const h = () => setUser(null); window.addEventListener('orion:unauth', h); return () => window.removeEventListener('orion:unauth', h) }, [])
  if (user === undefined) return <div className="login"><span className="spinner" /></div>
  return <ToastProvider>{user ? <Shell user={user} onLogout={() => api.post('/auth/logout').then(() => setUser(null))} /> : <Login onOk={setUser} />}</ToastProvider>
}
