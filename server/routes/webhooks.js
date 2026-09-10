import { Router } from 'express'
import { q } from '../db/index.js'
import * as kirvano from '../lib/kirvano.js'
import * as metaHook from '../meta/webhook.js'

export const router = Router()

async function log(source, req, status, error = null) {
  await q('INSERT INTO webhook_logs (source, headers, body, status, error) VALUES ($1,$2,$3,$4,$5)',
    [source, JSON.stringify({ 'user-agent': req.headers['user-agent'], 'content-type': req.headers['content-type'] }), JSON.stringify(req.body || {}), status, error]).catch(() => {})
}

router.post('/kirvano', async (req, res) => {
  if (!kirvano.verifyToken(req)) { await log('kirvano', req, 'ignored', 'token inválido'); return res.status(401).json({ error: 'token inválido' }) }
  try {
    const r = await kirvano.handle(req.body || {})
    await log('kirvano', req, r.ignored ? 'ignored' : 'processed', r.reason || null)
    res.json(r)
  } catch (e) {
    console.error('[kirvano]', e); await log('kirvano', req, 'error', e.message); res.status(500).json({ error: e.message })
  }
})

router.get('/meta', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge'])
  res.sendStatus(403)
})

router.post('/meta', async (req, res) => {
  if (!metaHook.verifySignature(req.rawBody || '', req.headers['x-hub-signature-256'])) { await log('meta', req, 'ignored', 'assinatura inválida'); return res.sendStatus(401) }
  res.sendStatus(200)   // a Meta exige resposta rápida
  try { await metaHook.handle(req.body); } catch (e) { console.error('[meta]', e); await log('meta', req, 'error', e.message) }
})
