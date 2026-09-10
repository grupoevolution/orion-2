// Contatos — tabela, importação/exportação e detalhe completo
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { api, fmtPhone, fmtMoney, fmtRel, fmtDateTime } from '../lib/api'
import { useToast, Modal, Toggle, Pill, Empty, Spinner, Field, Avatar, Icon } from '../components/ui'

const LIMIT = 50
const SOURCES: Record<string, string> = { kirvano: 'Kirvano', ad: 'Anúncio', import: 'Importação', inbound: 'Recebida', manual: 'Manual', unknown: 'Desconhecida' }
const SALE_STATUS: Record<string, { l: string; k: 'ok' | 'warn' | 'crit' | 'info' | 'dim' }> = { approved: { l: 'Aprovada', k: 'ok' }, pending: { l: 'Pix pendente', k: 'warn' }, refused: { l: 'Recusada', k: 'crit' }, canceled: { l: 'Cancelada', k: 'dim' }, refunded: { l: 'Reembolsada', k: 'crit' }, chargeback: { l: 'Chargeback', k: 'crit' }, abandoned: { l: 'Abandonada', k: 'dim' } }
const RUN_STATUS: Record<string, { l: string; k: 'ok' | 'warn' | 'crit' | 'info' | 'dim' }> = { scheduled: { l: 'Agendado', k: 'dim' }, running: { l: 'Em andamento', k: 'info' }, waiting_reply: { l: 'Aguardando resposta', k: 'warn' }, waiting_delay: { l: 'Aguardando', k: 'warn' }, done: { l: 'Concluído', k: 'ok' }, cancelled: { l: 'Cancelado', k: 'dim' }, failed: { l: 'Falhou', k: 'crit' } }

function useDebounce<T>(v: T, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms]); return d }

export default function Contacts() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [search, setSearch] = useState(''), dSearch = useDebounce(search)
  const [tag, setTag] = useState(''), [tags, setTags] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<any[]>([]), [total, setTotal] = useState(0), [loading, setLoading] = useState(true)
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => { setLoading(true); try { const r = await api.get(`/contacts?page=${page}&limit=${LIMIT}${dSearch ? `&search=${encodeURIComponent(dSearch)}` : ''}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`); setRows(r.rows); setTotal(r.total) } catch (e: any) { toast(e.message, true) } finally { setLoading(false) } }, [page, dSearch, tag])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [dSearch, tag])
  useEffect(() => { api.get('/contacts/tags').then(setTags).catch(() => {}) }, [])
  const pages = Math.max(1, Math.ceil(total / LIMIT))

  return <main className="main">
    <div className="top">
      <div><h1>Contatos</h1><div className="sub">{total.toLocaleString('pt-BR')} contato{total === 1 ? '' : 's'}</div></div>
      <div className="tools">
        <button className="btn" onClick={() => setImportOpen(true)}><Icon name="upload" />Importar CSV</button>
        <a className="btn" href="/api/contacts/export.csv" download><Icon name="download" />Exportar CSV</a>
      </div>
    </div>
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="inp" style={{ maxWidth: 320 }} placeholder="Buscar por nome, telefone ou e-mail" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="sel" style={{ maxWidth: 200 }} value={tag} onChange={e => setTag(e.target.value)}><option value="">Todas as tags</option>{tags.map(t => <option key={t} value={t}>{t}</option>)}</select>
        {loading && <Spinner />}
      </div>
      {!loading && rows.length === 0 ? <Empty title="Nenhum contato" action={<button className="btn p" onClick={() => setImportOpen(true)}>Importar CSV</button>}>{dSearch || tag ? 'Nada com esse filtro.' : 'Os contatos chegam pelos webhooks (Kirvano, WhatsApp) ou por importação.'}</Empty> :
        <div style={{ overflowX: 'auto' }}><table>
          <thead><tr><th>Contato</th><th>Telefone</th><th>E-mail</th><th>Tags</th><th className="r">Compras</th><th>Número dono</th><th>Origem</th><th>Atualizado</th><th>Status</th></tr></thead>
          <tbody>{rows.map(c => <tr key={c.id} className="click" onClick={() => navigate(`/contatos/${c.id}`)}>
            <td><div className="row"><Avatar name={c.name || c.phone} size="sm" /><span>{c.name || <span className="dim">Sem nome</span>}</span></div></td>
            <td className="m">{fmtPhone(c.phone)}</td>
            <td className="muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email || '—'}</td>
            <td><div className="chips">{(c.tags || []).slice(0, 4).map((t: string) => <span key={t} className="chip" style={{ cursor: 'default' }}>{t}</span>)}{(c.tags || []).length > 4 && <span className="dim">+{c.tags.length - 4}</span>}</div></td>
            <td className="m r">{c.total_purchases || 0} · {fmtMoney(c.total_spent)}</td>
            <td>{c.owner_label || <span className="dim">—</span>}</td>
            <td>{SOURCES[c.source] || c.source || '—'}</td>
            <td className="muted">{fmtRel(c.updated_at)}</td>
            <td>{c.blocked ? <Pill kind="crit">Bloqueado</Pill> : c.opted_out ? <Pill kind="crit">Opt-out</Pill> : <Pill kind="ok">Ativo</Pill>}</td>
          </tr>)}</tbody>
        </table></div>}
      {pages > 1 && <div className="row between" style={{ marginTop: 12 }}>
        <span className="muted" style={{ fontSize: 12 }}>Página {page} de {pages}</span>
        <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button><button className="btn sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Próxima</button></div>
      </div>}
    </div>
    {importOpen && <ImportModal onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); api.get('/contacts/tags').then(setTags).catch(() => {}) }} />}
    {id && <ContactDetail id={id} onClose={() => navigate('/contatos')} onSaved={load} />}
  </main>
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const [file, setFile] = useState<File | null>(null), [tag, setTag] = useState(''), [busy, setBusy] = useState(false)
  const submit = async () => { if (!file) return toast('Escolha um arquivo CSV', true); setBusy(true); try { const r = await api.upload('/contacts/import', file, tag ? { tag } : {}); toast(`${r.imported} importado(s)${r.invalid ? `, ${r.invalid} inválido(s)` : ''}`); onDone() } catch (e: any) { toast(e.message, true) } finally { setBusy(false) } }
  return <Modal title="Importar contatos" onClose={onClose} footer={<><button className="btn g" onClick={onClose}>Cancelar</button><button className="btn p" disabled={busy || !file} onClick={submit}>{busy ? 'Importando…' : 'Importar'}</button></>}>
    <Field label="Arquivo CSV"><input className="inp" type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] || null)} /></Field>
    <Field label="Tag (opcional)" hint="Aplicada a todos os contatos importados"><input className="inp" value={tag} onChange={e => setTag(e.target.value)} placeholder="ex: lista-setembro" /></Field>
    <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Colunas aceitas: <code>phone</code>/<code>telefone</code>, <code>name</code>/<code>nome</code>, <code>email</code>. A primeira linha precisa ser o cabeçalho. Telefones com DDI e DDD (ex: 5511999990000). Contatos já existentes são atualizados.</p>
  </Modal>
}

function ContactDetail({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [c, setC] = useState<any>(null), [numbers, setNumbers] = useState<any[]>([])
  const [form, setForm] = useState<any>({}), [vars, setVars] = useState<{ k: string; v: string }[]>([]), [tagInput, setTagInput] = useState('')
  const [tab, setTab] = useState<'sales' | 'runs' | 'events' | 'convs'>('sales'), [busy, setBusy] = useState(false)
  const load = useCallback(() => api.get(`/contacts/${id}`).then((r: any) => { setC(r); setForm({ name: r.name || '', email: r.email || '', tags: r.tags || [], opted_out: !!r.opted_out, blocked: !!r.blocked, owner_number_id: r.owner_number_id || '' }); setVars(Object.entries(r.variables || {}).map(([k, v]) => ({ k, v: String(v ?? '') }))) }).catch((e: any) => { toast(e.message, true); onClose() }), [id])
  useEffect(() => { load(); api.get('/numbers').then(setNumbers).catch(() => {}) }, [load])
  const save = async () => {
    setBusy(true)
    try {
      const variables: Record<string, string> = {}; vars.forEach(x => { if (x.k.trim()) variables[x.k.trim()] = x.v })
      await api.put(`/contacts/${id}`, { name: form.name, email: form.email || null, tags: form.tags, opted_out: form.opted_out, blocked: form.blocked, owner_number_id: form.owner_number_id ? Number(form.owner_number_id) : null, variables })
      toast('Contato salvo'); onSaved(); load()
    } catch (e: any) { toast(e.message, true) } finally { setBusy(false) }
  }
  const addTag = () => { const t = tagInput.trim(); if (!t) return; if (!form.tags.includes(t)) setForm({ ...form, tags: [...form.tags, t] }); setTagInput('') }
  if (!c) return <Modal title="Contato" onClose={onClose} size="lg"><Spinner /></Modal>
  const tabs = [{ v: 'sales', l: `Compras (${c.sales?.length || 0})` }, { v: 'runs', l: `Funis (${c.runs?.length || 0})` }, { v: 'events', l: `Eventos (${c.events?.length || 0})` }, { v: 'convs', l: `Conversas (${c.conversations?.length || 0})` }] as const
  return <Modal size="lg" onClose={onClose} title={<span className="row"><Avatar name={c.name || c.phone} size="sm" />{c.name || fmtPhone(c.phone)}{c.window_open && <Pill kind="ok">Janela aberta</Pill>}</span>}
    footer={<><button className="btn g" onClick={onClose}>Fechar</button><button className="btn p" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button></>}>
    <div className="grid g2">
      <div>
        <Field label="Nome"><input className="inp" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="E-mail"><input className="inp" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Telefone"><input className="inp mono" value={fmtPhone(c.phone)} disabled /></Field>
        <Field label="Número dono" hint="Número que atende este contato"><select className="sel" value={form.owner_number_id} onChange={e => setForm({ ...form, owner_number_id: e.target.value })}><option value="">Automático</option>{numbers.map(n => <option key={n.id} value={n.id}>{n.label} · {n.display_phone}</option>)}</select></Field>
        <div className="row" style={{ gap: 20, marginBottom: 12 }}>
          <Toggle on={form.opted_out} onChange={v => setForm({ ...form, opted_out: v })} label="Não receber mensagens" />
          <Toggle on={form.blocked} onChange={v => setForm({ ...form, blocked: v })} label="Bloqueado" />
        </div>
      </div>
      <div>
        <Field label="Tags">
          <div className="chips" style={{ marginBottom: 6 }}>{form.tags.map((t: string) => <span key={t} className="chip" title="Remover" onClick={() => setForm({ ...form, tags: form.tags.filter((x: string) => x !== t) })}>{t} ×</span>)}{form.tags.length === 0 && <span className="dim">Sem tags</span>}</div>
          <div className="row"><input className="inp" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} placeholder="nova tag" /><button className="btn sm" onClick={addTag}><Icon name="plus" size={13} />Adicionar</button></div>
        </Field>
        <Field label="Variáveis salvas" hint="Preenchidas pelos funis; usáveis em templates como {{chave}}">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {vars.map((x, i) => <div key={i} className="row"><input className="inp mono" style={{ flex: 1 }} value={x.k} placeholder="chave" onChange={e => setVars(vs => vs.map((y, j) => j === i ? { ...y, k: e.target.value } : y))} /><input className="inp" style={{ flex: 1.4 }} value={x.v} placeholder="valor" onChange={e => setVars(vs => vs.map((y, j) => j === i ? { ...y, v: e.target.value } : y))} /><button className="btn g sm icon" onClick={() => setVars(vs => vs.filter((_, j) => j !== i))}><Icon name="x" size={13} /></button></div>)}
            <button className="btn g sm" style={{ alignSelf: 'flex-start' }} onClick={() => setVars(vs => [...vs, { k: '', v: '' }])}><Icon name="plus" size={13} />Variável</button>
          </div>
        </Field>
        <div className="grid g2" style={{ fontSize: 12.5 }}>
          <div><span className="muted">Origem</span><br />{SOURCES[c.source] || c.source || '—'}{c.ad_headline ? <span className="dim"> · {c.ad_headline}</span> : ''}</div>
          <div><span className="muted">Compras</span><br /><span className="mono">{c.total_purchases || 0} · {fmtMoney(c.total_spent)}</span></div>
          <div><span className="muted">Criado</span><br /><span className="mono">{fmtDateTime(c.created_at)}</span></div>
          <div><span className="muted">Última mensagem recebida</span><br /><span className="mono">{c.last_inbound_at ? fmtDateTime(c.last_inbound_at) : '—'}</span></div>
        </div>
      </div>
    </div>

    <div className="tabs" style={{ marginTop: 8 }}>{tabs.map(t => <button key={t.v} className={tab === t.v ? 'on' : ''} onClick={() => setTab(t.v)}>{t.l}</button>)}</div>
    <div style={{ overflowX: 'auto' }}>
      {tab === 'sales' && (c.sales?.length ? <table><thead><tr><th>Data</th><th>Produto</th><th className="r">Valor</th><th>Pagamento</th><th>Status</th><th>Atribuição</th></tr></thead><tbody>{c.sales.map((s: any) => <tr key={s.id}><td className="m">{fmtDateTime(s.created_at)}</td><td>{s.product_name || s.offer_name || '—'}</td><td className="m r">{fmtMoney(s.amount)}</td><td>{s.payment_method || '—'}</td><td><Pill kind={SALE_STATUS[s.status]?.k || 'dim'}>{SALE_STATUS[s.status]?.l || s.status}</Pill></td><td className="muted">{s.attributed_run_id ? `Funil #${s.attributed_run_id}` : s.attributed_campaign_id ? `Campanha #${s.attributed_campaign_id}` : s.is_rebuy ? 'Recompra' : '—'}</td></tr>)}</tbody></table> : <Empty title="Nenhuma compra" />)}
      {tab === 'runs' && (c.runs?.length ? <table><thead><tr><th>Data</th><th>Funil</th><th>Automação</th><th>Status</th><th>Respondeu</th><th>Converteu</th></tr></thead><tbody>{c.runs.map((r: any) => <tr key={r.id}><td className="m">{fmtDateTime(r.created_at)}</td><td><Link to={`/funis/${r.funnel_id}`} style={{ color: 'var(--info)' }}>{r.funnel_name || `#${r.funnel_id}`}</Link></td><td className="muted">{r.automation_name || (r.campaign_id ? `Campanha #${r.campaign_id}` : '—')}</td><td><Pill kind={RUN_STATUS[r.status]?.k || 'dim'}>{RUN_STATUS[r.status]?.l || r.status}</Pill>{r.last_error && <span className="dim" title={r.last_error}> ⚠</span>}</td><td>{r.replied ? <span className="up">Sim</span> : <span className="dim">Não</span>}</td><td>{r.converted ? <span className="up">Sim</span> : <span className="dim">Não</span>}</td></tr>)}</tbody></table> : <Empty title="Nenhum funil enviado" />)}
      {tab === 'events' && (c.events?.length ? <table><thead><tr><th>Data</th><th>Tipo</th><th>Fonte</th><th>Detalhes</th></tr></thead><tbody>{c.events.map((e: any) => <tr key={e.id}><td className="m">{fmtDateTime(e.created_at)}</td><td>{e.type}</td><td className="muted">{e.source}</td><td className="muted" style={{ fontSize: 12, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(e.payload)}>{e.payload?.reason || e.payload?.product_name || e.payload?.tag || (e.payload?.amount ? fmtMoney(e.payload.amount) : '') || JSON.stringify(e.payload || {}).slice(0, 80)}</td></tr>)}</tbody></table> : <Empty title="Nenhum evento" />)}
      {tab === 'convs' && (c.conversations?.length ? <table><thead><tr><th>Número</th><th>Última mensagem</th><th>Prévia</th><th>Status</th><th></th></tr></thead><tbody>{c.conversations.map((cv: any) => <tr key={cv.id}><td>{cv.number_label}</td><td className="m">{cv.last_message_at ? fmtDateTime(cv.last_message_at) : '—'}</td><td className="muted" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cv.last_direction === 'out' ? 'Você: ' : ''}{cv.last_preview || ''}</td><td>{cv.status === 'closed' ? <Pill kind="dim">Encerrada</Pill> : <Pill kind="ok">Aberta</Pill>}{cv.unread > 0 && <span className="muted"> · {cv.unread} não lida(s)</span>}</td><td className="r"><Link className="btn sm" to={`/conversas/${cv.id}`}><Icon name="chat" size={13} />Abrir</Link></td></tr>)}</tbody></table> : <Empty title="Nenhuma conversa" />)}
    </div>
  </Modal>
}
