// Dashboard — visão geral: KPIs, recuperação de Pix, funil, automações, saúde dos números, atividade
import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { api, fmtMoney, fmtNum, fmtPct, fmtPhone, fmtRel, fmtDate } from '../lib/api'
import { Segmented, Pill, Empty, Spinner, useToast } from '../components/ui'
import './Dashboard.css'

type Period = '1' | '7' | '30' | '90'
const PERIODS: { value: Period; label: string }[] = [{ value: '1', label: 'Hoje' }, { value: '7', label: '7 dias' }, { value: '30', label: '30 dias' }, { value: '90', label: '90 dias' }]

const TIER: Record<string, number> = { TIER_250: 250, TIER_1K: 1000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: 0 }
const QUALITY: Record<string, { kind: 'ok' | 'warn' | 'crit' | 'dim'; label: string }> = {
  GREEN: { kind: 'ok', label: 'Alta' }, YELLOW: { kind: 'warn', label: 'Média' }, RED: { kind: 'crit', label: 'Baixa' }, UNKNOWN: { kind: 'dim', label: 'Desconhecida' }
}
const EVENT_LABEL: Record<string, string> = {
  pix_generated: 'Pix gerado', approved: 'Compra aprovada', refused: 'Cartão recusado', abandoned: 'Carrinho abandonado',
  ad_lead: 'Lead do anúncio', inbound_new: 'Novo contato', quality_change: 'Qualidade do número mudou', refunded: 'Reembolso', inbound: 'Mensagem recebida'
}
const TRIGGER_LABEL: Record<string, string> = {
  pix_generated: 'Pix gerado', approved: 'Compra aprovada', refused: 'Cartão recusado', abandoned: 'Carrinho abandonado', ad_lead: 'Lead do anúncio', inbound_new: 'Novo contato', refunded: 'Reembolso'
}

// Variação percentual vs período anterior (▲/▼)
function Delta({ cur, prev, suffix = '' }: { cur: number; prev: number; suffix?: string }) {
  if (!prev && !cur) return <div className="d dim">sem dados anteriores</div>
  if (!prev) return <div className="d up">▲ novo{suffix}</div>
  const pct = ((cur - prev) / prev) * 100
  const up = pct >= 0
  return <div className={'d ' + (up ? 'up' : 'down')}>{up ? '▲' : '▼'} {Math.abs(pct).toFixed(1).replace('.', ',')}%{suffix}</div>
}
function DeltaPts({ cur, prev }: { cur: number; prev: number }) {
  const diff = cur - prev
  if (!cur && !prev) return <div className="d dim">sem dados anteriores</div>
  const up = diff >= 0
  return <div className={'d ' + (up ? 'up' : 'down')}>{up ? '▲' : '▼'} {Math.abs(diff).toFixed(1).replace('.', ',')} pts vs. anterior</div>
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload || {}
  return <div className="dash-tip">
    <b>{label}</b>
    <span>Pix gerados: <span className="mono">{fmtNum(row.pix_generated)}</span></span>
    <span>Contatados: <span className="mono">{fmtNum(row.contacted)}</span></span>
    <span className="up">Pagos após contato: <span className="mono">{fmtNum(row.recovered)}</span></span>
    <span className="muted">Recuperado: <span className="mono">{fmtMoney(row.recovered_amount)}</span></span>
  </div>
}

export default function Dashboard() {
  const { toast } = useToast()
  const nav = useNavigate()
  const [period, setPeriod] = useState<Period>('7')
  const [ov, setOv] = useState<any>(null)
  const [funnel, setFunnel] = useState<any>(null)
  const [daily, setDaily] = useState<any[]>([])
  const [autos, setAutos] = useState<any[]>([])
  const [numbers, setNumbers] = useState<any[]>([])
  const [recent, setRecent] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = async (days: Period) => {
    try {
      const [o, f, d, a, n, r] = await Promise.all([
        api.get(`/stats/overview?days=${days}`), api.get(`/stats/pix-funnel?days=${days}`), api.get(`/stats/daily?days=${days === '1' ? 7 : days}`),
        api.get(`/stats/automations?days=${days}`), api.get('/stats/numbers'), api.get('/stats/recent')
      ])
      setOv(o); setFunnel(f); setDaily(d || []); setAutos(a || []); setNumbers(n || []); setRecent(r || []); setUpdatedAt(new Date())
    } catch (e: any) { toast('Não foi possível carregar o dashboard: ' + e.message, true) }
    finally { setLoading(false) }
  }
  useEffect(() => { setLoading(true); load(period); const t = setInterval(() => load(period), 60000); return () => clearInterval(t) }, [period])

  const cur = ov?.current || {}, prev = ov?.previous || {}
  const respRate = cur.runs ? (cur.runs_replied / cur.runs) * 100 : 0
  const prevRespRate = prev.runs ? (prev.runs_replied / prev.runs) * 100 : 0
  const delay = ov?.pix_delay_minutes ?? 7
  const chartData = useMemo(() => daily.map(d => ({ ...d, day: fmtDate(d.day) })), [daily])
  const periodLabel = period === '1' ? 'hoje' : `últimos ${period} dias`

  const funnelRows = useMemo(() => {
    if (!funnel) return []
    const g = funnel.generated || 0
    const w = (v: number) => (g ? Math.max(0, Math.min(100, (v / g) * 100)) : 0)
    return [
      { label: 'Pix gerados', v: funnel.generated, w: 100, p: g ? '100%' : '—' },
      { label: `Pagos sozinhos (${delay} min)`, v: funnel.paid_alone, w: w(funnel.paid_alone), p: fmtPct(funnel.paid_alone, g), cls: 'soft' },
      { label: 'Elegíveis', v: funnel.eligible, w: w(funnel.eligible), p: fmtPct(funnel.eligible, g) },
      { label: 'Mensagem enviada', v: funnel.sent, w: w(funnel.sent), p: fmtPct(funnel.sent, funnel.eligible) },
      { label: 'Responderam', v: funnel.replied, w: w(funnel.replied), p: fmtPct(funnel.replied, funnel.sent) },
      { label: 'Pagaram', v: funnel.converted, w: w(funnel.converted), p: fmtPct(funnel.converted, funnel.sent), cls: 'mint' }
    ]
  }, [funnel, delay])

  if (loading && !ov) return <main className="main"><div className="top"><div><h1>Visão geral</h1></div></div><div className="empty"><Spinner /></div></main>

  return <main className="main">
    <div className="top">
      <div><h1>Visão geral</h1><div className="sub">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}{numbers.length ? ` · ${numbers.length} ${numbers.length === 1 ? 'número conectado' : 'números conectados'}` : ''}{updatedAt ? ` · atualizado ${fmtRel(updatedAt)}` : ''}</div></div>
      <div className="tools">
        <Segmented<Period> value={period} onChange={v => setPeriod(v)} options={PERIODS} />
        <button className="btn g icon" title="Atualizar" onClick={() => load(period)}>{loading ? <Spinner /> : <span>↻</span>}</button>
      </div>
    </div>

    <div className="kpis">
      <div className="kpi"><div className="k">Eventos recebidos <span>Kirvano</span></div><div className="v">{fmtNum(cur.events)}</div><Delta cur={cur.events || 0} prev={prev.events || 0} suffix=" vs. anterior" /></div>
      <div className="kpi"><div className="k">Mensagens enviadas</div><div className="v">{fmtNum(cur.sent)}</div>
        <div className="d"><span className="up">{fmtPct(cur.delivered, cur.sent)}</span> entregues · {fmtPct(cur.read, cur.sent)} lidas</div>
        <Delta cur={cur.sent || 0} prev={prev.sent || 0} suffix=" vs. anterior" /></div>
      <div className="kpi"><div className="k">Taxa de resposta</div><div className="v">{respRate.toFixed(1).replace('.', ',')}<small>%</small></div>
        <div className="d muted">{fmtNum(cur.runs_replied)} de {fmtNum(cur.runs)} contatos</div>
        <DeltaPts cur={respRate} prev={prevRespRate} /></div>
      <div className="kpi hi"><div className="k">Pix pagos após contato</div><div className="v">{fmtNum(cur.runs_converted)}</div>
        <div className="d"><span className="up">{fmtMoney(cur.recovered)}</span> recuperados</div>
        <Delta cur={cur.runs_converted || 0} prev={prev.runs_converted || 0} suffix=" vs. anterior" /></div>
      <div className="kpi"><div className="k">Recompras / Receita</div><div className="v">{fmtNum(cur.rebuys)}</div>
        <div className="d muted">{fmtMoney(cur.revenue)} em {fmtNum(cur.approved)} vendas</div>
        <div className="d dim">{fmtNum(cur.billable)} conversas cobradas</div></div>
    </div>

    <div className="dash-grid2">
      <div className="card">
        <div className="h"><div><h3>Recuperação de Pix por dia</h3><p>Pix gerados vs. pagos depois do contato · {period === '1' ? 'últimos 7 dias' : periodLabel}</p></div>
          {funnel?.converted > 0 && <Pill kind="win">{fmtPct(funnel.converted, funnel.sent)} de conversão</Pill>}</div>
        {chartData.length === 0 ? <Empty title="Sem dados ainda">Assim que os primeiros Pix chegarem pela Kirvano, o gráfico aparece aqui.</Empty> :
          <div className="dash-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs><linearGradient id="dashGreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--green)" stopOpacity={0.35} /><stop offset="1" stopColor="var(--green)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: 'var(--dim)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fill: 'var(--dim)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTip />} cursor={{ stroke: 'var(--line2)' }} />
                <Area type="monotone" dataKey="pix_generated" name="Pix gerados" stroke="#3a5e4a" strokeWidth={2} strokeDasharray="4 4" fill="none" dot={false} activeDot={{ r: 3, fill: '#3a5e4a' }} />
                <Area type="monotone" dataKey="recovered" name="Pagos após contato" stroke="var(--green)" strokeWidth={2.5} fill="url(#dashGreen)" dot={false} activeDot={{ r: 4, fill: 'var(--mint)', stroke: 'none' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>}
        <div className="dash-legend"><span><b style={{ background: '#3a5e4a' }} />Pix gerados</span><span><b style={{ background: 'var(--green)' }} />Pagos após mensagem</span></div>
      </div>

      <div className="card">
        <div className="h"><div><h3>Funil de conversão</h3><p>Pix gerado · {periodLabel}</p></div></div>
        {!funnel || !funnel.generated ? <Empty title="Nenhum Pix no período">O funil começa a contar quando a Kirvano enviar o primeiro evento de Pix gerado.</Empty> :
          <div className="funil">
            {funnelRows.map(r => <div className="frow" key={r.label}><span>{r.label}</span><div className="bar"><i className={r.cls || ''} style={{ width: r.w + '%' }} /></div><span className="n">{fmtNum(r.v)}</span><span className="p">{r.p}</span></div>)}
            <div className="row between" style={{ marginTop: 6, fontSize: 12 }}><span className="muted">Valor recuperado</span><span className="mono up" style={{ fontWeight: 700 }}>{fmtMoney(funnel.recovered_amount)}</span></div>
            {funnel.skipped > 0 && <div className="dim" style={{ fontSize: 12 }}>{fmtNum(funnel.skipped)} envios pulados por regra (horário, opt-out, cooldown…)</div>}
          </div>}
      </div>
    </div>

    <div className="dash-grid2 even">
      <div className="card">
        <div className="h"><div><h3>Automações ativas</h3><p>Conversão = pagou dentro da janela de atribuição</p></div><Link to="/automacoes" className="btn g sm">Ver todas</Link></div>
        {autos.length === 0 ? <Empty title="Nenhuma automação" action={<Link to="/automacoes" className="btn p sm">Criar automação</Link>}>Conecte um gatilho da Kirvano a um funil para começar a recuperar Pix.</Empty> :
          <table>
            <thead><tr><th>Gatilho</th><th>Nome</th><th className="r">Enviadas</th><th className="r">Conv.</th><th>Status</th></tr></thead>
            <tbody>{autos.slice(0, 8).map(a => <tr key={a.id} className="click" onClick={() => nav('/automacoes')}>
              <td>{TRIGGER_LABEL[a.trigger] || a.trigger}</td>
              <td>{a.name}{a.auto_optimize && <span className="tag" style={{ marginLeft: 6 }}>A/B</span>}</td>
              <td className="m r">{fmtNum(a.sent)}</td>
              <td className="m r">{fmtPct(a.converted, a.sent)}</td>
              <td><Pill kind={a.active ? 'ok' : 'warn'}>{a.active ? 'Ativa' : 'Pausada'}</Pill></td>
            </tr>)}</tbody>
          </table>}
      </div>

      <div className="card">
        <div className="h"><div><h3>Saúde dos números</h3><p>Direto da Meta · limite diário por tier</p></div><Link to="/numeros" className="btn g sm">Gerenciar</Link></div>
        {numbers.length === 0 ? <Empty title="Nenhum número conectado" action={<Link to="/numeros" className="btn p sm">Conectar número</Link>}>Conecte um número da WhatsApp Cloud API para começar a enviar.</Empty> :
          <table>
            <thead><tr><th>Número</th><th>Qualidade</th><th>Uso hoje</th><th className="r">Limite</th></tr></thead>
            <tbody>{numbers.map(n => {
              const q = QUALITY[n.quality_rating] || QUALITY.UNKNOWN
              const limit = n.daily_cap || TIER[n.messaging_limit] || 0
              const pct = limit ? Math.min(100, (n.template_sent_today / limit) * 100) : 0
              return <tr key={n.id}>
                <td><div>{n.label}</div><div className="dim mono" style={{ fontSize: 11 }}>{fmtPhone(n.display_phone)}</div></td>
                <td>{n.status !== 'active' ? <Pill kind="crit" >{n.status === 'paused' ? 'Pausado' : 'Erro'}</Pill> : <Pill kind={q.kind}>{q.label}</Pill>}</td>
                <td><div className="row"><div className={'meter' + (pct > 90 ? ' c' : pct > 70 ? ' w' : '')}><i style={{ width: pct + '%' }} /></div><span className="mono" style={{ fontSize: 11 }}>{fmtNum(n.template_sent_today)}</span></div></td>
                <td className="m r">{limit ? fmtNum(limit) : '∞'}</td>
              </tr>
            })}</tbody>
          </table>}
        {numbers.some(n => n.last_error) && <p className="muted" style={{ margin: '12px 0 0', fontSize: 12 }}>{numbers.filter(n => n.last_error).map(n => `${n.label}: ${n.last_error}`).join(' · ')}</p>}
      </div>
    </div>

    <div className="card">
      <div className="h"><div><h3>Atividade recente</h3><p>Últimos eventos recebidos da Kirvano e da Meta</p></div></div>
      {recent.length === 0 ? <Empty title="Nada por aqui ainda">Os eventos aparecem assim que os webhooks estiverem configurados.</Empty> :
        <div className="act-list">{recent.map(e => <div className="act-row" key={e.id}>
          <Pill kind={e.type === 'approved' ? 'ok' : e.type === 'refused' || e.type === 'quality_change' ? 'crit' : e.type === 'pix_generated' || e.type === 'abandoned' ? 'warn' : 'info'}>{EVENT_LABEL[e.type] || e.type}</Pill>
          <span className="who">{e.name || (e.phone ? fmtPhone(e.phone) : 'Contato desconhecido')}{e.product_name && <small>{e.product_name}</small>}</span>
          <span className="mono">{e.amount ? fmtMoney(e.amount) : ''}</span>
          <span className="t">{fmtRel(e.created_at)}</span>
        </div>)}</div>}
    </div>
  </main>
}
