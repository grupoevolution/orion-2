// Campanhas: lista de contatos + template (ou funil) + limite diário distribuído entre números
import { all, one, q } from '../db/index.js'
import * as meta from '../meta/client.js'
import { send, templateComponents, templatePreview, ensureMetaMedia } from './messaging.js'
import { buildContext, render, hourIn } from './vars.js'
import { pickNumber } from './numbers.js'
import { createRun } from './funnel-engine.js'
import { enqueueIn, JOBS } from './queue.js'
import { getSetting } from '../db/index.js'

function insideWindow(w) {
  if (!w?.start || !w?.end) return true
  const h = hourIn(w.tz || 'America/Sao_Paulo')
  const s = Number(w.start.split(':')[0]), e = Number(w.end.split(':')[0])
  return s < e ? (h >= s && h < e) : (h >= s || h < e)
}

export async function sentToday(campaignId) {
  const r = await one(`SELECT count(*)::int c FROM campaign_contacts WHERE campaign_id=$1 AND sent_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`, [campaignId])
  return r.c
}

export async function start(campaignId) {
  await q(`UPDATE campaigns SET status='running', starts_at=COALESCE(starts_at, now()), updated_at=now() WHERE id=$1`, [campaignId])
  await enqueueIn(JOBS.CAMPAIGN_TICK, { campaignId }, 1, { singletonKey: `campaign-${campaignId}`, singletonSeconds: 30 })
}

// Envia um lote (per_minute) e se reagenda. Uma execução por minuto por campanha.
export async function tick(campaignId) {
  const c = await one('SELECT * FROM campaigns WHERE id=$1', [campaignId])
  if (!c || c.status !== 'running') return
  const pending = await one('SELECT count(*)::int c FROM campaign_contacts WHERE campaign_id=$1 AND status=$2', [campaignId, 'pending'])
  if (!pending.c) { await q(`UPDATE campaigns SET status='done', updated_at=now() WHERE id=$1`, [campaignId]); return }
  if (!insideWindow(c.send_window)) return enqueueIn(JOBS.CAMPAIGN_TICK, { campaignId }, 600, { singletonKey: `campaign-${campaignId}`, singletonSeconds: 30 })
  const today = await sentToday(campaignId)
  if (today >= (c.daily_limit || 100)) return enqueueIn(JOBS.CAMPAIGN_TICK, { campaignId }, 1800, { singletonKey: `campaign-${campaignId}`, singletonSeconds: 30 })

  const batch = Math.min(c.per_minute || 10, (c.daily_limit || 100) - today)
  const rows = await all(`SELECT cc.*, ct.* , cc.id AS cc_id FROM campaign_contacts cc JOIN contacts ct ON ct.id=cc.contact_id
                          WHERE cc.campaign_id=$1 AND cc.status='pending' ORDER BY cc.id LIMIT $2`, [campaignId, batch])
  const tpl = c.template_id ? await one('SELECT * FROM templates WHERE id=$1', [c.template_id]) : null
  const settings = { greeting: await getSetting('greeting') }
  const allowed = (c.number_ids || []).length ? c.number_ids : null

  for (const r of rows) {
    const contact = { ...r, id: r.contact_id }
    if (contact.opted_out || contact.blocked) { await q(`UPDATE campaign_contacts SET status='skipped', error='opt-out' WHERE id=$1`, [r.cc_id]); continue }
    const number = await pickNumber(contact, { allowed })
    if (!number) { await q(`UPDATE campaigns SET status='paused', updated_at=now(), stats = COALESCE(stats,'{}') || '{"paused_reason":"nenhum número disponível"}' WHERE id=$1`, [campaignId]); return }
    try {
      if (c.kind === 'funnel' && c.funnel_id) {
        const run = await createRun({ funnelId: c.funnel_id, contactId: contact.id, numberId: number.id, campaignId, trigger: 'campaign' })
        await q(`UPDATE campaign_contacts SET status='sent', number_id=$2, run_id=$3, sent_at=now() WHERE id=$1`, [r.cc_id, number.id, run.id])
      } else if (tpl) {
        const sale = await one('SELECT * FROM sales WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 1', [contact.id])
        const ctx = buildContext({ contact, sale, settings })
        const values = {}
        for (const [k, v] of Object.entries(c.template_params || {})) values[k] = render(v, ctx)
        let headerMediaId = null
        if (c.template_params?.header_media_id) { const m = await one('SELECT * FROM media WHERE id=$1', [c.template_params.header_media_id]); if (m) headerMediaId = await ensureMetaMedia(number, m) }
        const msg = await send({ number, contact, type: 'template', body: templatePreview(tpl, values), templateName: tpl.name, campaignId, payload: meta.build.template(tpl.name, tpl.language, templateComponents(tpl, values, { headerMediaId })) })
        await q(`UPDATE campaign_contacts SET status='sent', number_id=$2, message_id=$3, sent_at=now() WHERE id=$1`, [r.cc_id, number.id, msg.id])
      } else throw new Error('campanha sem template/funil')
    } catch (e) {
      await q(`UPDATE campaign_contacts SET status='failed', error=$2, sent_at=now() WHERE id=$1`, [r.cc_id, e.message])
      if (e.code === 130429 || e.code === 131056) break   // rate limit: espera o próximo minuto
    }
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500))   // cadência humana
  }
  await refreshStats(campaignId)
  await enqueueIn(JOBS.CAMPAIGN_TICK, { campaignId }, 60, { singletonKey: `campaign-${campaignId}`, singletonSeconds: 30 })
}

export async function refreshStats(campaignId) {
  const rows = await all(`SELECT status, count(*)::int c FROM campaign_contacts WHERE campaign_id=$1 GROUP BY status`, [campaignId])
  const stats = { total: 0 }
  for (const r of rows) { stats[r.status] = r.c; stats.total += r.c }
  await q(`UPDATE campaigns SET stats = COALESCE(stats,'{}') || $2::jsonb, updated_at=now() WHERE id=$1`, [campaignId, JSON.stringify(stats)])
  return stats
}
