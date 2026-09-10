// Automações: evento -> regras -> escolhe variante (A/B) -> cria run
import { all, one, q, getSetting } from '../db/index.js'
import { createRun, cancelRunsForContact } from './funnel-engine.js'
import { enqueueIn, JOBS } from './queue.js'
import { hourIn } from './vars.js'

export const TRIGGERS = [
  { key: 'pix_generated', label: 'Pix gerado', desc: 'Cliente gerou um Pix e ainda não pagou' },
  { key: 'approved', label: 'Compra aprovada', desc: 'Pagamento confirmado' },
  { key: 'refused', label: 'Cartão recusado', desc: 'Tentativa de cartão negada' },
  { key: 'abandoned', label: 'Carrinho abandonado', desc: 'Iniciou checkout e não gerou pagamento' },
  { key: 'ad_lead', label: 'Lead do anúncio', desc: 'Primeira mensagem vinda de um anúncio click-to-WhatsApp' },
  { key: 'inbound_new', label: 'Novo contato', desc: 'Primeira mensagem de um número desconhecido' },
  { key: 'tag_added', label: 'Tag adicionada', desc: 'Contato recebeu uma tag específica' }
]

// Chamado pelos webhooks. eventType: um dos TRIGGERS. sale pode ser null.
export async function dispatch(eventType, { contact, sale = null, extra = {} }) {
  if (!contact) return []
  const autos = await all(`SELECT * FROM automations WHERE active=true AND trigger=$1 ORDER BY priority DESC, id`, [eventType])
  const fired = []
  for (const a of autos) {
    const why = await eligibility(a, contact, sale, extra)
    if (why) { await logSkip(a, contact, sale, why); continue }
    let delay = Number(a.delay_seconds || 0)
    if (eventType === 'pix_generated' && a.delay_seconds == null) delay = Number(await getSetting('pix_delay_minutes', 7)) * 60
    const job = await enqueueIn(JOBS.AUTOMATION_FIRE, { automationId: a.id, contactId: contact.id, saleId: sale?.id || null, eventType, extra }, delay)
    fired.push({ automation: a.id, delay, job })
    await q(`UPDATE automations SET stats = jsonb_set(COALESCE(stats,'{}'), '{scheduled}', (COALESCE((stats->>'scheduled')::int,0)+1)::text::jsonb) WHERE id=$1`, [a.id])
    if (a.only_first_event) break   // a automação de maior prioridade vence
  }
  return fired
}

async function eligibility(a, contact, sale, extra) {
  if (contact.opted_out) return 'opt-out'
  if (contact.blocked) return 'bloqueado'
  if (sale) {
    if (a.min_amount != null && Number(sale.amount) < Number(a.min_amount)) return `valor abaixo de ${a.min_amount}`
    if (a.max_amount != null && Number(sale.amount) > Number(a.max_amount)) return `valor acima de ${a.max_amount}`
    const pf = a.product_filter || []
    if (pf.length) {
      const hit = pf.some(p => [sale.offer_id, sale.offer_name, sale.product_name].filter(Boolean).some(v => String(v).toLowerCase().includes(String(p).toLowerCase())))
      if (!hit) return 'produto fora do filtro'
    }
  }
  if (extra?.tag && a.trigger === 'tag_added' && (a.product_filter || []).length && !(a.product_filter || []).includes(extra.tag)) return 'tag diferente'
  if (a.cooldown_hours > 0) {
    const recent = await one(`SELECT id FROM funnel_runs WHERE contact_id=$1 AND automation_id=$2 AND created_at > now() - ($3 || ' hours')::interval LIMIT 1`, [contact.id, a.id, String(a.cooldown_hours)])
    if (recent) return `contato já recebeu esta automação nas últimas ${a.cooldown_hours}h`
  }
  if (!(a.variants || []).some(v => v.funnel_id)) return 'automação sem funil'
  return null
}

async function logSkip(a, contact, sale, why) {
  await q('INSERT INTO events (source,type,contact_id,sale_id,payload) VALUES ($1,$2,$3,$4,$5)', ['system', 'automation_skipped', contact.id, sale?.id || null, JSON.stringify({ automation_id: a.id, name: a.name, reason: why })])
}

// Executado pelo worker após o delay
export async function fire({ automationId, contactId, saleId, eventType, extra }) {
  const a = await one('SELECT * FROM automations WHERE id=$1', [automationId])
  const contact = await one('SELECT * FROM contacts WHERE id=$1', [contactId])
  if (!a || !a.active || !contact) return
  const sale = saleId ? await one('SELECT * FROM sales WHERE id=$1', [saleId]) : null
  if (sale && a.skip_if_paid && sale.status !== 'pending' && eventType === 'pix_generated') return logSkip(a, contact, sale, `pix já está ${sale.status}`)
  if (eventType === 'pix_generated') {
    // se o cliente gerou outro pix mais novo, deixa o mais novo disparar
    const newer = await one('SELECT id FROM sales WHERE contact_id=$1 AND status=$2 AND id>$3 LIMIT 1', [contact.id, 'pending', sale?.id || 0])
    if (newer) return logSkip(a, contact, sale, 'existe um pix mais recente')
  }
  if (contact.opted_out) return
  // janela de envio
  const w = a.send_window || {}
  if (w.start && w.end) {
    const h = hourIn(w.tz || 'America/Sao_Paulo')
    const s = Number(w.start.split(':')[0]), e = Number(w.end.split(':')[0])
    const inside = s < e ? (h >= s && h < e) : (h >= s || h < e)
    if (!inside) {
      if (a.outside_window === 'skip') return logSkip(a, contact, sale, 'fora da janela de envio')
      const wait = ((s - h + 24) % 24) * 3600 + 60
      return enqueueIn(JOBS.AUTOMATION_FIRE, { automationId, contactId, saleId, eventType, extra }, wait)
    }
  }
  const variant = chooseVariant(a)
  if (!variant) return
  // cancela runs anteriores do mesmo gatilho ainda vivas (ex.: pix antigo)
  await cancelRunsForContact(contact.id, { onlyTrigger: eventType, reason: 'substituída por evento mais novo' })
  const run = await createRun({ funnelId: variant.funnel_id, contactId: contact.id, automationId: a.id, saleId: sale?.id || null, trigger: eventType, variables: extra?.variables || {} })
  await q(`UPDATE automations SET stats = jsonb_set(COALESCE(stats,'{}'), '{fired}', (COALESCE((stats->>'fired')::int,0)+1)::text::jsonb) WHERE id=$1`, [a.id])
  return run
}

// Escolha ponderada. Com auto_optimize, os pesos vêm da conversão observada (com 10% de exploração).
export function chooseVariant(a) {
  const vs = (a.variants || []).filter(v => v.funnel_id)
  if (!vs.length) return null
  let weights = vs.map(v => Math.max(0, Number(v.weight ?? 1)))
  if (a.auto_optimize && a.stats?.variants) {
    const conv = vs.map(v => { const s = a.stats.variants[v.funnel_id] || {}; return s.sent >= 30 ? (s.converted || 0) / s.sent : null })
    if (conv.some(c => c != null)) {
      const base = conv.map(c => c ?? 0.1)
      const total = base.reduce((x, y) => x + y, 0) || 1
      weights = base.map(c => 0.1 / vs.length + 0.9 * (c / total))
    }
  }
  const sum = weights.reduce((x, y) => x + y, 0)
  if (!sum) return vs[0]
  let r = Math.random() * sum
  for (let i = 0; i < vs.length; i++) { r -= weights[i]; if (r <= 0) return vs[i] }
  return vs[vs.length - 1]
}

// Recalcula estatísticas por variante (rodado no rollup diário e ao abrir a automação)
export async function refreshStats(automationId) {
  const rows = await all(`
    SELECT funnel_id, count(*) FILTER (WHERE status<>'scheduled')::int AS sent,
           count(*) FILTER (WHERE replied)::int AS replied,
           count(*) FILTER (WHERE converted)::int AS converted
    FROM funnel_runs WHERE automation_id=$1 GROUP BY funnel_id`, [automationId])
  const variants = {}
  for (const r of rows) variants[r.funnel_id] = { sent: r.sent, replied: r.replied, converted: r.converted, rate: r.sent ? +(r.converted / r.sent * 100).toFixed(1) : 0 }
  await q(`UPDATE automations SET stats = COALESCE(stats,'{}') || $2::jsonb WHERE id=$1`, [automationId, JSON.stringify({ variants, refreshed_at: new Date().toISOString() })])
  return variants
}

// Atribuição: venda aprovada -> crédito para o run mais recente dentro da janela
export async function attributeConversion(sale, contact) {
  const hours = Number(await getSetting('attribution_hours', 24))
  const run = await one(`
    SELECT r.*, a.attribution_hours FROM funnel_runs r LEFT JOIN automations a ON a.id=r.automation_id
    WHERE r.contact_id=$1 AND r.started_at IS NOT NULL AND r.started_at > now() - ($2 || ' hours')::interval
      AND r.status <> 'cancelled' AND r.converted=false
    ORDER BY r.started_at DESC LIMIT 1`, [contact.id, String(Math.max(hours, 72))])
  if (!run) return null
  const limit = Number(run.attribution_hours || hours)
  if ((Date.now() - new Date(run.started_at)) > limit * 3600e3) return null
  await q(`UPDATE funnel_runs SET converted=true, converted_sale_id=$2, converted_at=now() WHERE id=$1`, [run.id, sale.id])
  await q(`UPDATE sales SET attributed_run_id=$2, attributed_campaign_id=$3 WHERE id=$1`, [sale.id, run.id, run.campaign_id])
  if (run.campaign_id) await q(`UPDATE campaign_contacts SET status='converted' WHERE campaign_id=$1 AND contact_id=$2`, [run.campaign_id, contact.id])
  return run
}
