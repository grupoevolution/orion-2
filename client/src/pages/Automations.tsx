// Automações — gatilhos que disparam funis
import React, { useEffect, useMemo, useState } from 'react'
import { api, fmtDuration, fmtMoney, fmtNum, fmtPhone, fmtDateTime } from '../lib/api'
import { useToast, Modal, Toggle, Pill, Empty, Spinner, Icon, Field, ConfirmButton } from '../components/ui'

const UNITS = [{ v: 1, l: 'segundos' }, { v: 60, l: 'minutos' }, { v: 3600, l: 'horas' }, { v: 86400, l: 'dias' }]
const splitSecs = (s: number) => { for (const u of [...UNITS].reverse()) if (s > 0 && s % u.v === 0) return { v: s / u.v, u: u.v }; return { v: s || 0, u: 1 } }
const SKIP_REASONS: Record<string, string> = {
  paid: 'Cliente pagou antes do envio', opted_out: 'Contato pediu para não receber', blocked: 'Contato bloqueado', cooldown: 'Dentro do período de cooldown',
  min_amount: 'Valor abaixo do mínimo', max_amount: 'Valor acima do máximo', product_filter: 'Produto fora do filtro', only_first_event: 'Não era o primeiro evento desse tipo',
  outside_window: 'Fora da janela de envio', no_variants: 'Nenhum funil configurado', no_number: 'Nenhum número disponível', inactive: 'Automação inativa'
}

const blank = (trigger = 'pix_generated') => ({
  name: '', trigger, active: false, delay_seconds: trigger === 'pix_generated' ? 420 : 0, skip_if_paid: true, min_amount: null as number | null, max_amount: null as number | null,
  product_filter: [] as string[], cooldown_hours: 72, only_first_event: true, send_window: { start: '08:00', end: '23:00', tz: 'America/Sao_Paulo' }, outside_window: 'wait',
  variants: [] as { funnel_id: number | null; weight: number }[], auto_optimize: false, attribution_hours: 24, priority: 0
})

export default function Automations() {
  const { toast } = useToast()
  const [list, setList] = useState<any[] | null>(null)
  const [triggers, setTriggers] = useState<any[]>([])
  const [funnels, setFunnels] = useState<any[]>([])
  const [edit, setEdit] = useState<any>(null)
  const [skips, setSkips] = useState<{ a: any; rows: any[] | null } | null>(null)

  const load = () => api.get('/automations').then(setList).catch(e => toast(e.message, true))
  useEffect(() => { load(); api.get('/automations/triggers').then(setTriggers).catch(() => {}); api.get('/funnels').then(setFunnels).catch(() => {}) }, [])
  const trigLabel = (k: string) => triggers.find(t => t.key === k)?.label || k
  const funnelName = (id: any) => funnels.find(f => f.id === Number(id))?.name || `Funil #${id}`

  const toggle = async (a: any, active: boolean) => {
    setList(l => l!.map(x => x.id === a.id ? { ...x, active } : x))
    try { await api.put(`/automations/${a.id}`, { active }); toast(active ? 'Automação ativada' : 'Automação pausada') } catch (e: any) { toast(e.message, true); load() }
  }
  const remove = async (a: any) => { try { await api.del(`/automations/${a.id}`); toast('Automação removida'); load() } catch (e: any) { toast(e.message, true) } }
  const createDefault = async () => {
    try { const a = await api.post('/automations', { ...blank('pix_generated'), name: 'Recuperação de Pix', min_amount: null, variants: [] }); await load(); setEdit({ ...a }); toast('Automação criada. Escolha o funil e ative.') } catch (e: any) { toast(e.message, true) }
  }
  const openSkips = async (a: any) => { setSkips({ a, rows: null }); try { setSkips({ a, rows: await api.get(`/automations/${a.id}/skips`) }) } catch (e: any) { toast(e.message, true); setSkips(null) } }

  return <main className="main">
    <div className="top">
      <div><h1>Automações</h1><div className="sub">Quando um evento acontece (Pix gerado, compra aprovada…), o Orion espera, aplica as regras e dispara um funil</div></div>
      <div className="tools"><button className="btn p" onClick={() => setEdit(blank())}><Icon name="plus" />Nova automação</button></div>
    </div>

    {list === null && <div className="empty"><Spinner /></div>}
    {list !== null && list.length === 0 && <div className="card"><Empty title="Nenhuma automação ainda"
      action={<div className="row" style={{ justifyContent: 'center' }}><button className="btn p" onClick={createDefault}><Icon name="zap" />Criar automação padrão de Pix gerado</button><button className="btn" onClick={() => setEdit(blank())}>Criar do zero</button></div>}>
      A automação mais comum: cliente gera um Pix, espera 7 minutos e, se ele ainda não pagou, dispara um funil de recuperação. Crie a padrão e só escolha o funil.
    </Empty></div>}

    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {(list || []).map(a => {
        const vs: any[] = a.variants || []
        const totalW = vs.reduce((s, v) => s + Number(v.weight || 0), 0) || 1
        const vstats = a.stats?.variants || {}
        const best = vs.map(v => ({ id: v.funnel_id, s: vstats[v.funnel_id] })).filter(x => x.s && x.s.sent >= 5).sort((x, y) => y.s.rate - x.s.rate)[0]
        const rules: string[] = []
        if (a.min_amount != null) rules.push('mín. ' + fmtMoney(a.min_amount)); if (a.max_amount != null) rules.push('máx. ' + fmtMoney(a.max_amount))
        if (a.product_filter?.length) rules.push('produtos: ' + a.product_filter.join(', '))
        if (a.cooldown_hours) rules.push(`cooldown ${a.cooldown_hours}h`); if (a.only_first_event) rules.push('só 1º evento')
        if (a.send_window?.start) rules.push(`${a.send_window.start}–${a.send_window.end} · fora: ${a.outside_window === 'skip' ? 'pula' : 'espera'}`)
        if (a.trigger === 'pix_generated' && a.skip_if_paid) rules.push('não envia se pagar')
        return <div key={a.id} className="card">
          <div className="h" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 12, minWidth: 0 }}>
              <Toggle on={!!a.active} onChange={v => toggle(a, v)} />
              <div style={{ minWidth: 0 }}>
                <h3 style={{ cursor: 'pointer' }} onClick={() => setEdit({ ...a })}>{a.name} {!a.active && <Pill kind="dim">Inativa</Pill>} {a.auto_optimize && <Pill kind="win">Otimização automática</Pill>}</h3>
                <p><b style={{ color: 'var(--text)' }}>{trigLabel(a.trigger)}</b> · espera {fmtDuration(a.delay_seconds || 0)}{a.priority ? ` · prioridade ${a.priority}` : ''}</p>
                <p style={{ marginTop: 2 }}>{rules.length ? rules.join(' · ') : 'Sem regras extras'}</p>
              </div>
            </div>
            <div className="row" style={{ flex: 'none' }}>
              <span className="mono dim" style={{ fontSize: 11.5 }} title="Agendados / disparados">{fmtNum(a.stats?.scheduled || 0)} agend. · {fmtNum(a.stats?.fired || 0)} disp.</span>
              <button className="btn sm" onClick={() => openSkips(a)}><Icon name="eye" size={13} />Ver motivos de não envio</button>
              <button className="btn sm" onClick={() => setEdit({ ...a })}>Editar</button>
              <ConfirmButton className="btn sm g" label="Remover?" onConfirm={() => remove(a)}><Icon name="trash" size={13} /></ConfirmButton>
            </div>
          </div>
          {vs.length === 0 ? <div className="dim" style={{ fontSize: 12.5 }}><Icon name="alert" size={13} /> Nenhum funil escolhido — a automação não envia nada. <a style={{ color: 'var(--green)', cursor: 'pointer' }} onClick={() => setEdit({ ...a })}>Escolher funil</a></div> :
            <table><thead><tr><th>Funil</th><th style={{ width: 200 }}>Peso</th><th className="r">Enviados</th><th className="r">Responderam</th><th className="r">Converteram</th><th className="r">Taxa</th></tr></thead><tbody>
              {vs.map((v, i) => { const s = vstats[v.funnel_id] || { sent: 0, replied: 0, converted: 0, rate: 0 }; const win = best && best.id === v.funnel_id && vs.length > 1
                return <tr key={i}>
                  <td>{funnelName(v.funnel_id)} {win && <Pill kind="win">Vencendo</Pill>}</td>
                  <td><div className="row"><div className="meter"><i style={{ width: (Number(v.weight || 0) / totalW * 100) + '%' }} /></div><span className="mono dim" style={{ fontSize: 11.5, width: 36, textAlign: 'right' }}>{Math.round(Number(v.weight || 0) / totalW * 100)}%</span></div></td>
                  <td className="m r">{fmtNum(s.sent)}</td><td className="m r">{fmtNum(s.replied)}</td><td className="m r">{fmtNum(s.converted)}</td>
                  <td className="m r" style={{ color: win ? 'var(--lime)' : undefined }}>{String(s.rate).replace('.', ',')}%</td>
                </tr> })}
            </tbody></table>}
        </div>
      })}
    </div>

    {edit && <Editor a={edit} triggers={triggers} funnels={funnels} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}

    {skips && <Modal title={`Motivos de não envio · ${skips.a.name}`} onClose={() => setSkips(null)} size="lg">
      {skips.rows === null ? <div className="empty"><Spinner /></div> : skips.rows.length === 0 ? <Empty title="Nenhum evento pulado">Todo evento elegível virou disparo.</Empty> :
        <table><thead><tr><th>Quando</th><th>Contato</th><th>Motivo</th></tr></thead><tbody>
          {skips.rows.map((r, i) => <tr key={i}><td className="m">{fmtDateTime(r.created_at)}</td><td>{r.name || '—'}<div className="mono dim" style={{ fontSize: 11 }}>{fmtPhone(r.phone)}</div></td><td>{SKIP_REASONS[r.payload?.reason] || r.payload?.reason || '—'}</td></tr>)}
        </tbody></table>}
    </Modal>}
  </main>
}

function Editor({ a, triggers, funnels, onClose, onSaved }: { a: any; triggers: any[]; funnels: any[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast()
  const [f, setF] = useState<any>({ ...blank(a.trigger), ...a, send_window: a.send_window || blank().send_window, product_filter: a.product_filter || [], variants: a.variants || [] })
  const [delay, setDelay] = useState(() => splitSecs(a.delay_seconds ?? 420))
  const [prod, setProd] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (p: any) => setF((x: any) => ({ ...x, ...p }))
  const trig = triggers.find(t => t.key === f.trigger)
  const published = useMemo(() => funnels.filter(x => x.status === 'published'), [funnels])
  const isPix = f.trigger === 'pix_generated'

  const setDelayV = (v: number, u: number) => { setDelay({ v, u }); set({ delay_seconds: Math.max(0, Math.round(v * u)) }) }
  const addProd = () => { const p = prod.trim(); if (!p) return; if (!f.product_filter.includes(p)) set({ product_filter: [...f.product_filter, p] }); setProd('') }
  const setVar = (i: number, p: any) => set({ variants: f.variants.map((v: any, j: number) => j === i ? { ...v, ...p } : v) })

  const save = async () => {
    if (!f.name.trim()) return toast('Dê um nome à automação', true)
    if (f.variants.some((v: any) => !v.funnel_id)) return toast('Escolha o funil de cada variante', true)
    setBusy(true)
    const body = { ...f, min_amount: f.min_amount === '' || f.min_amount == null ? null : Number(f.min_amount), max_amount: f.max_amount === '' || f.max_amount == null ? null : Number(f.max_amount), variants: f.variants.map((v: any) => ({ funnel_id: Number(v.funnel_id), weight: Number(v.weight || 1) })) }
    delete body.stats
    try { if (f.id) await api.put(`/automations/${f.id}`, body); else await api.post('/automations', body); toast('Automação salva'); onSaved() } catch (e: any) { toast(e.message, true) } finally { setBusy(false) }
  }

  return <Modal title={f.id ? 'Editar automação' : 'Nova automação'} onClose={onClose} size="lg"
    footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn p" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button></>}>
    <div className="grid g2">
      <Field label="Nome"><input className="inp" autoFocus value={f.name} placeholder="Ex.: Recuperação de Pix" onChange={e => set({ name: e.target.value })} /></Field>
      <Field label="Ativa"><div style={{ paddingTop: 6 }}><Toggle on={!!f.active} onChange={v => set({ active: v })} label={f.active ? 'Disparando' : 'Pausada'} /></div></Field>
    </div>

    <Sec title="Gatilho" />
    <Field label="Evento" hint={trig?.desc}>
      <select className="sel" value={f.trigger} onChange={e => { const t = e.target.value; set({ trigger: t }); if (t === 'pix_generated' && !f.delay_seconds) setDelayV(7, 60) }}>{triggers.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
    </Field>

    <Sec title="Quando disparar" />
    <div className="grid g2">
      <Field label="Esperar depois do evento" hint={isPix ? 'Aguarda o cliente pagar sozinho; se pagar nesse tempo, não envia. Padrão: 7 minutos.' : 'Zero dispara na hora.'}>
        <div className="row"><input className="inp" type="number" min={0} style={{ width: 100 }} value={delay.v} onChange={e => setDelayV(Number(e.target.value), delay.u)} /><select className="sel" value={delay.u} onChange={e => setDelayV(delay.v, Number(e.target.value))}>{UNITS.map(u => <option key={u.v} value={u.v}>{u.l}</option>)}</select></div>
      </Field>
      {isPix && <Field label="Se pagar antes"><div style={{ paddingTop: 6 }}><Toggle on={f.skip_if_paid !== false} onChange={v => set({ skip_if_paid: v })} label="Não enviar se o Pix for pago antes do disparo" /></div></Field>}
    </div>

    <Sec title="Regras" />
    <div className="grid g2">
      <Field label="Valor mínimo (R$)"><input className="inp" type="number" step="0.01" min={0} placeholder="Sem mínimo" value={f.min_amount ?? ''} onChange={e => set({ min_amount: e.target.value === '' ? null : e.target.value })} /></Field>
      <Field label="Valor máximo (R$)"><input className="inp" type="number" step="0.01" min={0} placeholder="Sem máximo" value={f.max_amount ?? ''} onChange={e => set({ max_amount: e.target.value === '' ? null : e.target.value })} /></Field>
    </div>
    <Field label="Só para estes produtos" hint="Vazio = todos. Digite o nome e pressione Enter.">
      <div className="chips" style={{ marginBottom: 6 }}>{f.product_filter.map((p: string) => <span key={p} className="chip" onClick={() => set({ product_filter: f.product_filter.filter((x: string) => x !== p) })}>{p} ×</span>)}</div>
      <input className="inp" value={prod} placeholder="Nome do produto" onChange={e => setProd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addProd() } }} onBlur={addProd} />
    </Field>
    <div className="grid g2">
      <Field label="Cooldown (horas)" hint="Não dispara de novo para o mesmo contato dentro desse intervalo."><input className="inp" type="number" min={0} value={f.cooldown_hours ?? 0} onChange={e => set({ cooldown_hours: Number(e.target.value) })} /></Field>
      <Field label="Repetição"><div style={{ paddingTop: 6 }}><Toggle on={!!f.only_first_event} onChange={v => set({ only_first_event: v })} label="Só o primeiro evento desse tipo por cliente" /></div></Field>
    </div>
    <div className="grid g3">
      <Field label="Janela de envio · início"><input className="inp" type="time" value={f.send_window.start || ''} onChange={e => set({ send_window: { ...f.send_window, start: e.target.value } })} /></Field>
      <Field label="Fim"><input className="inp" type="time" value={f.send_window.end || ''} onChange={e => set({ send_window: { ...f.send_window, end: e.target.value } })} /></Field>
      <Field label="Fora da janela"><select className="sel" value={f.outside_window || 'wait'} onChange={e => set({ outside_window: e.target.value })}><option value="wait">Esperar a janela abrir</option><option value="skip">Não enviar</option></select></Field>
    </div>

    <Sec title="Funis / variantes" right={<button className="btn sm" onClick={() => set({ variants: [...f.variants, { funnel_id: published[0]?.id || null, weight: 1 }] })}><Icon name="plus" size={12} />Variante</button>} />
    {published.length === 0 && <div className="dim" style={{ fontSize: 12.5, marginBottom: 8 }}>Nenhum funil publicado ainda. Publique um funil para poder escolher aqui.</div>}
    {f.variants.length === 0 ? <div className="empty" style={{ padding: 16 }}>Adicione ao menos um funil. Com dois ou mais, vira um teste A/B com pesos.</div> :
      f.variants.map((v: any, i: number) => <div key={i} className="row" style={{ marginBottom: 8 }}>
        <span className="mono dim" style={{ width: 22 }}>{String.fromCharCode(65 + i)}</span>
        <select className="sel" value={v.funnel_id || ''} onChange={e => setVar(i, { funnel_id: Number(e.target.value) || null })}><option value="">Escolha o funil…</option>{published.map(p => <option key={p.id} value={p.id}>{p.name} · v{p.version}</option>)}</select>
        <input className="inp" type="number" min={1} style={{ width: 80 }} title="Peso" value={v.weight ?? 1} onChange={e => setVar(i, { weight: Number(e.target.value) })} />
        <span className="dim" style={{ fontSize: 12, width: 40 }}>peso</span>
        <button className="btn g icon sm" onClick={() => set({ variants: f.variants.filter((_: any, j: number) => j !== i) })}><Icon name="x" size={13} /></button>
      </div>)}
    <div style={{ marginTop: 8 }}><Toggle on={!!f.auto_optimize} onChange={v => set({ auto_optimize: v })} label="Otimização automática" /><div className="dim" style={{ fontSize: 12, marginTop: 4 }}>Depois de 30 envios por variante, o peso passa a seguir a conversão observada, mantendo 10% de exploração.</div></div>

    <Sec title="Atribuição e prioridade" />
    <div className="grid g2">
      <Field label="Janela de atribuição (horas)" hint="Uma compra até esse tempo depois do envio conta como conversão do funil."><input className="inp" type="number" min={1} value={f.attribution_hours ?? 24} onChange={e => set({ attribution_hours: Number(e.target.value) })} /></Field>
      <Field label="Prioridade" hint="Com várias automações no mesmo gatilho, a de maior número roda primeiro."><input className="inp" type="number" value={f.priority ?? 0} onChange={e => set({ priority: Number(e.target.value) })} /></Field>
    </div>
  </Modal>
}

function Sec({ title, right }: { title: string; right?: React.ReactNode }) {
  return <div className="row between" style={{ margin: '14px 0 10px', paddingTop: 12, borderTop: '1px solid var(--line)' }}><h3>{title}</h3>{right}</div>
}
