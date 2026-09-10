// Engine de execução de funis.
// Um funil é um grafo: nodes [{id,type,data}], edges [{id,source,target,sourceHandle}]
// Tipos de nó:
//   trigger      — ponto de entrada (data: regras exibidas; a lógica mora na automação)
//   template     — data: {template_id, values:{"1":"{{primeiro_nome}}"}, header_media_id}
//   text         — data: {text}
//   buttons      — data: {body, header, footer, buttons:[{id,title}]}  saídas: handle = button id, + 'default'
//   list         — data: {body, header, footer, buttonText, sections:[{title, rows:[{id,title,description}]}]} saídas: row id, + 'default'
//   image|video|audio|document — data: {media_id, caption, link}
//   delay        — data: {seconds}
//   wait_reply   — data: {timeout_seconds, save_as}  saídas: 'reply' | 'timeout'
//   condition    — data: {variable, op, value}  saídas: 'yes' | 'no'
//   set_var      — data: {key, value}
//   tag          — data: {tag, remove}
//   goto_funnel  — data: {funnel_id}
//   end          — data: {outcome}
import { all, one, q, getSetting } from '../db/index.js'
import * as meta from '../meta/client.js'
import { send, ensureMetaMedia, templateComponents, templatePreview, windowOpen } from './messaging.js'
import { buildContext, render, hourIn } from './vars.js'
import { addTag, removeTag, setVariable, getContact } from './contacts.js'
import { getNumber, pickNumber } from './numbers.js'
import { enqueue, enqueueIn, JOBS } from './queue.js'

const MEDIA_TYPES = ['image', 'video', 'audio', 'document']

export async function createRun({ funnelId, contactId, numberId = null, automationId = null, campaignId = null, saleId = null, trigger = null, variables = {}, startAfterSeconds = 0 }) {
  const f = await one('SELECT id, version FROM funnels WHERE id=$1', [funnelId])
  if (!f) throw new Error('funil não encontrado')
  const run = await one(`
    INSERT INTO funnel_runs (funnel_id, funnel_version, contact_id, number_id, automation_id, campaign_id, sale_id, trigger, variables, status, scheduled_for)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled', now() + ($10 || ' seconds')::interval) RETURNING *`,
    [funnelId, f.version, contactId, numberId, automationId, campaignId, saleId, trigger, JSON.stringify(variables), String(startAfterSeconds)])
  await enqueueIn(JOBS.FUNNEL_STEP, { runId: run.id }, startAfterSeconds)
  return run
}

export async function cancelRun(runId, reason = 'cancelled') {
  await q(`UPDATE funnel_runs SET status='cancelled', last_error=$2, ended_at=now() WHERE id=$1 AND status NOT IN ('done','cancelled','failed')`, [runId, reason])
}

export async function cancelRunsForContact(contactId, { onlyTrigger = null, reason = 'cancelled' } = {}) {
  await q(`UPDATE funnel_runs SET status='cancelled', last_error=$2, ended_at=now()
           WHERE contact_id=$1 AND status NOT IN ('done','cancelled','failed') ${onlyTrigger ? 'AND trigger=$3' : ''}`,
    onlyTrigger ? [contactId, reason, onlyTrigger] : [contactId, reason])
}

function nextNode(funnel, nodeId, handle = null) {
  const edges = funnel.edges.filter(e => e.source === nodeId)
  if (!edges.length) return null
  let e = handle ? edges.find(x => (x.sourceHandle || 'default') === handle) : null
  if (!e) e = edges.find(x => !x.sourceHandle || x.sourceHandle === 'default') || (handle ? null : edges[0])
  return e ? funnel.nodes.find(n => n.id === e.target) || null : null
}

async function loadRun(runId) {
  const run = await one('SELECT * FROM funnel_runs WHERE id=$1', [runId])
  if (!run) return {}
  const funnel = await one('SELECT * FROM funnels WHERE id=$1', [run.funnel_id])
  const contact = await getContact(run.contact_id)
  const sale = run.sale_id ? await one('SELECT * FROM sales WHERE id=$1', [run.sale_id]) : null
  return { run, funnel, contact, sale }
}

async function finish(run, status, extra = {}) {
  await q(`UPDATE funnel_runs SET status=$2, ended_at=now(), last_error=$3 WHERE id=$1`, [run.id, status, extra.error || null])
}

async function inQuietHours() {
  const qh = await getSetting('quiet_hours')
  if (!qh?.start || !qh?.end) return { quiet: false }
  const h = hourIn(qh.tz || 'America/Sao_Paulo')
  const s = Number(qh.start.split(':')[0]), e = Number(qh.end.split(':')[0])
  const quiet = s > e ? (h >= s || h < e) : (h >= s && h < e)
  if (!quiet) return { quiet: false }
  const until = ((e - h + 24) % 24) * 3600
  return { quiet: true, seconds: until || 3600 }
}

// Executa nós a partir do atual até precisar esperar (delay / resposta) ou terminar
export async function step(runId) {
  const { run, funnel, contact, sale } = await loadRun(runId)
  if (!run || !funnel || !contact) return
  if (['done', 'cancelled', 'failed'].includes(run.status)) return
  if (contact.opted_out || contact.blocked) return finish(run, 'cancelled', { error: 'contato optou por sair' })

  // trava respeitando o horário de silêncio para envios de funil
  const qh = await inQuietHours()
  if (qh.quiet) {
    await q(`UPDATE funnel_runs SET status='waiting_delay' WHERE id=$1`, [run.id])
    return enqueueIn(JOBS.FUNNEL_STEP, { runId }, qh.seconds)
  }

  let number = run.number_id ? await getNumber(run.number_id) : null
  if (!number || number.status !== 'active') {
    number = await pickNumber(contact)
    if (!number) return finish(run, 'failed', { error: 'nenhum número disponível' })
    await q('UPDATE funnel_runs SET number_id=$2 WHERE id=$1', [run.id, number.id])
  }

  let node = run.current_node ? funnel.nodes.find(n => n.id === run.current_node) : null
  if (!node) {
    node = funnel.nodes.find(n => n.type === 'trigger') || funnel.nodes[0]
    if (!node) return finish(run, 'failed', { error: 'funil vazio' })
    await q(`UPDATE funnel_runs SET status='running', started_at=COALESCE(started_at, now()), current_node=$2 WHERE id=$1`, [run.id, node.id])
    node = nextNode(funnel, node.id)   // pula o trigger
  }

  const settings = { greeting: await getSetting('greeting') }
  let guard = 0
  while (node && guard++ < 50) {
    const fresh = await one('SELECT variables, status FROM funnel_runs WHERE id=$1', [run.id])
    if (['cancelled', 'done', 'failed'].includes(fresh.status)) return
    run.variables = fresh.variables || {}
    const ctx = buildContext({ contact, sale, run, settings })
    await q('UPDATE funnel_runs SET current_node=$2, status=$3 WHERE id=$1', [run.id, node.id, 'running'])
    const d = node.data || {}
    try {
      switch (node.type) {
        case 'template': {
          const t = await one('SELECT * FROM templates WHERE id=$1', [d.template_id])
          if (!t) throw new Error('template não encontrado')
          if (t.status !== 'APPROVED') throw new Error(`template ${t.name} não está aprovado (${t.status})`)
          const values = {}
          for (const [k, v] of Object.entries(d.values || {})) values[k] = render(v, ctx)
          let headerMediaId = null
          if (d.header_media_id) { const m = await one('SELECT * FROM media WHERE id=$1', [d.header_media_id]); if (m) headerMediaId = await ensureMetaMedia(number, m) }
          const comps = templateComponents(t, values, { headerMediaId })
          await send({ number, contact, type: 'template', body: templatePreview(t, values), templateName: t.name, runId: run.id, payload: meta.build.template(t.name, t.language, comps) })
          break
        }
        case 'text': {
          await requireWindow(contact)
          await send({ number, contact, type: 'text', body: render(d.text, ctx), runId: run.id, payload: meta.build.text(render(d.text, ctx), !!d.preview_url) })
          break
        }
        case 'buttons': {
          await requireWindow(contact)
          const body = render(d.body, ctx)
          const buttons = (d.buttons || []).map(b => ({ id: b.id, title: render(b.title, ctx) }))
          await send({ number, contact, type: 'interactive', body, runId: run.id, payload: meta.build.buttons({ body, header: d.header ? render(d.header, ctx) : null, footer: d.footer ? render(d.footer, ctx) : null, buttons }) })
          // botões esperam a resposta do cliente
          return waitReply(run, node, d.timeout_seconds || 86400, 'resposta')
        }
        case 'list': {
          await requireWindow(contact)
          const body = render(d.body, ctx)
          await send({ number, contact, type: 'interactive', body, runId: run.id, payload: meta.build.list({ body, header: d.header, footer: d.footer, buttonText: d.buttonText, sections: d.sections || [] }) })
          return waitReply(run, node, d.timeout_seconds || 86400, 'resposta')
        }
        case 'image': case 'video': case 'audio': case 'document': {
          await requireWindow(contact)
          let ref
          if (d.media_id) { const m = await one('SELECT * FROM media WHERE id=$1', [d.media_id]); if (!m) throw new Error('mídia não encontrada'); ref = { id: await ensureMetaMedia(number, m) } }
          else if (d.link) ref = { link: d.link }
          else throw new Error('mídia sem arquivo')
          const caption = d.caption ? render(d.caption, ctx) : undefined
          await send({ number, contact, type: node.type, body: caption || null, mediaId: d.media_id || null, runId: run.id, payload: meta.build[node.type]({ ...ref, caption, filename: d.filename }) })
          break
        }
        case 'delay': {
          const secs = Math.max(1, Number(d.seconds || 60))
          const nxt = nextNode(funnel, node.id)
          if (!nxt) return finish(run, 'done')
          await q(`UPDATE funnel_runs SET status='waiting_delay', current_node=$2 WHERE id=$1`, [run.id, nxt.id])
          return enqueueIn(JOBS.FUNNEL_STEP, { runId: run.id }, secs)
        }
        case 'wait_reply': return waitReply(run, node, d.timeout_seconds || 7200, d.save_as || 'resposta')
        case 'condition': {
          const left = String(ctx[d.variable] ?? '').toLowerCase().trim()
          const right = String(render(d.value ?? '', ctx)).toLowerCase().trim()
          const yes = evalCond(left, d.op, right, ctx, d)
          node = nextNode(funnel, node.id, yes ? 'yes' : 'no'); continue
        }
        case 'set_var': {
          const val = render(d.value, ctx)
          await q(`UPDATE funnel_runs SET variables = variables || $2::jsonb WHERE id=$1`, [run.id, JSON.stringify({ [d.key]: val })])
          if (d.persist !== false) await setVariable(contact.id, d.key, val)
          break
        }
        case 'tag': { d.remove ? await removeTag(contact.id, d.tag) : await addTag(contact.id, d.tag); break }
        case 'goto_funnel': {
          await finish(run, 'done')
          if (d.funnel_id) await createRun({ funnelId: d.funnel_id, contactId: contact.id, numberId: number.id, automationId: run.automation_id, saleId: run.sale_id, trigger: run.trigger, variables: run.variables })
          return
        }
        case 'end': return finish(run, 'done')
        case 'trigger': break
        default: throw new Error(`nó desconhecido: ${node.type}`)
      }
    } catch (e) {
      console.error(`[funnel] run ${run.id} nó ${node.id}:`, e.message)
      return finish(run, 'failed', { error: e.message })
    }
    node = nextNode(funnel, node.id)
  }
  return finish(run, 'done')
}

async function requireWindow(contact) {
  const fresh = await getContact(contact.id)
  if (!windowOpen(fresh)) throw new Error('janela de 24h fechada: use um template para este envio')
}

async function waitReply(run, node, timeoutSeconds, saveAs) {
  await q(`UPDATE funnel_runs SET status='waiting_reply', current_node=$2, variables = variables || $3::jsonb WHERE id=$1`,
    [run.id, node.id, JSON.stringify({ __wait_save_as: saveAs, __wait_node: node.id })])
  await enqueueIn(JOBS.RUN_TIMEOUT, { runId: run.id, nodeId: node.id }, timeoutSeconds)
}

function evalCond(left, op, right, ctx, d) {
  switch (op) {
    case 'eq': return left === right
    case 'neq': return left !== right
    case 'contains': return left.includes(right)
    case 'not_contains': return !left.includes(right)
    case 'starts': return left.startsWith(right)
    case 'gt': return Number(left) > Number(right)
    case 'lt': return Number(left) < Number(right)
    case 'exists': return left !== ''
    case 'empty': return left === ''
    case 'has_tag': return (ctx.tags || []).includes(right)
    case 'regex': try { return new RegExp(d.value, 'i').test(left) } catch { return false }
    default: return false
  }
}

// Chamado quando chega mensagem do cliente: retoma runs aguardando resposta
export async function onInboundReply(contact, message) {
  const runs = await all(`SELECT * FROM funnel_runs WHERE contact_id=$1 AND status='waiting_reply' ORDER BY id DESC`, [contact.id])
  await q(`UPDATE funnel_runs SET replied=true WHERE contact_id=$1 AND status IN ('running','waiting_reply','waiting_delay','done') AND started_at > now() - interval '3 days'`, [contact.id])
  for (const run of runs) {
    const funnel = await one('SELECT * FROM funnels WHERE id=$1', [run.funnel_id])
    const node = funnel?.nodes.find(n => n.id === run.variables?.__wait_node)
    if (!funnel || !node) { await finish(run, 'done'); continue }
    const saveAs = run.variables?.__wait_save_as || 'resposta'
    const text = message.body || ''
    const selectedId = message.payload?.interactive?.button_reply?.id || message.payload?.interactive?.list_reply?.id || message.payload?.button?.payload || null
    await q(`UPDATE funnel_runs SET variables = variables || $2::jsonb WHERE id=$1`, [run.id, JSON.stringify({ [saveAs]: text, resposta: text, resposta_id: selectedId })])
    await setVariable(contact.id, saveAs, text)
    let handle = 'reply'
    if (node.type === 'buttons' || node.type === 'list') {
      const opts = node.type === 'buttons' ? (node.data.buttons || []) : (node.data.sections || []).flatMap(s => s.rows || [])
      const hit = opts.find(o => o.id === selectedId) || opts.find(o => String(o.title || '').toLowerCase().trim() === text.toLowerCase().trim())
      handle = hit ? hit.id : 'default'
    }
    const nxt = nextNode(funnel, node.id, handle) || (handle !== 'default' ? nextNode(funnel, node.id, 'default') : null)
    if (!nxt) { await finish(run, 'done'); continue }
    await q(`UPDATE funnel_runs SET status='running', current_node=$2 WHERE id=$1`, [run.id, nxt.id])
    await enqueue(JOBS.FUNNEL_STEP, { runId: run.id })
  }
}

export async function onTimeout(runId, nodeId) {
  const run = await one('SELECT * FROM funnel_runs WHERE id=$1', [runId])
  if (!run || run.status !== 'waiting_reply' || run.current_node !== nodeId) return
  const funnel = await one('SELECT * FROM funnels WHERE id=$1', [run.funnel_id])
  const nxt = nextNode(funnel, nodeId, 'timeout')
  if (!nxt) return finish(run, 'done')
  await q(`UPDATE funnel_runs SET status='running', current_node=$2 WHERE id=$1`, [run.id, nxt.id])
  await enqueue(JOBS.FUNNEL_STEP, { runId })
}

// Valida um funil antes de publicar
export function validateFunnel(funnel) {
  const errors = []
  const nodes = funnel.nodes || [], edges = funnel.edges || []
  const trig = nodes.filter(n => n.type === 'trigger')
  if (trig.length !== 1) errors.push('O funil precisa de exatamente um bloco de gatilho.')
  if (trig.length === 1) {
    const first = nextNodeStatic(nodes, edges, trig[0].id)
    if (!first) errors.push('Conecte o gatilho ao primeiro bloco.')
    else if (!['template', 'condition', 'set_var', 'tag', 'delay'].includes(first.type) && funnel.requires_template !== false)
      errors.push('Fora da janela de 24h a Meta só aceita template: o primeiro envio precisa ser um bloco "Template aprovado".')
  }
  for (const n of nodes) {
    const d = n.data || {}
    if (n.type === 'template' && !d.template_id) errors.push(`Bloco "${d.label || 'Template'}" sem template selecionado.`)
    if (n.type === 'text' && !d.text) errors.push('Bloco de texto vazio.')
    if (MEDIA_TYPES.includes(n.type) && !d.media_id && !d.link) errors.push(`Bloco de ${n.type} sem arquivo.`)
    if (n.type === 'buttons' && !(d.buttons || []).length) errors.push('Bloco de botões sem opções.')
    if (n.type === 'goto_funnel' && !d.funnel_id) errors.push('Bloco "Ir para funil" sem destino.')
    if (n.type !== 'trigger' && !edges.some(e => e.target === n.id)) errors.push(`Bloco "${d.label || n.type}" não está conectado a nada.`)
  }
  return errors
}
function nextNodeStatic(nodes, edges, id) { const e = edges.find(x => x.source === id); return e ? nodes.find(n => n.id === e.target) : null }
