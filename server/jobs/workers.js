// Workers da fila
import path from 'node:path'
import { boss, JOBS } from '../lib/queue.js'
import { q, all, one } from '../db/index.js'
import * as engine from '../lib/funnel-engine.js'
import * as automations from '../lib/automations.js'
import * as campaigns from '../lib/campaigns.js'
import { getNumber, syncNumber } from '../lib/numbers.js'
import * as meta from '../meta/client.js'
import { syncTemplates } from '../lib/templates.js'
import { bus } from '../lib/bus.js'

const UPLOAD_DIR = () => process.env.UPLOAD_DIR || './uploads'

export async function startWorkers() {
  const work = (name, fn, opts = {}) => boss.work(name, { batchSize: 1, pollingIntervalSeconds: 1, ...opts }, async jobs => { for (const j of jobs) await fn(j.data, j) })

  await work(JOBS.AUTOMATION_FIRE, async d => { const run = await automations.fire(d); if (run) bus.emit('run', { run_id: run.id, contact_id: run.contact_id }) })
  await work(JOBS.FUNNEL_STEP, async d => { await engine.step(d.runId); bus.emit('run', { run_id: d.runId }) }, { batchSize: 5 })
  await work(JOBS.RUN_TIMEOUT, async d => engine.onTimeout(d.runId, d.nodeId))
  await work(JOBS.CAMPAIGN_TICK, async d => campaigns.tick(d.campaignId))
  await work(JOBS.MEDIA_DOWNLOAD, async d => {
    const number = await getNumber(d.numberId)
    if (!number) return
    const kind = (d.mime || '').split('/')[0] === 'application' ? 'document' : (d.mime || '').split('/')[0] || 'document'
    const file = await meta.downloadMedia(number, d.mediaId, path.join(UPLOAD_DIR(), 'inbound'))
    const rel = path.relative(process.cwd(), file.path)
    const m = await one(`INSERT INTO media (kind, mime, filename, path, size) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [kind === 'sticker' ? 'sticker' : kind, file.mime, d.filename || file.filename, rel, file.size])
    const msg = await one(`UPDATE messages SET media_id=$2 WHERE id=$1 RETURNING conversation_id`, [d.messageId, m.id])
    if (msg) bus.emit('status', { conversation_id: msg.conversation_id, message_id: d.messageId, media_id: m.id })
  }, { batchSize: 3 })
  await work(JOBS.NUMBER_SYNC, async () => { for (const n of await all('SELECT id FROM numbers')) await syncNumber(n.id) })
  await work(JOBS.TEMPLATE_SYNC, async () => { for (const n of await all('SELECT DISTINCT ON (waba_id) * FROM numbers WHERE status<>$1', ['error'])) await syncTemplates(n).catch(e => console.warn('[templates]', e.message)) })
  await work(JOBS.DAILY_ROLLUP, async () => { for (const a of await all('SELECT id FROM automations')) await automations.refreshStats(a.id) })

  await boss.schedule(JOBS.NUMBER_SYNC, '*/15 * * * *', {}, { tz: 'America/Sao_Paulo' })
  await boss.schedule(JOBS.TEMPLATE_SYNC, '*/30 * * * *', {}, { tz: 'America/Sao_Paulo' })
  await boss.schedule(JOBS.DAILY_ROLLUP, '*/20 * * * *', {}, { tz: 'America/Sao_Paulo' })
  console.log('✓ workers ativos')
}
