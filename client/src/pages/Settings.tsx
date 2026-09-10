// Configurações — regras, integrações, logs, eventos e conta
import React, { useEffect, useState } from 'react'
import { api, fmtDateTime, fmtPhone, fmtRel } from '../lib/api'
import { Modal, Pill, Empty, Spinner, Field, Icon, CopyButton, useToast } from '../components/ui'

type Tab = 'rules' | 'integrations' | 'logs' | 'events' | 'account'
const TABS: { v: Tab; l: string }[] = [{ v: 'rules', l: 'Regras' }, { v: 'integrations', l: 'Integrações' }, { v: 'logs', l: 'Logs' }, { v: 'events', l: 'Eventos' }, { v: 'account', l: 'Conta' }]
const EVENT_LABEL: Record<string, string> = { pix_generated: 'Pix gerado', approved: 'Compra aprovada', refused: 'Cartão recusado', abandoned: 'Carrinho abandonado', refunded: 'Reembolso', ad_lead: 'Lead do anúncio', inbound_new: 'Novo contato', inbound: 'Mensagem recebida', quality_change: 'Qualidade mudou', automation_skipped: 'Automação pulada' }
const LOG_STATUS: Record<string, { kind: 'ok' | 'warn' | 'crit' | 'dim'; label: string }> = { processed: { kind: 'ok', label: 'Processado' }, received: { kind: 'warn', label: 'Recebido' }, ignored: { kind: 'dim', label: 'Ignorado' }, error: { kind: 'crit', label: 'Erro' } }

// ---- Regras ----
function Rules() {
  const { toast } = useToast()
  const [s, setS] = useState<any>(null), [busy, setBusy] = useState(false), [kw, setKw] = useState('')
  useEffect(() => { api.get('/settings').then((r: any) => setS({ pix_delay_minutes: 7, attribution_hours: 24, ad_window_hours: 72, quiet_hours: { start: '21:00', end: '08:00', tz: 'America/Sao_Paulo' }, optout_keywords: [], greeting: { morning: 'Bom dia', afternoon: 'Boa tarde', night: 'Boa noite' }, ...r })).catch((e: any) => toast(e.message, true)) }, [])
  if (!s) return <div className="empty"><Spinner /></div>
  const set = (k: string, v: any) => setS({ ...s, [k]: v })
  const save = async () => {
    setBusy(true)
    try { await api.put('/settings', { pix_delay_minutes: Number(s.pix_delay_minutes), attribution_hours: Number(s.attribution_hours), ad_window_hours: Number(s.ad_window_hours), quiet_hours: s.quiet_hours, optout_keywords: s.optout_keywords, greeting: s.greeting }); toast('Regras salvas') }
    catch (e: any) { toast(e.message, true) } finally { setBusy(false) }
  }
  const addKw = () => { const k = kw.trim().toLowerCase(); if (!k) return; if (!s.optout_keywords.includes(k)) set('optout_keywords', [...s.optout_keywords, k]); setKw('') }
  return <div className="grid g2">
    <div className="card">
      <div className="h"><div><h3>Recuperação de Pix</h3><p>Quando o funil de Pix gerado dispara e por quanto tempo a venda conta como recuperada</p></div></div>
      <Field label="Espera antes de contatar (minutos)" hint="Tempo médio que o cliente paga o Pix sozinho; só depois disso o funil de Pix gerado dispara. Se pagar antes, nenhuma mensagem é enviada."><input className="inp" type="number" min={0} max={1440} value={s.pix_delay_minutes} onChange={e => set('pix_delay_minutes', e.target.value)} /></Field>
      <Field label="Janela de atribuição (horas)" hint="Uma venda conta como recuperada se for paga até este prazo depois da mensagem."><input className="inp" type="number" min={1} max={720} value={s.attribution_hours} onChange={e => set('attribution_hours', e.target.value)} /></Field>
      <Field label="Janela do lead de anúncio (horas)" hint="Por quanto tempo um contato vindo de anúncio (Click to WhatsApp) fica marcado como lead quente."><input className="inp" type="number" min={1} max={720} value={s.ad_window_hours} onChange={e => set('ad_window_hours', e.target.value)} /></Field>
    </div>
    <div className="card">
      <div className="h"><div><h3>Horário de silêncio</h3><p>Automações não disparam nesse intervalo; ficam agendadas para o fim do silêncio</p></div></div>
      <div className="grid g2">
        <Field label="Início"><input className="inp" type="time" value={s.quiet_hours?.start || ''} onChange={e => set('quiet_hours', { ...s.quiet_hours, start: e.target.value })} /></Field>
        <Field label="Fim"><input className="inp" type="time" value={s.quiet_hours?.end || ''} onChange={e => set('quiet_hours', { ...s.quiet_hours, end: e.target.value })} /></Field>
      </div>
      <Field label="Fuso horário"><input className="inp" value={s.quiet_hours?.tz || ''} onChange={e => set('quiet_hours', { ...s.quiet_hours, tz: e.target.value })} placeholder="America/Sao_Paulo" /></Field>
    </div>
    <div className="card">
      <div className="h"><div><h3>Palavras de opt-out</h3><p>Se o contato responder só com uma dessas palavras, ele é marcado como descadastrado e não recebe mais automações</p></div></div>
      <div className="chips" style={{ marginBottom: 10 }}>{s.optout_keywords.map((k: string) => <span key={k} className="chip" title="Remover" onClick={() => set('optout_keywords', s.optout_keywords.filter((x: string) => x !== k))}>{k} ×</span>)}{s.optout_keywords.length === 0 && <span className="dim" style={{ fontSize: 12 }}>Nenhuma palavra cadastrada</span>}</div>
      <div className="row"><input className="inp" value={kw} onChange={e => setKw(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addKw())} placeholder="Ex.: sair, parar, cancelar" /><button className="btn" onClick={addKw}><Icon name="plus" />Adicionar</button></div>
    </div>
    <div className="card">
      <div className="h"><div><h3>Saudação por horário</h3><p>Valor da variável {'{{saudacao}}'} nas mensagens, conforme a hora do envio</p></div></div>
      <Field label="Manhã (até 12h)"><input className="inp" value={s.greeting?.morning || ''} onChange={e => set('greeting', { ...s.greeting, morning: e.target.value })} /></Field>
      <Field label="Tarde (12h às 18h)"><input className="inp" value={s.greeting?.afternoon || ''} onChange={e => set('greeting', { ...s.greeting, afternoon: e.target.value })} /></Field>
      <Field label="Noite (após 18h)"><input className="inp" value={s.greeting?.night || ''} onChange={e => set('greeting', { ...s.greeting, night: e.target.value })} /></Field>
    </div>
    <div style={{ gridColumn: '1 / -1' }} className="row"><button className="btn p" disabled={busy} onClick={save}>{busy ? <Spinner /> : <Icon name="check" />}Salvar regras</button></div>
  </div>
}

// ---- Integrações ----
function Integrations() {
  const { toast } = useToast()
  const [env, setEnv] = useState<any>(null)
  useEffect(() => { api.get('/settings/env').then(setEnv).catch((e: any) => toast(e.message, true)) }, [])
  if (!env) return <div className="empty"><Spinner /></div>
  const Block = ({ label, value }: { label: string; value?: string }) => <Field label={label}>{value ? <div className="code-block"><span>{value}</span><CopyButton text={value} /></div> : <div className="code-block"><span className="dim">não definido no .env</span></div>}</Field>
  return <div className="grid g2">
    <div className="card">
      <div className="h"><div><h3>Kirvano</h3><p>Eventos de venda: Pix gerado, compra aprovada, recusada, abandono, reembolso</p></div><Pill kind={env.has_kirvano_token ? 'ok' : 'warn'}>{env.has_kirvano_token ? 'Token configurado' : 'Sem token'}</Pill></div>
      <Block label="URL do webhook" value={env.webhook_kirvano} />
      <ol className="muted" style={{ fontSize: 12.5, paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li>Na Kirvano, vá em <b>Apps → Webhooks → Criar webhook</b>.</li>
        <li>Cole a URL acima e marque todos os eventos (compra aprovada, Pix gerado, recusada, abandono, reembolso).</li>
        <li>Defina um token secreto e coloque o mesmo valor em <code>KIRVANO_TOKEN</code> no .env do servidor.</li>
      </ol>
      {!env.has_kirvano_token && <p className="dim" style={{ fontSize: 12, marginBottom: 0 }}>Sem <code>KIRVANO_TOKEN</code>, qualquer chamada é aceita: configure para bloquear eventos falsos.</p>}
    </div>
    <div className="card">
      <div className="h"><div><h3>Meta / WhatsApp Cloud API</h3><p>Mensagens recebidas, status de entrega, aprovação de templates e qualidade</p></div><Pill kind={env.has_app_secret ? 'ok' : 'warn'}>{env.has_app_secret ? 'App secret ok' : 'Sem app secret'}</Pill></div>
      <Block label="URL de callback" value={env.webhook_meta} />
      <Block label="Token de verificação" value={env.meta_verify_token} />
      <ol className="muted" style={{ fontSize: 12.5, paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li>Em <b>Meta for Developers → seu app → WhatsApp → Configuração</b>, edite o Webhook.</li>
        <li>Cole a URL de callback e o token de verificação e clique em Verificar e salvar.</li>
        <li>Assine <code>messages</code>, <code>message_template_status_update</code> e <code>phone_number_quality_update</code>.</li>
      </ol>
      <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>Graph API {env.graph_version || '—'} · URL pública {env.public_url || 'PUBLIC_URL não definida'}</div>
    </div>
  </div>
}

// ---- Logs de webhooks ----
function Logs() {
  const { toast } = useToast()
  const [rows, setRows] = useState<any[] | null>(null), [open, setOpen] = useState<any>(null), [busy, setBusy] = useState<any>(null)
  const load = () => api.get('/logs/webhooks').then(setRows).catch((e: any) => { toast(e.message, true); setRows([]) })
  useEffect(() => { load() }, [])
  const replay = async (id: any) => { setBusy(id); try { await api.post(`/logs/webhooks/${id}/replay`); toast('Webhook reprocessado'); load() } catch (e: any) { toast(e.message, true) } finally { setBusy(null) } }
  return <div className="card">
    <div className="h"><div><h3>Webhooks recebidos</h3><p>Últimas 100 chamadas da Kirvano e da Meta</p></div><button className="btn g sm" onClick={load}><Icon name="refresh" />Atualizar</button></div>
    {rows === null ? <div className="empty"><Spinner /></div> : rows.length === 0 ? <Empty title="Nenhum webhook recebido">Configure as URLs na aba Integrações. Assim que a Kirvano ou a Meta chamarem, as requisições aparecem aqui.</Empty> :
      <table>
        <thead><tr><th>Fonte</th><th>Status</th><th>Erro</th><th>Recebido</th><th className="r">Ações</th></tr></thead>
        <tbody>{rows.map(r => { const st = LOG_STATUS[r.status] || { kind: 'dim' as const, label: r.status }; return <tr key={r.id}>
          <td><Pill kind={r.source === 'kirvano' ? 'info' : 'dim'}>{r.source}</Pill></td>
          <td><Pill kind={st.kind}>{st.label}</Pill></td>
          <td className="muted" style={{ fontSize: 12, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.error || ''}>{r.error || ''}</td>
          <td className="m" title={fmtDateTime(r.created_at)}>{fmtRel(r.created_at)}</td>
          <td className="r"><div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn g sm" onClick={() => setOpen(r)}><Icon name="eye" />Ver</button>{r.source === 'kirvano' && <button className="btn sm" disabled={busy === r.id} onClick={() => replay(r.id)}>{busy === r.id ? <Spinner /> : <Icon name="refresh" />}Reprocessar</button>}</div></td>
        </tr> })}</tbody>
      </table>}
    {open && <Modal title={`Webhook #${open.id} · ${open.source}`} size="lg" onClose={() => setOpen(null)} footer={<><CopyButton text={JSON.stringify(open.body, null, 2)} /><button className="btn" onClick={() => setOpen(null)}>Fechar</button></>}>
      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}><Pill kind={(LOG_STATUS[open.status] || { kind: 'dim' }).kind as any}>{(LOG_STATUS[open.status] || { label: open.status }).label}</Pill><span className="dim mono" style={{ fontSize: 12 }}>{fmtDateTime(open.created_at)}</span></div>
      {open.error && <div className="code-block" style={{ color: 'var(--crit)', marginBottom: 10 }}><span>{open.error}</span></div>}
      <pre className="code-block" style={{ display: 'block', whiteSpace: 'pre-wrap', margin: 0, maxHeight: '55vh', overflow: 'auto' }}>{JSON.stringify(open.body, null, 2)}</pre>
    </Modal>}
  </div>
}

// ---- Eventos ----
function Events() {
  const { toast } = useToast()
  const [rows, setRows] = useState<any[] | null>(null), [open, setOpen] = useState<any>(null)
  const load = () => api.get('/logs/events').then(setRows).catch((e: any) => { toast(e.message, true); setRows([]) })
  useEffect(() => { load() }, [])
  return <div className="card">
    <div className="h"><div><h3>Eventos internos</h3><p>Últimos 200 eventos gerados pelos webhooks e pelo sistema</p></div><button className="btn g sm" onClick={load}><Icon name="refresh" />Atualizar</button></div>
    {rows === null ? <div className="empty"><Spinner /></div> : rows.length === 0 ? <Empty title="Nenhum evento ainda">Os eventos aparecem quando a Kirvano ou a Meta enviarem webhooks.</Empty> :
      <table>
        <thead><tr><th>Tipo</th><th>Fonte</th><th>Contato</th><th>Detalhe</th><th>Quando</th><th /></tr></thead>
        <tbody>{rows.map(e => <tr key={e.id}>
          <td><Pill kind={e.type === 'approved' ? 'ok' : e.type === 'refused' || e.type === 'quality_change' ? 'crit' : e.type === 'automation_skipped' ? 'dim' : e.type === 'pix_generated' ? 'warn' : 'info'}>{EVENT_LABEL[e.type] || e.type}</Pill></td>
          <td className="m">{e.source}</td>
          <td>{e.name || (e.phone ? fmtPhone(e.phone) : <span className="dim">—</span>)}</td>
          <td className="muted" style={{ fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.payload?.reason || e.payload?.product_name || e.payload?.status || ''}</td>
          <td className="m" title={fmtDateTime(e.created_at)}>{fmtRel(e.created_at)}</td>
          <td className="r"><button className="btn g sm icon" title="Ver payload" onClick={() => setOpen(e)}><Icon name="eye" /></button></td>
        </tr>)}</tbody>
      </table>}
    {open && <Modal title={`Evento #${open.id} · ${EVENT_LABEL[open.type] || open.type}`} onClose={() => setOpen(null)} footer={<button className="btn" onClick={() => setOpen(null)}>Fechar</button>}>
      <pre className="code-block" style={{ display: 'block', whiteSpace: 'pre-wrap', margin: 0, maxHeight: '55vh', overflow: 'auto' }}>{JSON.stringify(open.payload, null, 2)}</pre>
    </Modal>}
  </div>
}

// ---- Conta ----
function Account() {
  const { toast } = useToast()
  const [p1, setP1] = useState(''), [p2, setP2] = useState(''), [busy, setBusy] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (p1.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres', true)
    if (p1 !== p2) return toast('As senhas não conferem', true)
    setBusy(true)
    try { await api.post('/auth/password', { password: p1 }); toast('Senha alterada'); setP1(''); setP2('') } catch (e: any) { toast(e.message, true) } finally { setBusy(false) }
  }
  return <form className="card" style={{ maxWidth: 420 }} onSubmit={save}>
    <div className="h"><div><h3>Trocar senha</h3><p>Senha de acesso ao painel</p></div></div>
    <Field label="Nova senha" hint="Mínimo 8 caracteres"><input className="inp" type="password" value={p1} onChange={e => setP1(e.target.value)} autoComplete="new-password" /></Field>
    <Field label="Confirmar nova senha"><input className="inp" type="password" value={p2} onChange={e => setP2(e.target.value)} autoComplete="new-password" /></Field>
    <button className="btn p" disabled={busy || !p1}>{busy ? <Spinner /> : <Icon name="check" />}Salvar senha</button>
  </form>
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>('rules')
  return <main className="main">
    <div className="top"><div><h1>Configurações</h1><div className="sub">Regras de disparo, integrações com Kirvano e Meta, logs e conta</div></div></div>
    <div className="tabs">{TABS.map(t => <button key={t.v} className={tab === t.v ? 'on' : ''} onClick={() => setTab(t.v)}>{t.l}</button>)}</div>
    {tab === 'rules' && <Rules />}
    {tab === 'integrations' && <Integrations />}
    {tab === 'logs' && <Logs />}
    {tab === 'events' && <Events />}
    {tab === 'account' && <Account />}
  </main>
}
