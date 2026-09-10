// Campanhas — disparos em massa por template ou funil
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { api, fmtPhone, fmtNum, fmtPct, fmtDateTime } from '../lib/api'
import { useToast, Modal, Pill, Empty, Spinner, Segmented, Field, Icon, ConfirmButton } from '../components/ui'
import './Campaigns.css'

type Kind = 'ok' | 'warn' | 'crit' | 'info' | 'win' | 'dim'
const STATUS: Record<string, { l: string; k: Kind }> = { draft: { l: 'Rascunho', k: 'dim' }, running: { l: 'Enviando', k: 'ok' }, paused: { l: 'Pausada', k: 'warn' }, done: { l: 'Concluída', k: 'info' }, scheduled: { l: 'Agendada', k: 'win' } }
const CC_STATUS: Record<string, { l: string; k: Kind }> = { pending: { l: 'Pendente', k: 'dim' }, sent: { l: 'Enviada', k: 'info' }, delivered: { l: 'Entregue', k: 'ok' }, read: { l: 'Lida', k: 'ok' }, replied: { l: 'Respondeu', k: 'win' }, failed: { l: 'Falhou', k: 'crit' }, skipped: { l: 'Pulado', k: 'warn' } }
const SOURCES = [['', 'Qualquer'], ['kirvano', 'Kirvano'], ['ad', 'Anúncio'], ['import', 'Importação'], ['inbound', 'Recebida'], ['manual', 'Manual']]
const DEFAULT_WINDOW = { start: '09:00', end: '21:00', tz: 'America/Sao_Paulo' }

const useDebounce = <T,>(v: T, ms = 300) => { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms]); return d }
const progressOf = (s: any = {}) => { const done = ['sent', 'delivered', 'read', 'replied', 'failed', 'skipped'].reduce((a, k) => a + (s[k] || 0), 0); return { done, total: s.total || 0, pct: s.total ? Math.round(done / s.total * 100) : 0 } }
const bodyOf = (t: any) => (t?.components || []).find((c: any) => c.type === 'BODY')?.text || ''
const varIdx = (t: any) => { const s = new Set<string>(); for (const m of bodyOf(t).matchAll(/\{\{(\d+)\}\}/g)) s.add(m[1]); (t?.variables || []).forEach((v: any) => s.add(String(v.index))); return Array.from(s).sort((a, b) => Number(a) - Number(b)) }

// ---- picker de template com variáveis (usado no wizard e na edição) ----
function TemplateStep({ templates, vars, templateId, values, onChange }: { templates: any[]; vars: any[]; templateId: number | null; values: Record<string, string>; onChange: (id: number | null, values: Record<string, string>) => void }) {
  const sel = templates.find(t => t.id === templateId)
  const [focus, setFocus] = useState<string | null>(null)
  const idxs = varIdx(sel)
  const preview = bodyOf(sel).replace(/\{\{(\d+)\}\}/g, (_: string, i: string) => values[i] || `{{${i}}}`)
  return <>
    <div className="notice">Campanhas com oferta precisam de template <b>MARKETING</b>. Utility é mais barato, mas a Meta reclassifica textos promocionais (e pode pausar o template).</div>
    {templates.length === 0 ? <Empty title="Nenhum template aprovado">Aprove um template na página Templates antes de criar a campanha.</Empty> :
      <div className="grid g2">
        <div className="tpl-list">{templates.map(t => <button key={t.id} className={'tpl-item' + (sel?.id === t.id ? ' on' : '')} onClick={() => onChange(t.id, {})}><div><b>{t.name}</b><small>{t.language}{t.quality ? ` · qualidade ${t.quality}` : ''}</small></div><span className={'tag' + (t.category === 'MARKETING' ? ' b' : t.category === 'AUTHENTICATION' ? ' o' : '')}>{t.category}</span></button>)}</div>
        <div>
          {!sel ? <p className="muted">Escolha um template ao lado.</p> : <>
            {idxs.map(i => { const name = (sel.variables || []).find((v: any) => String(v.index) === i)?.name; return <Field key={i} label={`{{${i}}}${name ? ' · ' + name : ''}`}><input className="inp" value={values[i] || ''} onFocus={() => setFocus(i)} onChange={e => onChange(sel.id, { ...values, [i]: e.target.value })} placeholder="Texto fixo ou {{variável}}" /></Field> })}
            {idxs.length > 0 && vars.length > 0 && <div className="chips" style={{ marginBottom: 12 }}>{vars.map(v => <span key={v.key} className="chip" title={v.label} onClick={() => { if (!focus) return; onChange(sel.id, { ...values, [focus]: (values[focus] || '') + `{{${v.key}}}` }) }}>{`{{${v.key}}}`}</span>)}</div>}
            <div className="field"><label>Prévia</label><div className="tpl-prev">{preview}</div></div>
          </>}
        </div>
      </div>}
  </>
}

// ---- wizard ----
function Wizard({ onClose, onCreated, numbers, templates, funnels, vars }: { onClose: () => void; onCreated: (c: any) => void; numbers: any[]; templates: any[]; funnels: any[]; vars: any[] }) {
  const { toast } = useToast()
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false)
  const [f, setF] = useState<any>({ name: '', kind: 'template', template_id: null, template_params: {}, funnel_id: null, number_ids: [] as number[], daily_limit: 100, per_minute: 10, send_window: { ...DEFAULT_WINDOW } })
  const steps = ['Nome e tipo', f.kind === 'template' ? 'Template' : 'Funil', 'Números', 'Ritmo', 'Revisão']
  const tpl = templates.find(t => t.id === f.template_id), fun = funnels.find(x => x.id === f.funnel_id)
  const valid = [f.name.trim().length > 0, f.kind === 'template' ? !!f.template_id : !!f.funnel_id, true, f.daily_limit > 0 && f.per_minute > 0, true][step]
  const create = async () => { setBusy(true); try { const c = await api.post('/campaigns', { name: f.name.trim(), kind: f.kind, template_id: f.kind === 'template' ? f.template_id : null, template_params: f.kind === 'template' ? f.template_params : {}, funnel_id: f.kind === 'funnel' ? f.funnel_id : null, number_ids: f.number_ids, daily_limit: Number(f.daily_limit), per_minute: Number(f.per_minute), send_window: f.send_window }); toast('Campanha criada — agora adicione os contatos'); onCreated(c) } catch (e: any) { toast(e.message, true) } finally { setBusy(false) } }
  return <Modal title="Nova campanha" size="lg" onClose={onClose} footer={<>
    <button className="btn g" onClick={onClose}>Cancelar</button>
    {step > 0 && <button className="btn" onClick={() => setStep(s => s - 1)}>Voltar</button>}
    {step < 4 ? <button className="btn p" disabled={!valid} onClick={() => setStep(s => s + 1)}>Continuar <Icon name="arrow" /></button> : <button className="btn p" disabled={busy} onClick={create}>{busy ? 'Criando…' : 'Criar campanha'}</button>}
  </>}>
    <div className="steps">{steps.map((s, i) => <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{i + 1}. {s}</span>)}</div>
    {step === 0 && <>
      <Field label="Nome da campanha"><input className="inp" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="ex: Black Friday — lista VIP" /></Field>
      <Field label="Tipo de envio">
        <Segmented value={f.kind} onChange={v => setF({ ...f, kind: v })} options={[{ value: 'template', label: 'Template (utility ou marketing)' }, { value: 'funnel', label: 'Funil publicado' }]} />
      </Field>
      <p className="muted" style={{ fontSize: 12.5 }}>{f.kind === 'template' ? 'Envia um único template para cada contato. Simples e barato.' : 'Dispara um funil completo por contato (o primeiro bloco precisa ser um template). Permite respostas, botões e ramificações.'}</p>
    </>}
    {step === 1 && f.kind === 'template' && <TemplateStep templates={templates} vars={vars} templateId={f.template_id} values={f.template_params} onChange={(id, values) => setF({ ...f, template_id: id, template_params: values })} />}
    {step === 1 && f.kind === 'funnel' && (funnels.length === 0 ? <Empty title="Nenhum funil publicado">Publique um funil antes de usá-lo em campanha.</Empty> : <div className="tpl-list">{funnels.map(x => <button key={x.id} className={'tpl-item' + (f.funnel_id === x.id ? ' on' : '')} onClick={() => setF({ ...f, funnel_id: x.id })}><div><b>{x.name}</b><small>{x.description || `v${x.version} · ${fmtNum(x.runs)} envios · ${fmtNum(x.conversions)} conversões`}</small></div><Pill kind="ok">Publicado</Pill></button>)}</div>)}
    {step === 2 && <>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>Marque os números que podem disparar esta campanha. Nenhum marcado = todos os números saudáveis, com rodízio automático.</p>
      {numbers.length === 0 ? <Empty title="Nenhum número conectado" /> : <div className="pick">{numbers.map(n => <label key={n.id}><input type="checkbox" checked={f.number_ids.includes(n.id)} onChange={e => setF({ ...f, number_ids: e.target.checked ? [...f.number_ids, n.id] : f.number_ids.filter((x: number) => x !== n.id) })} />{n.label}<span className="muted">{n.display_phone}</span><Pill kind={n.quality_rating === 'GREEN' ? 'ok' : n.quality_rating === 'YELLOW' ? 'warn' : n.quality_rating === 'RED' ? 'crit' : 'dim'}>{n.quality_rating || 'UNKNOWN'}</Pill><small>{n.messaging_limit?.replace('TIER_', '')}/dia</small></label>)}</div>}
    </>}
    {step === 3 && <RhythmFields f={f} setF={setF} />}
    {step === 4 && <div className="review">
      <span>Nome</span><b>{f.name}</b>
      <span>Tipo</span><b>{f.kind === 'template' ? `Template · ${tpl?.name} (${tpl?.category})` : `Funil · ${fun?.name}`}</b>
      {f.kind === 'template' && Object.keys(f.template_params).length > 0 && <><span>Variáveis</span><b className="mono" style={{ fontWeight: 400, fontSize: 12 }}>{Object.entries(f.template_params).map(([k, v]) => `{{${k}}} = ${v}`).join(' · ')}</b></>}
      <span>Números</span><b>{f.number_ids.length ? f.number_ids.map((id: number) => numbers.find(n => n.id === id)?.label).join(', ') : 'Todos os saudáveis'}</b>
      <span>Ritmo</span><b>{f.daily_limit} por dia · {f.per_minute} por minuto</b>
      <span>Janela</span><b>{f.send_window.start} – {f.send_window.end}</b>
      <span /><span className="muted">Depois de criar, adicione os contatos e clique em Iniciar.</span>
    </div>}
  </Modal>
}

function RhythmFields({ f, setF }: { f: any; setF: (v: any) => void }) {
  return <div className="grid g2">
    <Field label="Limite diário" hint="ex: 100 por dia. Respeita também o limite de cada número."><input className="inp" type="number" min={1} value={f.daily_limit} onChange={e => setF({ ...f, daily_limit: Number(e.target.value) })} /></Field>
    <Field label="Por minuto" hint="Ritmo lento protege a qualidade do número"><input className="inp" type="number" min={1} value={f.per_minute} onChange={e => setF({ ...f, per_minute: Number(e.target.value) })} /></Field>
    <Field label="Janela de envio — início"><input className="inp" type="time" value={f.send_window?.start || ''} onChange={e => setF({ ...f, send_window: { ...DEFAULT_WINDOW, ...f.send_window, start: e.target.value } })} /></Field>
    <Field label="Janela de envio — fim" hint="Fuso America/Sao_Paulo"><input className="inp" type="time" value={f.send_window?.end || ''} onChange={e => setF({ ...f, send_window: { ...DEFAULT_WINDOW, ...f.send_window, end: e.target.value } })} /></Field>
  </div>
}

// ---- adicionar contatos ----
function AddContacts({ campaignId, onClose, onAdded }: { campaignId: number; onClose: () => void; onAdded: () => void }) {
  const { toast } = useToast()
  const [mode, setMode] = useState<'csv' | 'filter' | 'pick'>('csv'), [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [filter, setFilter] = useState({ tag: '', purchased_since: '', min_purchases: '', source: '' }), [tags, setTags] = useState<string[]>([]), [count, setCount] = useState<number | null>(null)
  const [search, setSearch] = useState(''), dSearch = useDebounce(search), [list, setList] = useState<any[]>([]), [sel, setSel] = useState<number[]>([])
  useEffect(() => { api.get('/contacts/tags').then(setTags).catch(() => {}) }, [])
  useEffect(() => { if (mode !== 'pick') return; api.get(`/contacts?limit=100${dSearch ? `&search=${encodeURIComponent(dSearch)}` : ''}`).then((r: any) => setList(r.rows)).catch(() => {}) }, [mode, dSearch])
  const filterBody = () => ({ tag: filter.tag || undefined, purchased_since: filter.purchased_since || undefined, min_purchases: filter.min_purchases ? Number(filter.min_purchases) : undefined, source: filter.source || undefined })
  const submit = async () => {
    setBusy(true)
    try {
      let r: any
      if (mode === 'csv') { if (!file) return toast('Escolha um arquivo CSV', true); r = await api.upload(`/campaigns/${campaignId}/contacts`, file) }
      else if (mode === 'filter') r = await api.post(`/campaigns/${campaignId}/contacts`, { filter: filterBody() })
      else { if (!sel.length) return toast('Selecione ao menos um contato', true); r = await api.post(`/campaigns/${campaignId}/contacts`, { contact_ids: sel }) }
      setCount(r.added); toast(`${r.added} contato(s) adicionado(s)`); onAdded()
    } catch (e: any) { toast(e.message, true) } finally { setBusy(false) }
  }
  return <Modal title="Adicionar contatos" onClose={onClose} footer={<><button className="btn g" onClick={onClose}>Fechar</button><button className="btn p" disabled={busy} onClick={submit}>{busy ? 'Adicionando…' : mode === 'filter' ? 'Aplicar filtro e adicionar' : 'Adicionar'}</button></>}>
    <Segmented value={mode} onChange={v => { setMode(v); setCount(null) }} options={[{ value: 'csv', label: 'Importar CSV' }, { value: 'filter', label: 'Filtro' }, { value: 'pick', label: 'Selecionar contatos' }]} />
    <div style={{ height: 14 }} />
    {mode === 'csv' && <>
      <Field label="Arquivo CSV" hint="Colunas: phone/telefone, name/nome, email. Contatos novos são criados."><input className="inp" type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] || null)} /></Field>
    </>}
    {mode === 'filter' && <>
      <div className="grid g2">
        <Field label="Tag"><select className="sel" value={filter.tag} onChange={e => setFilter({ ...filter, tag: e.target.value })}><option value="">Qualquer</option>{tags.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
        <Field label="Origem"><select className="sel" value={filter.source} onChange={e => setFilter({ ...filter, source: e.target.value })}>{SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Compraram desde"><input className="inp" type="date" value={filter.purchased_since} onChange={e => setFilter({ ...filter, purchased_since: e.target.value })} /></Field>
        <Field label="Mínimo de compras"><input className="inp" type="number" min={0} value={filter.min_purchases} onChange={e => setFilter({ ...filter, min_purchases: e.target.value })} placeholder="0" /></Field>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>Contatos com opt-out ou bloqueados nunca entram.{count !== null && <> <b className="up">{count} adicionado(s)</b> com este filtro.</>}</p>
    </>}
    {mode === 'pick' && <>
      <input className="inp" placeholder="Buscar contato" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="pick">{list.length === 0 ? <div className="empty">Nenhum contato encontrado</div> : list.map(c => <label key={c.id}><input type="checkbox" checked={sel.includes(c.id)} onChange={e => setSel(s => e.target.checked ? [...s, c.id] : s.filter(x => x !== c.id))} />{c.name || <span className="dim">Sem nome</span>}<span className="muted mono" style={{ fontSize: 12 }}>{fmtPhone(c.phone)}</span>{c.opted_out && <Pill kind="crit">opt-out</Pill>}<small>{c.total_purchases || 0} compras</small></label>)}</div>
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>{sel.length} selecionado(s)</p>
    </>}
  </Modal>
}

// ---- detalhe ----
function CampaignDetail({ id, onClose, onChanged, numbers, templates, funnels, vars }: { id: number; onClose: () => void; onChanged: () => void; numbers: any[]; templates: any[]; funnels: any[]; vars: any[] }) {
  const { toast } = useToast()
  const [c, setC] = useState<any>(null), [tab, setTab] = useState<'contacts' | 'config'>('contacts'), [add, setAdd] = useState(false), [cfg, setCfg] = useState<any>(null), [busy, setBusy] = useState(false), [q, setQ] = useState('')
  const load = useCallback(() => api.get(`/campaigns/${id}`).then((r: any) => { setC(r); setCfg({ name: r.name, template_id: r.template_id, template_params: r.template_params || {}, funnel_id: r.funnel_id, number_ids: r.number_ids || [], daily_limit: r.daily_limit, per_minute: r.per_minute, send_window: r.send_window || DEFAULT_WINDOW }) }).catch((e: any) => { toast(e.message, true); onClose() }), [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!c || c.status !== 'running') return; const t = setInterval(load, 8000); return () => clearInterval(t) }, [c?.status, load])
  if (!c || !cfg) return <Modal title="Campanha" size="lg" onClose={onClose}><Spinner /></Modal>
  const editable = c.status === 'draft' || c.status === 'paused'
  const s = c.stats || {}, p = progressOf(s)
  const act = async (what: 'start' | 'pause') => { try { await api.post(`/campaigns/${id}/${what}`); toast(what === 'start' ? 'Campanha iniciada' : 'Campanha pausada'); load(); onChanged() } catch (e: any) { toast(e.message, true) } }
  const save = async () => { setBusy(true); try { await api.put(`/campaigns/${id}`, { ...cfg, template_id: c.kind === 'template' ? cfg.template_id : null, funnel_id: c.kind === 'funnel' ? cfg.funnel_id : null, daily_limit: Number(cfg.daily_limit), per_minute: Number(cfg.per_minute) }); toast('Configuração salva'); load(); onChanged() } catch (e: any) { toast(e.message, true) } finally { setBusy(false) } }
  const contacts = (c.contacts || []).filter((x: any) => !q || (x.name || '').toLowerCase().includes(q.toLowerCase()) || (x.phone || '').includes(q))
  const st = STATUS[c.status] || { l: c.status, k: 'dim' as Kind }
  return <Modal size="lg" onClose={onClose} title={<span className="row">{c.name}<Pill kind={st.k}>{c.status === 'running' && <Spinner />}{st.l}</Pill></span>}
    footer={<>
      <ConfirmButton className="btn danger sm" onConfirm={async () => { try { await api.del(`/campaigns/${id}`); toast('Campanha excluída'); onChanged(); onClose() } catch (e: any) { toast(e.message, true) } }}><Icon name="trash" size={13} />Excluir</ConfirmButton>
      <span style={{ flex: 1 }} />
      {tab === 'config' && editable && <button className="btn" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar configuração'}</button>}
      {(c.status === 'draft' || c.status === 'scheduled') && <button className="btn p" disabled={!p.total} title={!p.total ? 'Adicione contatos primeiro' : ''} onClick={() => act('start')}><Icon name="play" />Iniciar</button>}
      {c.status === 'running' && <button className="btn" onClick={() => act('pause')}><Icon name="pause" />Pausar</button>}
      {c.status === 'paused' && <button className="btn p" onClick={() => act('start')}><Icon name="play" />Retomar</button>}
    </>}>
    <div className="camp-detail-stats">
      <div className="kpi"><div className="k">Progresso</div><div className="v">{p.pct}%<small>{fmtNum(p.done)}/{fmtNum(p.total)}</small></div><div className="meter" style={{ marginTop: 6 }}><i style={{ width: p.pct + '%' }} /></div></div>
      <div className="kpi"><div className="k">Enviados hoje</div><div className="v">{fmtNum(c.sent_today)}<small>/ {fmtNum(c.daily_limit)}</small></div><div className="d muted">{c.send_window?.start} – {c.send_window?.end} · {c.per_minute}/min</div></div>
      <div className="kpi"><div className="k">Entregues · lidas</div><div className="v">{fmtNum((s.delivered || 0) + (s.read || 0) + (s.replied || 0))}<small>{fmtNum((s.read || 0) + (s.replied || 0))} lidas</small></div></div>
      <div className="kpi"><div className="k">Respostas · conversões</div><div className="v">{fmtNum(s.replied)}<small>{fmtNum(s.converted)} conv.</small></div><div className="d muted">{fmtNum(s.failed)} falhas · {fmtNum(s.skipped)} pulados</div></div>
    </div>
    {s.paused_reason && <div className="notice">Pausada automaticamente: {s.paused_reason}</div>}
    <div className="tabs"><button className={tab === 'contacts' ? 'on' : ''} onClick={() => setTab('contacts')}>Contatos ({fmtNum(p.total)})</button><button className={tab === 'config' ? 'on' : ''} onClick={() => setTab('config')}>Configuração</button></div>
    {tab === 'contacts' && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <input className="inp" style={{ maxWidth: 280 }} placeholder="Buscar na lista" value={q} onChange={e => setQ(e.target.value)} />
        {c.status !== 'done' && <button className="btn p sm" onClick={() => setAdd(true)}><Icon name="plus" size={13} />Adicionar contatos</button>}
      </div>
      {contacts.length === 0 ? <Empty title={p.total ? 'Nada encontrado' : 'Nenhum contato ainda'} action={p.total ? undefined : <button className="btn p" onClick={() => setAdd(true)}>Adicionar contatos</button>}>{p.total ? '' : 'Importe um CSV, use um filtro ou selecione contatos.'}</Empty> :
        <div style={{ maxHeight: 360, overflow: 'auto' }}><table>
          <thead><tr><th>Contato</th><th>Telefone</th><th>Status</th><th>Enviado em</th><th>Erro</th></tr></thead>
          <tbody>{contacts.map((x: any) => <tr key={x.id}><td>{x.name || <span className="dim">Sem nome</span>}</td><td className="m">{fmtPhone(x.phone)}</td><td><Pill kind={CC_STATUS[x.status]?.k || 'dim'}>{CC_STATUS[x.status]?.l || x.status}</Pill></td><td className="m">{x.sent_at ? fmtDateTime(x.sent_at) : '—'}</td><td className="muted" style={{ fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.error || ''}>{x.error || ''}</td></tr>)}</tbody>
        </table>{(c.contacts || []).length >= 500 && <p className="dim" style={{ fontSize: 12 }}>Mostrando os primeiros 500.</p>}</div>}
    </>}
    {tab === 'config' && <>
      {!editable && <div className="notice i">A configuração só pode ser alterada com a campanha em rascunho ou pausada.</div>}
      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Field label="Nome"><input className="inp" value={cfg.name} onChange={e => setCfg({ ...cfg, name: e.target.value })} /></Field>
        {c.kind === 'template' ? <TemplateStep templates={templates} vars={vars} templateId={cfg.template_id} values={cfg.template_params} onChange={(tid, values) => editable && setCfg({ ...cfg, template_id: tid, template_params: values })} /> :
          <Field label="Funil"><select className="sel" value={cfg.funnel_id || ''} onChange={e => setCfg({ ...cfg, funnel_id: Number(e.target.value) || null })}><option value="">Escolha…</option>{funnels.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
        <Field label="Números permitidos" hint="Nenhum marcado = todos os saudáveis"><div className="pick">{numbers.map(n => <label key={n.id}><input type="checkbox" checked={cfg.number_ids.includes(n.id)} onChange={e => setCfg({ ...cfg, number_ids: e.target.checked ? [...cfg.number_ids, n.id] : cfg.number_ids.filter((x: number) => x !== n.id) })} />{n.label}<span className="muted">{n.display_phone}</span></label>)}</div></Field>
        <RhythmFields f={cfg} setF={setCfg} />
      </fieldset>
    </>}
    {add && <AddContacts campaignId={id} onClose={() => setAdd(false)} onAdded={() => { load(); onChanged() }} />}
  </Modal>
}

// ---- página ----
export default function Campaigns() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [list, setList] = useState<any[] | null>(null), [wizard, setWizard] = useState(false)
  const [numbers, setNumbers] = useState<any[]>([]), [templates, setTemplates] = useState<any[]>([]), [funnels, setFunnels] = useState<any[]>([]), [vars, setVars] = useState<any[]>([])
  const load = useCallback(() => api.get('/campaigns').then(setList).catch((e: any) => { toast(e.message, true); setList([]) }), [])
  useEffect(() => {
    load()
    api.get('/numbers').then(setNumbers).catch(() => {})
    api.get('/templates').then((r: any[]) => setTemplates(r.filter(t => t.status === 'APPROVED'))).catch(() => {})
    api.get('/funnels').then((r: any[]) => setFunnels(r.filter(f => f.status === 'published'))).catch(() => {})
    api.get('/variables').then(setVars).catch(() => {})
  }, [load])
  useEffect(() => { if (!list?.some(c => c.status === 'running')) return; const t = setInterval(load, 15000); return () => clearInterval(t) }, [list, load])
  const running = useMemo(() => (list || []).filter(c => c.status === 'running').length, [list])
  const act = async (c: any, what: 'start' | 'pause') => { try { await api.post(`/campaigns/${c.id}/${what}`); toast(what === 'start' ? 'Campanha iniciada' : 'Campanha pausada'); load() } catch (e: any) { toast(e.message, true) } }

  return <main className="main">
    <div className="top">
      <div><h1>Campanhas</h1><div className="sub">{list ? `${list.length} campanha${list.length === 1 ? '' : 's'}${running ? ` · ${running} enviando agora` : ''}` : 'Carregando…'}</div></div>
      <div className="tools"><button className="btn p" onClick={() => setWizard(true)}><Icon name="plus" />Nova campanha</button></div>
    </div>
    {list === null ? <div className="empty"><Spinner /></div> : list.length === 0 ? <div className="card"><Empty title="Nenhuma campanha" action={<button className="btn p" onClick={() => setWizard(true)}>Criar a primeira</button>}>Campanhas disparam um template ou funil para uma lista de contatos, respeitando limite diário e janela de horário.</Empty></div> :
      <div className="camp-grid">{list.map(c => {
        const s = c.stats || {}, p = progressOf(s), st = STATUS[c.status] || { l: c.status, k: 'dim' as Kind }
        return <div key={c.id} className="card camp">
          <div className="h"><div><h3>{c.name}</h3><div className="kind">{c.kind === 'template' ? <>Template · <b>{c.template_name || '—'}</b></> : <>Funil · <b>{c.funnel_name || '—'}</b></>}</div></div><Pill kind={st.k}>{c.status === 'running' && <Spinner />}{st.l}</Pill></div>
          <div className="row"><div className={'meter' + (s.failed && s.failed / (p.done || 1) > 0.2 ? ' w' : '')}><i style={{ width: p.pct + '%' }} /></div><span className="mono muted" style={{ fontSize: 12 }}>{fmtNum(p.done)}/{fmtNum(p.total)}</span></div>
          <div className="stats">
            <div>Enviadas<b>{fmtNum(p.done - (s.failed || 0) - (s.skipped || 0))}</b></div>
            <div>Entregues<b>{fmtNum((s.delivered || 0) + (s.read || 0) + (s.replied || 0))}</b></div>
            <div>Lidas<b>{fmtNum((s.read || 0) + (s.replied || 0))}</b></div>
            <div>Respostas<b>{fmtNum(s.replied)}</b></div>
            <div>Convertidas<b className="up">{fmtNum(s.converted)}</b></div>
            <div>Falhas<b className={s.failed ? 'down' : ''}>{fmtNum(s.failed)}</b></div>
          </div>
          <div className="rate"><span>{c.daily_limit}/dia · {c.per_minute}/min</span><span>{c.send_window?.start || '—'} – {c.send_window?.end || '—'}</span>{p.done > 0 && <span>resposta {fmtPct(s.replied || 0, p.done)}</span>}{c.number_ids?.length ? <span>{c.number_ids.length} número(s)</span> : <span>todos os números</span>}</div>
          <div className="acts">
            {(c.status === 'draft' || c.status === 'scheduled') && <button className="btn p sm" disabled={!p.total} title={!p.total ? 'Adicione contatos primeiro' : ''} onClick={() => act(c, 'start')}><Icon name="play" size={13} />Iniciar</button>}
            {c.status === 'running' && <button className="btn sm" onClick={() => act(c, 'pause')}><Icon name="pause" size={13} />Pausar</button>}
            {c.status === 'paused' && <button className="btn p sm" onClick={() => act(c, 'start')}><Icon name="play" size={13} />Retomar</button>}
            <Link className="btn sm" to={`/campanhas/${c.id}`}><Icon name="eye" size={13} />Abrir</Link>
            <span className="sp"><ConfirmButton className="btn g sm danger" onConfirm={async () => { try { await api.del(`/campaigns/${c.id}`); toast('Campanha excluída'); load() } catch (e: any) { toast(e.message, true) } }}><Icon name="trash" size={13} />Excluir</ConfirmButton></span>
          </div>
        </div>
      })}</div>}
    {wizard && <Wizard numbers={numbers} templates={templates} funnels={funnels} vars={vars} onClose={() => setWizard(false)} onCreated={c => { setWizard(false); load(); navigate(`/campanhas/${c.id}`) }} />}
    {id && <CampaignDetail id={Number(id)} numbers={numbers} templates={templates} funnels={funnels} vars={vars} onClose={() => navigate('/campanhas')} onChanged={load} />}
  </main>
}
