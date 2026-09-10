// Números — gerenciamento dos números da WhatsApp Cloud API
import React, { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api, fmtNum, fmtPhone, fmtRel, fmtDate } from '../lib/api'
import { Modal, Pill, Empty, Spinner, Field, Icon, ConfirmButton, CopyButton, useToast } from '../components/ui'
import './Numbers.css'

const TIER_LABEL: Record<string, string> = { TIER_250: '250/dia', TIER_1K: '1.000/dia', TIER_10K: '10.000/dia', TIER_100K: '100.000/dia', TIER_UNLIMITED: 'Ilimitado' }
const QUALITY: Record<string, { kind: 'ok' | 'warn' | 'crit' | 'dim'; label: string }> = {
  GREEN: { kind: 'ok', label: 'Qualidade alta' }, YELLOW: { kind: 'warn', label: 'Qualidade média' }, RED: { kind: 'crit', label: 'Qualidade baixa' }, UNKNOWN: { kind: 'dim', label: 'Qualidade desconhecida' }
}

function BarTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return <div className="num-tip"><div className="muted">{label}</div><div>enviadas {fmtNum(r.sent)}</div><div className="up">entregues {fmtNum(r.delivered)}</div><div className="down">falhas {fmtNum(r.failed)}</div></div>
}

// ---- Card de número ----
function NumberCard({ n, onChange, templates }: { n: any; onChange: () => void; templates: any[] }) {
  const { toast } = useToast()
  const [daily, setDaily] = useState<any[]>([])
  const [busy, setBusy] = useState('')
  const [modal, setModal] = useState<'' | 'edit' | 'token' | 'test'>('')
  const [form, setForm] = useState<any>({ label: n.label, daily_cap: n.daily_cap || '', weight: n.weight ?? 1 })
  const [token, setToken] = useState('')
  const [test, setTest] = useState<any>({ phone: '', mode: 'text', text: 'Teste do Orion ✅', template_id: '', values: {} })

  useEffect(() => { api.get(`/numbers/${n.id}/daily`).then((rows: any[]) => setDaily(rows.slice(-14).map(r => ({ ...r, day: fmtDate(r.day) })))).catch(() => {}) }, [n.id, n.synced_at])

  const run = async (key: string, fn: () => Promise<any>, okMsg?: string) => {
    setBusy(key)
    try { await fn(); if (okMsg) toast(okMsg); onChange() } catch (e: any) { toast(e.message, true) } finally { setBusy('') }
  }
  const q = QUALITY[n.quality_rating] || QUALITY.UNKNOWN
  const limit = n.daily_limit || 0
  const used = n.usage?.template_sent || 0
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0
  const tpl = templates.find(t => String(t.id) === String(test.template_id))
  const tplVars: any[] = tpl ? (tpl.variables?.length ? tpl.variables : Array.from({ length: ((tpl.components || []).find((c: any) => c.type === 'BODY')?.text || '').match(/\{\{\d+\}\}/g)?.length || 0 }, (_, i) => ({ index: i + 1, name: `variável ${i + 1}` }))) : []

  const sendTest = () => run('test', async () => {
    if (!test.phone) throw new Error('informe o telefone com DDI, ex.: 5511999990000')
    const body: any = { phone: test.phone.replace(/\D/g, '') }
    if (test.mode === 'template') { if (!test.template_id) throw new Error('escolha um template'); body.template_id = test.template_id; body.values = test.values } else body.text = test.text
    await api.post(`/numbers/${n.id}/test`, body); setModal('')
  }, 'Mensagem de teste enviada')

  return <div className="card num-card">
    <div className="top-row">
      <div>
        <div className="name">{n.label}{n.is_default && <span className="tag">Padrão</span>}</div>
        <div className="phone">{fmtPhone(n.display_phone)}{n.verified_name && <span className="dim"> · {n.verified_name}</span>}</div>
      </div>
      <Pill kind={n.status === 'active' ? 'ok' : n.status === 'paused' ? 'warn' : 'crit'}>{n.status === 'active' ? 'Ativo' : n.status === 'paused' ? 'Pausado' : 'Erro'}</Pill>
    </div>
    <div className="meta">
      <Pill kind={q.kind}>{q.label}</Pill>
      <Pill kind="dim">{TIER_LABEL[n.messaging_limit] || 'Tier desconhecido'}</Pill>
      {n.daily_cap && <Pill kind="info">Teto manual {fmtNum(n.daily_cap)}/dia</Pill>}
      {n.weight != null && n.weight !== 1 && <Pill kind="dim">Peso {n.weight}</Pill>}
    </div>
    {n.last_error && <div className="err">{n.last_error}</div>}
    <div className="usage">
      <span>Uso hoje</span>
      <div className={'meter' + (pct > 90 ? ' c' : pct > 70 ? ' w' : '')}><i style={{ width: pct + '%' }} /></div>
      <span className="mono">{fmtNum(used)} / {limit ? fmtNum(limit) : '∞'}</span>
    </div>
    {daily.length > 0 && <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={daily} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barGap={1}>
          <XAxis dataKey="day" tick={{ fill: 'var(--dim)', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} interval={daily.length > 7 ? 3 : 0} />
          <Tooltip content={<BarTip />} cursor={{ fill: 'rgba(46,204,113,.06)' }} />
          <Bar dataKey="sent" fill="var(--line2)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="delivered" fill="var(--green)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="failed" fill="var(--crit)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>}
    <div className="row between dim" style={{ fontSize: 11.5 }}><span>Últimos 14 dias · enviadas / entregues / falhas</span><span>Sincronizado {n.synced_at ? fmtRel(n.synced_at) : 'nunca'}</span></div>
    <div className="actions">
      <button className="btn sm" disabled={!!busy} onClick={() => run('sync', () => api.post(`/numbers/${n.id}/sync`), 'Sincronizado com a Meta')}>{busy === 'sync' ? <Spinner /> : <Icon name="refresh" />}Sincronizar</button>
      <button className="btn sm" disabled={!!busy} onClick={() => run('status', () => api.put(`/numbers/${n.id}`, { status: n.status === 'active' ? 'paused' : 'active' }))}><Icon name={n.status === 'active' ? 'pause' : 'play'} />{n.status === 'active' ? 'Pausar' : 'Ativar'}</button>
      {!n.is_default && <button className="btn sm" disabled={!!busy} onClick={() => run('default', () => api.put(`/numbers/${n.id}`, { is_default: true }), 'Número definido como padrão')}><Icon name="check" />Definir como padrão</button>}
      <button className="btn sm" onClick={() => { setForm({ label: n.label, daily_cap: n.daily_cap || '', weight: n.weight ?? 1 }); setModal('edit') }}>Editar</button>
      <button className="btn sm" onClick={() => { setToken(''); setModal('token') }}>Atualizar token</button>
      <button className="btn sm" onClick={() => setModal('test')}><Icon name="send" />Teste de envio</button>
      <ConfirmButton className="btn danger sm" label="Remover mesmo?" onConfirm={() => run('del', () => api.del(`/numbers/${n.id}`), 'Número removido')}><Icon name="trash" />Remover</ConfirmButton>
    </div>

    {modal === 'edit' && <Modal title={`Editar ${n.label}`} onClose={() => setModal('')} footer={<><button className="btn" onClick={() => setModal('')}>Cancelar</button><button className="btn p" disabled={busy === 'edit'} onClick={() => run('edit', () => api.put(`/numbers/${n.id}`, { label: form.label, daily_cap: form.daily_cap === '' ? null : Number(form.daily_cap), weight: Number(form.weight) || 1 }), 'Número atualizado').then(() => setModal(''))}>Salvar</button></>}>
      <Field label="Apelido"><input className="inp" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Ex.: Suporte SP" /></Field>
      <Field label="Teto diário manual" hint={`Deixe vazio para usar o limite do tier da Meta (${TIER_LABEL[n.messaging_limit] || 'desconhecido'}). Útil para aquecer um número novo aos poucos.`}><input className="inp" type="number" min={0} value={form.daily_cap} onChange={e => setForm({ ...form, daily_cap: e.target.value })} placeholder="Ex.: 100" /></Field>
      <Field label="Peso na distribuição" hint="Números com peso maior recebem mais envios quando o roteamento está em rodízio."><input className="inp" type="number" min={0} step={1} value={form.weight} onChange={e => setForm({ ...form, weight: e.target.value })} /></Field>
    </Modal>}

    {modal === 'token' && <Modal title="Atualizar token" onClose={() => setModal('')} footer={<><button className="btn" onClick={() => setModal('')}>Cancelar</button><button className="btn p" disabled={!token || busy === 'token'} onClick={() => run('token', () => api.post(`/numbers/${n.id}/token`, { token: token.trim() }), 'Token atualizado').then(() => setModal(''))}>Salvar token</button></>}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Cole o token permanente do usuário do sistema (System User) com as permissões <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>. O token é guardado criptografado e validado na Meta antes de salvar.</p>
      <Field label="Token permanente"><textarea className="ta" value={token} onChange={e => setToken(e.target.value)} placeholder="EAAG…" /></Field>
    </Modal>}

    {modal === 'test' && <Modal title={`Teste de envio · ${n.label}`} onClose={() => setModal('')} footer={<><button className="btn" onClick={() => setModal('')}>Cancelar</button><button className="btn p" disabled={busy === 'test'} onClick={sendTest}>{busy === 'test' ? <Spinner /> : <Icon name="send" />}Enviar teste</button></>}>
      <Field label="Telefone de destino" hint="Com DDI e DDD, só números. Ex.: 5511999990000"><input className="inp" value={test.phone} onChange={e => setTest({ ...test, phone: e.target.value })} placeholder="5511999990000" /></Field>
      <div className="seg" style={{ marginBottom: 12, width: 'fit-content' }}>
        <button className={test.mode === 'text' ? 'on' : ''} onClick={() => setTest({ ...test, mode: 'text' })}>Texto livre</button>
        <button className={test.mode === 'template' ? 'on' : ''} onClick={() => setTest({ ...test, mode: 'template' })}>Template aprovado</button>
      </div>
      {test.mode === 'text' ? <Field label="Mensagem" hint="Texto livre só chega se o destino falou com este número nas últimas 24h. Fora da janela, use um template."><textarea className="ta" value={test.text} onChange={e => setTest({ ...test, text: e.target.value })} /></Field> :
        <>
          <Field label="Template"><select className="sel" value={test.template_id} onChange={e => setTest({ ...test, template_id: e.target.value, values: {} })}>
            <option value="">Escolha…</option>
            {templates.filter(t => t.status === 'APPROVED' && (!n.waba_id || t.waba_id === n.waba_id)).map(t => <option key={t.id} value={t.id}>{t.name} · {t.language}</option>)}
          </select></Field>
          {tplVars.map(v => <Field key={v.index} label={`{{${v.index}}} · ${v.name}`}><input className="inp" value={test.values[v.index] || ''} onChange={e => setTest({ ...test, values: { ...test.values, [v.index]: e.target.value } })} placeholder="Valor para o teste" /></Field>)}
        </>}
    </Modal>}
  </div>
}

// ---- Modal de conexão ----
function ConnectModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const [token, setToken] = useState(''), [waba, setWaba] = useState('')
  const [phones, setPhones] = useState<any[]>([]), [wabaInfo, setWabaInfo] = useState<any>(null)
  const [pick, setPick] = useState(''), [label, setLabel] = useState('')
  const [busy, setBusy] = useState('')
  const [env, setEnv] = useState<any>(null)
  useEffect(() => { api.get('/settings/env').then(setEnv).catch(() => {}) }, [])

  const discover = async () => {
    if (!token.trim() || !waba.trim()) return toast('Informe o token e o WABA ID', true)
    setBusy('discover')
    try { const r = await api.post('/numbers/discover', { token: token.trim(), waba_id: waba.trim() }); setPhones(r.phones || []); setWabaInfo(r.waba); if (!r.phones?.length) toast('Nenhum número encontrado nesta conta', true) }
    catch (e: any) { toast('Não foi possível buscar os números: ' + e.message, true) } finally { setBusy('') }
  }
  const save = async () => {
    const p = phones.find(x => x.id === pick)
    if (!p) return toast('Escolha um número', true)
    setBusy('save')
    try { await api.post('/numbers', { label: label.trim() || p.verified_name || p.display_phone_number, phone_number_id: p.id, waba_id: waba.trim(), token: token.trim() }); toast('Número conectado. Templates sincronizados.'); onDone() }
    catch (e: any) { toast(e.message, true) } finally { setBusy('') }
  }

  return <Modal title="Conectar número" size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn p" disabled={!pick || busy === 'save'} onClick={save}>{busy === 'save' ? <Spinner /> : <Icon name="check" />}Conectar</button></>}>
    <div className="num-steps">
      <div className={'num-step' + (phones.length ? ' done' : '')}><i>1</i><div>
        <h3 style={{ marginBottom: 8 }}>Credenciais da Meta</h3>
        <Field label="Token permanente (System User)"><textarea className="ta" style={{ minHeight: 60 }} value={token} onChange={e => setToken(e.target.value)} placeholder="EAAG…" /></Field>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="WABA ID (conta do WhatsApp Business)"><input className="inp" value={waba} onChange={e => setWaba(e.target.value)} placeholder="Ex.: 102938475610293" /></Field>
          <button className="btn" style={{ marginBottom: 12 }} disabled={busy === 'discover'} onClick={discover}>{busy === 'discover' ? <Spinner /> : <Icon name="search" />}Buscar números</button>
        </div>
      </div></div>

      <div className={'num-step' + (pick ? ' done' : '')}><i>2</i><div>
        <h3 style={{ marginBottom: 8 }}>Escolha o número{wabaInfo?.name && <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}> · {wabaInfo.name}</span>}</h3>
        {phones.length === 0 ? <p className="dim" style={{ margin: 0, fontSize: 12.5 }}>Os números da conta aparecem aqui depois de buscar.</p> :
          phones.map(p => <label key={p.id} className={'phone-opt' + (pick === p.id ? ' on' : '')}>
            <input type="radio" name="phone" checked={pick === p.id} onChange={() => { setPick(p.id); if (!label) setLabel(p.verified_name || '') }} />
            <div style={{ flex: 1 }}><div className="mono">{p.display_phone_number}</div><div className="dim" style={{ fontSize: 12 }}>{p.verified_name || 'Sem nome verificado'} · ID {p.id}</div></div>
            <Pill kind={(QUALITY[p.quality_rating] || QUALITY.UNKNOWN).kind}>{(QUALITY[p.quality_rating] || QUALITY.UNKNOWN).label.replace('Qualidade ', '')}</Pill>
            <Pill kind="dim">{TIER_LABEL[p.messaging_limit_tier] || '—'}</Pill>
          </label>)}
        {phones.length > 0 && <Field label="Apelido no painel"><input className="inp" value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex.: Vendas 01" /></Field>}
      </div></div>
    </div>

    <details className="help-box">
      <summary><Icon name="alert" size={14} />Onde encontro isso?</summary>
      <div className="body">
        <div><b>WABA ID</b><ol><li>Abra o <b>Meta Business Suite</b> → Configurações do negócio.</li><li>No menu Contas, clique em <b>Contas do WhatsApp</b>.</li><li>Selecione a conta: o ID numérico aparece abaixo do nome.</li></ol></div>
        <div><b>Token permanente</b><ol><li>Ainda em Configurações do negócio → Usuários → <b>Usuários do sistema</b>.</li><li>Crie (ou escolha) um usuário do sistema com função Administrador e adicione o ativo "Conta do WhatsApp".</li><li>Clique em <b>Gerar token</b>, selecione o app e marque as permissões <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>. Escolha validade "Nunca expira".</li></ol></div>
        <div><b>Webhook (para receber mensagens e status)</b><ol><li>Em <b>Meta for Developers</b> → seu app → WhatsApp → Configuração.</li><li>Em Webhook, clique em Editar e informe a URL de callback e o token de verificação abaixo.</li><li>Assine os campos <code>messages</code>, <code>message_template_status_update</code> e <code>phone_number_quality_update</code>.</li></ol>
          {env ? <div className="grid" style={{ gap: 6, marginTop: 8 }}>
            <div className="code-block"><span>{env.webhook_meta}</span><CopyButton text={env.webhook_meta} /></div>
            <div className="code-block"><span>{env.meta_verify_token || 'META_VERIFY_TOKEN não definido no .env'}</span>{env.meta_verify_token && <CopyButton text={env.meta_verify_token} />}</div>
          </div> : <p className="dim" style={{ margin: '6px 0 0' }}>Carregando URL do webhook…</p>}
        </div>
      </div>
    </details>
  </Modal>
}

export default function Numbers() {
  const { toast } = useToast()
  const [list, setList] = useState<any[] | null>(null)
  const [templates, setTemplates] = useState<any[]>([])
  const [connect, setConnect] = useState(false)
  const load = () => Promise.all([api.get('/numbers'), api.get('/templates').catch(() => [])]).then(([n, t]) => { setList(n); setTemplates(t) }).catch((e: any) => { toast(e.message, true); setList([]) })
  useEffect(() => { load() }, [])

  return <main className="main">
    <div className="top">
      <div><h1>Números</h1><div className="sub">Números da WhatsApp Cloud API conectados ao painel · qualidade e limites direto da Meta</div></div>
      <div className="tools"><button className="btn p" onClick={() => setConnect(true)}><Icon name="plus" />Conectar número</button></div>
    </div>
    {list === null ? <div className="empty"><Spinner /></div> :
      list.length === 0 ? <div className="card"><Empty title="Nenhum número conectado" action={<button className="btn p" onClick={() => setConnect(true)}><Icon name="plus" />Conectar número</button>}>Você precisa de um número na WhatsApp Cloud API para enviar mensagens. Tenha em mãos o token do usuário do sistema e o WABA ID.</Empty></div> :
        <div className="num-grid">{list.map(n => <NumberCard key={n.id} n={n} templates={templates} onChange={load} />)}</div>}
    {connect && <ConnectModal onClose={() => setConnect(false)} onDone={() => { setConnect(false); load() }} />}
  </main>
}
