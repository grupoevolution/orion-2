import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { parse } from 'csv-parse/sync'
import { all, one, q, getSetting, setSetting } from '../db/index.js'
import { login, sign, setCookie, clearCookie, requireAuth, changePassword } from '../lib/auth.js'
import * as numbers from '../lib/numbers.js'
import * as tpl from '../lib/templates.js'
import * as meta from '../meta/client.js'
import { send, templateComponents, templatePreview, ensureMetaMedia, windowOpen } from '../lib/messaging.js'
import { upsertContact, getContact, addTag, removeTag } from '../lib/contacts.js'
import { buildContext, render, VARIABLES, categoryCheck } from '../lib/vars.js'
import * as engine from '../lib/funnel-engine.js'
import * as automations from '../lib/automations.js'
import * as campaigns from '../lib/campaigns.js'
import { normalizePhone } from '../lib/phone.js'
import { sseHandler } from '../lib/bus.js'
import { enqueue, JOBS } from '../lib/queue.js'
import { statsRouter } from './stats.js'
import { metaSecrets } from '../meta/webhook.js'
import { encrypt, mask } from '../lib/crypto.js'

export const router = Router()
const UPLOAD_DIR = () => process.env.UPLOAD_DIR || './uploads'
const upload = multer({ dest: path.join(UPLOAD_DIR(), 'tmp'), limits: { fileSize: 64 * 1024 * 1024 } })
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(e.status || 400).json({ error: e.message, code: e.code, details: e.details }) })

// ---------- auth ----------
router.post('/auth/login', wrap(async (req, res) => {
  const a = await login(req.body.email, req.body.password)
  if (!a) return res.status(401).json({ error: 'e-mail ou senha incorretos' })
  setCookie(res, sign(a)); res.json({ id: a.id, email: a.email, name: a.name })
}))
router.post('/auth/logout', (req, res) => { clearCookie(res); res.json({ ok: true }) })
router.get('/auth/me', requireAuth, wrap(async (req, res) => res.json(await one('SELECT id,email,name FROM admins WHERE id=$1', [req.admin.id]))))
router.post('/auth/password', requireAuth, wrap(async (req, res) => { if (!req.body.password || req.body.password.length < 8) throw new Error('senha muito curta'); await changePassword(req.admin.id, req.body.password); res.json({ ok: true }) }))

router.use(requireAuth)
router.get('/events', sseHandler)
router.use('/stats', statsRouter)
router.get('/variables', (req, res) => res.json(VARIABLES))
router.post('/tools/category-check', (req, res) => res.json(categoryCheck(req.body.text || '')))
router.post('/tools/render', wrap(async (req, res) => {
  const contact = req.body.contact_id ? await getContact(req.body.contact_id) : { name: 'Rafael Moreira', email: 'rafael@gmail.com', phone: '5511999990000' }
  const sale = req.body.sale_id ? await one('SELECT * FROM sales WHERE id=$1', [req.body.sale_id]) : { amount: 49.9, product_name: 'Premium', pix_code: '00020126…' }
  res.json({ text: render(req.body.text || '', buildContext({ contact, sale, settings: { greeting: await getSetting('greeting') } })) })
}))

// ---------- settings ----------
router.get('/settings', wrap(async (req, res) => { const rows = await all('SELECT key, value FROM settings'); res.json(Object.fromEntries(rows.map(r => [r.key, r.value]))) }))
router.put('/settings', wrap(async (req, res) => { for (const [k, v] of Object.entries(req.body || {})) await setSetting(k, v); res.json({ ok: true }) }))
router.get('/settings/env', wrap(async (req, res) => {
  const m = await metaSecrets()
  res.json({
    public_url: process.env.PUBLIC_URL, meta_verify_token: m.verify_token, has_app_secret: !!m.app_secret, app_secret_masked: m.app_secret ? mask(m.app_secret) : '', meta_app_id: m.app_id,
    has_kirvano_token: !!process.env.KIRVANO_TOKEN, graph_version: process.env.META_GRAPH_VERSION,
    webhook_meta: `${process.env.PUBLIC_URL}/webhook/meta`, webhook_kirvano: `${process.env.PUBLIC_URL}/webhook/kirvano`
  })
}))
// App da Meta: secret (criptografado), verify token e app id ficam no banco; .env é só fallback
router.put('/settings/meta', wrap(async (req, res) => {
  const cur = (await getSetting('meta_app', {})) || {}
  const next = { ...cur }
  if (req.body.app_secret != null && req.body.app_secret !== '') next.app_secret_enc = encrypt(String(req.body.app_secret).trim())
  if (req.body.app_secret === '') delete next.app_secret_enc
  if (req.body.verify_token != null) next.verify_token = String(req.body.verify_token).trim()
  if (req.body.app_id != null) next.app_id = String(req.body.app_id).trim()
  await setSetting('meta_app', next)
  res.json({ ok: true })
}))

// ---------- numbers ----------
router.get('/numbers', wrap(async (req, res) => {
  const rows = await numbers.listNumbers()
  const out = []
  for (const n of rows) out.push({ ...numbers.publicNumber(n), usage: await numbers.usageToday(n.id) })
  res.json(out)
}))
router.post('/numbers', wrap(async (req, res) => {
  const { label, phone_number_id, waba_id, token } = req.body
  if (!phone_number_id || !waba_id || !token) throw new Error('phone_number_id, waba_id e token são obrigatórios')
  const n = await numbers.addNumber({ label, phone_number_id, waba_id, token })
  await tpl.syncTemplates(n).catch(() => {})
  res.json(numbers.publicNumber(n))
}))
router.post('/numbers/discover', wrap(async (req, res) => {
  const { token, waba_id } = req.body
  const [waba, phones] = await Promise.all([meta.getWaba(token, waba_id), meta.listWabaPhones(token, waba_id)])
  res.json({ waba, phones: phones.data || [] })
}))
router.put('/numbers/:id', wrap(async (req, res) => {
  const { label, daily_cap, weight, status, is_default, accept_inbound } = req.body
  if (is_default) await q('UPDATE numbers SET is_default=false')
  const n = await one(`UPDATE numbers SET label=COALESCE($2,label), daily_cap=$3, weight=COALESCE($4,weight), status=COALESCE($5,status), is_default=COALESCE($6,is_default), accept_inbound=COALESCE($7,accept_inbound) WHERE id=$1 RETURNING *`,
    [req.params.id, label, daily_cap ?? null, weight, status, is_default, accept_inbound])
  res.json(numbers.publicNumber(n))
}))
router.post('/numbers/:id/sync', wrap(async (req, res) => res.json(numbers.publicNumber(await numbers.syncNumber(req.params.id)))))
router.post('/numbers/:id/token', wrap(async (req, res) => {
  const n = await numbers.getNumber(req.params.id)
  const r = await numbers.addNumber({ label: n.label, phone_number_id: n.phone_number_id, waba_id: n.waba_id, token: req.body.token })
  res.json(numbers.publicNumber(r))
}))
router.delete('/numbers/:id', wrap(async (req, res) => { await q('DELETE FROM numbers WHERE id=$1', [req.params.id]); res.json({ ok: true }) }))
router.post('/numbers/:id/test', wrap(async (req, res) => {
  const n = await numbers.getNumber(req.params.id)
  const contact = await upsertContact({ phone: req.body.phone, source: 'manual' })
  const t = req.body.template_id ? await one('SELECT * FROM templates WHERE id=$1', [req.body.template_id]) : null
  if (t) {
    const values = req.body.values || {}
    const msg = await send({ number: n, contact, type: 'template', body: templatePreview(t, values), templateName: t.name, adminId: req.admin.id, payload: meta.build.template(t.name, t.language, templateComponents(t, values)) })
    return res.json(msg)
  }
  const msg = await send({ number: n, contact, type: 'text', body: req.body.text || 'Teste do Orion ✅', adminId: req.admin.id, payload: meta.build.text(req.body.text || 'Teste do Orion ✅') })
  res.json(msg)
}))
router.get('/numbers/:id/daily', wrap(async (req, res) => res.json(await all(`SELECT * FROM number_daily WHERE number_id=$1 AND day > current_date - 30 ORDER BY day`, [req.params.id]))))

// ---------- templates ----------
router.get('/templates', wrap(async (req, res) => res.json(await tpl.listLocal(req.query.waba_id || null))))
router.post('/templates/sync', wrap(async (req, res) => {
  const ns = await all('SELECT DISTINCT ON (waba_id) * FROM numbers WHERE status<>$1', ['error'])
  let n = 0; for (const x of ns) n += await tpl.syncTemplates(x)
  res.json({ synced: n })
}))
router.post('/templates', wrap(async (req, res) => {
  const n = req.body.number_id ? await numbers.getNumber(req.body.number_id) : (await numbers.listNumbers())[0]
  if (!n) throw new Error('cadastre um número antes de criar templates')
  const components = req.body.components || tpl.buildComponents(req.body)
  const t = await tpl.createTemplate(n, { name: req.body.name, language: req.body.language, category: req.body.category, components, variables: req.body.variables || [] })
  res.json(t)
}))
router.put('/templates/:id', wrap(async (req, res) => res.json(await one('UPDATE templates SET variables=$2, updated_at=now() WHERE id=$1 RETURNING *', [req.params.id, JSON.stringify(req.body.variables || [])]))))
router.delete('/templates/:id', wrap(async (req, res) => {
  const t = await one('SELECT * FROM templates WHERE id=$1', [req.params.id])
  const n = await one('SELECT * FROM numbers WHERE waba_id=$1 LIMIT 1', [t.waba_id])
  if (n && t.meta_id) await tpl.deleteTemplate(n, t); else await q('DELETE FROM templates WHERE id=$1', [t.id])
  res.json({ ok: true })
}))
router.post('/templates/header-upload', upload.single('file'), wrap(async (req, res) => {
  const n = req.body.number_id ? await numbers.getNumber(req.body.number_id) : (await numbers.listNumbers())[0]
  const appId = (await metaSecrets()).app_id
  if (!appId) throw new Error('informe o ID do app da Meta em Configurações → Integrações para enviar header de mídia')
  const h = await meta.uploadTemplateHeader(meta.tokenOf(n), appId, req.file.path, req.file.mimetype)
  res.json({ handle: h })
}))

// ---------- media ----------
router.post('/media', upload.single('file'), wrap(async (req, res) => {
  const f = req.file
  if (!f) throw new Error('arquivo ausente')
  let mime = f.mimetype, kind = (req.body.kind || mime.split('/')[0])
  if (kind === 'application' || kind === 'text') kind = 'document'
  const dir = path.join(UPLOAD_DIR(), kind); fs.mkdirSync(dir, { recursive: true })
  let ext = path.extname(f.originalname) || meta.extFor(mime)
  let dest = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
  fs.renameSync(f.path, dest)
  // áudio: converte para OGG/Opus para chegar como nota de voz
  if (kind === 'audio' && mime !== 'audio/ogg') {
    const out = dest.replace(/\.[^.]+$/, '.ogg')
    const ok = await convertOpus(dest, out)
    if (ok) { fs.unlinkSync(dest); dest = out; mime = 'audio/ogg' }
  }
  const row = await one('INSERT INTO media (kind, mime, filename, path, size) VALUES ($1,$2,$3,$4,$5) RETURNING *', [kind, mime, f.originalname, path.relative(process.cwd(), dest), fs.statSync(dest).size])
  res.json({ ...row, url: `/uploads/${path.relative(UPLOAD_DIR(), dest)}` })
}))
router.get('/media', wrap(async (req, res) => {
  const rows = await all(`SELECT * FROM media WHERE path NOT LIKE '%inbound%' ORDER BY created_at DESC LIMIT 200`)
  res.json(rows.map(m => ({ ...m, url: mediaUrl(m) })))
}))
router.delete('/media/:id', wrap(async (req, res) => { const m = await one('DELETE FROM media WHERE id=$1 RETURNING *', [req.params.id]); if (m?.path && fs.existsSync(m.path)) fs.unlinkSync(m.path); res.json({ ok: true }) }))
export function mediaUrl(m) { return m?.path ? '/uploads/' + path.relative(UPLOAD_DIR(), m.path).split(path.sep).join('/') : null }
async function convertOpus(src, out) {
  const { spawn } = await import('node:child_process')
  return new Promise(r => { const p = spawn('ffmpeg', ['-y', '-i', src, '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on', '-ac', '1', '-ar', '48000', out]); p.on('error', () => r(false)); p.on('close', c => r(c === 0)) })
}

// ---------- contacts ----------
router.get('/contacts', wrap(async (req, res) => {
  const { search = '', tag, page = 1, limit = 50, opted_out } = req.query
  const where = ['1=1'], p = []
  if (search) { p.push(`%${search}%`); where.push(`(c.name ILIKE $${p.length} OR c.phone ILIKE $${p.length} OR c.email ILIKE $${p.length})`) }
  if (tag) { p.push(tag); where.push(`$${p.length} = ANY(c.tags)`) }
  if (opted_out === 'true') where.push('c.opted_out')
  p.push(Number(limit), (Number(page) - 1) * Number(limit))
  const rows = await all(`SELECT c.*, n.label AS owner_label FROM contacts c LEFT JOIN numbers n ON n.id=c.owner_number_id WHERE ${where.join(' AND ')} ORDER BY c.updated_at DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)
  const total = await one(`SELECT count(*)::int c FROM contacts c WHERE ${where.join(' AND ')}`, p.slice(0, -2))
  res.json({ rows, total: total.c })
}))
router.get('/contacts/tags', wrap(async (req, res) => res.json((await all('SELECT DISTINCT unnest(tags) t FROM contacts ORDER BY 1')).map(r => r.t))))
router.get('/contacts/:id', wrap(async (req, res) => {
  const c = await getContact(req.params.id)
  if (!c) return res.status(404).json({ error: 'não encontrado' })
  const [sales, runs, events, conversations] = await Promise.all([
    all('SELECT * FROM sales WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 50', [c.id]),
    all('SELECT r.*, f.name AS funnel_name, a.name AS automation_name FROM funnel_runs r LEFT JOIN funnels f ON f.id=r.funnel_id LEFT JOIN automations a ON a.id=r.automation_id WHERE r.contact_id=$1 ORDER BY r.created_at DESC LIMIT 50', [c.id]),
    all('SELECT * FROM events WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 100', [c.id]),
    all('SELECT cv.*, n.label AS number_label FROM conversations cv JOIN numbers n ON n.id=cv.number_id WHERE cv.contact_id=$1', [c.id])
  ])
  res.json({ ...c, window_open: windowOpen(c), sales, runs, events, conversations })
}))
router.put('/contacts/:id', wrap(async (req, res) => {
  const { name, email, tags, opted_out, blocked, owner_number_id, variables } = req.body
  res.json(await one(`UPDATE contacts SET name=COALESCE($2,name), email=COALESCE($3,email), tags=COALESCE($4,tags), opted_out=COALESCE($5,opted_out), blocked=COALESCE($6,blocked), owner_number_id=COALESCE($7,owner_number_id), variables=COALESCE($8,variables), updated_at=now() WHERE id=$1 RETURNING *`,
    [req.params.id, name, email, tags, opted_out, blocked, owner_number_id, variables ? JSON.stringify(variables) : null]))
}))
router.post('/contacts/:id/tags', wrap(async (req, res) => { req.body.remove ? await removeTag(req.params.id, req.body.tag) : await addTag(req.params.id, req.body.tag); if (!req.body.remove) await automations.dispatch('tag_added', { contact: await getContact(req.params.id), extra: { tag: req.body.tag } }); res.json(await getContact(req.params.id)) }))
router.post('/contacts/import', upload.single('file'), wrap(async (req, res) => {
  const text = req.file ? fs.readFileSync(req.file.path, 'utf8') : (req.body.csv || '')
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true, bom: true })
  const tag = req.body.tag || null
  let ok = 0, bad = 0
  for (const r of rows) {
    const phone = r.phone || r.telefone || r.celular || r.whatsapp || r.numero || r.Phone || Object.values(r)[0]
    const c = await upsertContact({ phone, name: r.name || r.nome || r.Nome, email: r.email || r.Email, source: 'import' })
    if (c) { ok++; if (tag) await addTag(c.id, tag) } else bad++
  }
  if (req.file) fs.unlinkSync(req.file.path)
  res.json({ imported: ok, invalid: bad })
}))
router.get('/contacts/export.csv', wrap(async (req, res) => {
  const rows = await all('SELECT phone, name, email, tags, total_purchases, total_spent, opted_out, created_at FROM contacts ORDER BY id')
  res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename=contatos.csv')
  res.send('phone,name,email,tags,total_purchases,total_spent,opted_out,created_at\n' + rows.map(r => [r.phone, r.name, r.email, (r.tags || []).join('|'), r.total_purchases, r.total_spent, r.opted_out, r.created_at.toISOString()].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'))
}))

// ---------- inbox ----------
router.get('/conversations', wrap(async (req, res) => {
  const { number_id, filter = 'all', search = '', limit = 60, before } = req.query
  const where = ['1=1'], p = []
  if (number_id) { p.push(number_id); where.push(`cv.number_id=$${p.length}`) }
  if (filter === 'unread') where.push('cv.unread>0')
  if (filter === 'window') where.push('c.window_expires_at > now()')
  if (filter === 'pix') where.push(`EXISTS (SELECT 1 FROM sales s WHERE s.contact_id=c.id AND s.status='pending' AND s.created_at > now() - interval '2 days')`)
  if (search) { p.push(`%${search}%`); where.push(`(c.name ILIKE $${p.length} OR c.phone ILIKE $${p.length} OR c.email ILIKE $${p.length})`) }
  if (before) { p.push(before); where.push(`cv.last_message_at < $${p.length}`) }
  p.push(Number(limit))
  const rows = await all(`
    SELECT cv.*, c.name, c.phone, c.email, c.tags, c.window_expires_at, c.opted_out, n.label AS number_label,
      (SELECT status FROM sales s WHERE s.contact_id=c.id ORDER BY s.created_at DESC LIMIT 1) AS last_sale_status,
      (SELECT amount FROM sales s WHERE s.contact_id=c.id AND s.status='pending' ORDER BY s.created_at DESC LIMIT 1) AS pending_amount
    FROM conversations cv JOIN contacts c ON c.id=cv.contact_id JOIN numbers n ON n.id=cv.number_id
    WHERE ${where.join(' AND ')} ORDER BY cv.last_message_at DESC NULLS LAST LIMIT $${p.length}`, p)
  res.json(rows.map(r => ({ ...r, window_open: !!(r.window_expires_at && new Date(r.window_expires_at) > new Date()) })))
}))
router.get('/conversations/:id', wrap(async (req, res) => {
  const r = await one(`SELECT cv.*, c.name, c.phone, c.email, c.tags, c.window_expires_at, c.opted_out, n.label AS number_label,
      (SELECT status FROM sales s WHERE s.contact_id=c.id ORDER BY s.created_at DESC LIMIT 1) AS last_sale_status,
      (SELECT amount FROM sales s WHERE s.contact_id=c.id AND s.status='pending' ORDER BY s.created_at DESC LIMIT 1) AS pending_amount
    FROM conversations cv JOIN contacts c ON c.id=cv.contact_id JOIN numbers n ON n.id=cv.number_id WHERE cv.id=$1`, [req.params.id])
  if (!r) return res.status(404).json({ error: 'não encontrada' })
  res.json({ ...r, window_open: !!(r.window_expires_at && new Date(r.window_expires_at) > new Date()) })
}))
router.get('/conversations/:id/messages', wrap(async (req, res) => {
  const { before, limit = 80 } = req.query
  const p = [req.params.id]
  if (before) p.push(before)
  p.push(Number(limit))
  const rows = await all(`SELECT m.*, md.mime AS media_mime, md.path AS media_path, md.filename AS media_filename, md.kind AS media_kind
    FROM messages m LEFT JOIN media md ON md.id=m.media_id WHERE m.conversation_id=$1 ${before ? 'AND m.id < $2' : ''} ORDER BY m.id DESC LIMIT $${p.length}`, p)
  await q('UPDATE conversations SET unread=0 WHERE id=$1', [req.params.id])
  res.json(rows.reverse().map(m => ({ ...m, media_url: m.media_path ? '/uploads/' + path.relative(UPLOAD_DIR(), m.media_path).split(path.sep).join('/') : null, payload: m.direction === 'in' ? { type: m.type, interactive: m.payload?.interactive, button: m.payload?.button, context: m.payload?.context, referral: m.payload?.referral } : m.payload })))
}))
router.post('/conversations/:id/send', wrap(async (req, res) => {
  const cv = await one('SELECT * FROM conversations WHERE id=$1', [req.params.id])
  const contact = await getContact(cv.contact_id)
  const number = await numbers.getNumber(cv.number_id)
  const { type = 'text', text, media_id, template_id, values = {}, buttons } = req.body
  let msg
  if (type === 'template') {
    const t = await one('SELECT * FROM templates WHERE id=$1', [template_id])
    const rendered = {}; const ctx = buildContext({ contact, sale: await one('SELECT * FROM sales WHERE contact_id=$1 ORDER BY created_at DESC LIMIT 1', [contact.id]), settings: { greeting: await getSetting('greeting') } })
    for (const [k, v] of Object.entries(values)) rendered[k] = render(v, ctx)
    msg = await send({ number, contact, type: 'template', body: templatePreview(t, rendered), templateName: t.name, adminId: req.admin.id, payload: meta.build.template(t.name, t.language, templateComponents(t, rendered)) })
  } else {
    if (!windowOpen(contact)) return res.status(409).json({ error: 'Janela de 24h fechada. Envie um template para reabrir a conversa.', code: 'WINDOW_CLOSED' })
    if (type === 'text') msg = await send({ number, contact, type: 'text', body: text, adminId: req.admin.id, payload: meta.build.text(text) })
    else if (type === 'buttons') msg = await send({ number, contact, type: 'interactive', body: text, adminId: req.admin.id, payload: meta.build.buttons({ body: text, buttons }) })
    else {
      const m = await one('SELECT * FROM media WHERE id=$1', [media_id])
      const id = await ensureMetaMedia(number, m)
      msg = await send({ number, contact, type: m.kind, body: text || null, mediaId: m.id, adminId: req.admin.id, payload: meta.build[m.kind]({ id, caption: text || undefined, filename: m.filename }) })
    }
  }
  res.json(msg)
}))
router.post('/conversations/:id/read', wrap(async (req, res) => {
  const cv = await one('UPDATE conversations SET unread=0 WHERE id=$1 RETURNING *', [req.params.id])
  const last = await one(`SELECT wa_message_id FROM messages WHERE conversation_id=$1 AND direction='in' ORDER BY id DESC LIMIT 1`, [cv.id])
  if (last?.wa_message_id) { const n = await numbers.getNumber(cv.number_id); meta.markRead(n, last.wa_message_id).catch(() => {}) }
  res.json({ ok: true })
}))
router.put('/conversations/:id', wrap(async (req, res) => res.json(await one('UPDATE conversations SET status=COALESCE($2,status) WHERE id=$1 RETURNING *', [req.params.id, req.body.status]))))
router.post('/conversations/start', wrap(async (req, res) => {
  const contact = await upsertContact({ phone: req.body.phone, name: req.body.name, source: 'manual' })
  const number = req.body.number_id ? await numbers.getNumber(req.body.number_id) : await numbers.pickNumber(contact)
  const cv = await one(`INSERT INTO conversations (contact_id, number_id) VALUES ($1,$2) ON CONFLICT (contact_id, number_id) DO UPDATE SET status='open' RETURNING *`, [contact.id, number.id])
  res.json(cv)
}))

// ---------- funnels ----------
router.get('/funnels', wrap(async (req, res) => res.json(await all(`
  SELECT f.*, (SELECT count(*)::int FROM funnel_runs r WHERE r.funnel_id=f.id AND r.status<>'scheduled') AS runs,
    (SELECT count(*)::int FROM funnel_runs r WHERE r.funnel_id=f.id AND r.converted) AS conversions,
    (SELECT count(*)::int FROM funnel_runs r WHERE r.funnel_id=f.id AND r.replied) AS replies
  FROM funnels f WHERE status<>'archived' ORDER BY updated_at DESC`))))
router.post('/funnels', wrap(async (req, res) => {
  const { name = 'Novo funil', description, nodes, edges, folder } = req.body
  const defaultNodes = nodes || [{ id: 'trigger', type: 'trigger', position: { x: 80, y: 200 }, data: { label: 'Gatilho' } }]
  res.json(await one('INSERT INTO funnels (name, description, nodes, edges, folder) VALUES ($1,$2,$3,$4,$5) RETURNING *', [name, description || null, JSON.stringify(defaultNodes), JSON.stringify(edges || []), folder || null]))
}))
router.get('/funnels/:id', wrap(async (req, res) => {
  const f = await one('SELECT * FROM funnels WHERE id=$1', [req.params.id])
  if (!f) return res.status(404).json({ error: 'não encontrado' })
  const nodeStats = await all(`SELECT current_node, status, count(*)::int c FROM funnel_runs WHERE funnel_id=$1 GROUP BY 1,2`, [f.id])
  res.json({ ...f, node_stats: nodeStats, errors: engine.validateFunnel(f) })
}))
router.put('/funnels/:id', wrap(async (req, res) => {
  const { name, description, nodes, edges, viewport, folder } = req.body
  const f = await one(`UPDATE funnels SET name=COALESCE($2,name), description=COALESCE($3,description), nodes=COALESCE($4,nodes), edges=COALESCE($5,edges), viewport=COALESCE($6,viewport), folder=COALESCE($7,folder), updated_at=now() WHERE id=$1 RETURNING *`,
    [req.params.id, name, description, nodes ? JSON.stringify(nodes) : null, edges ? JSON.stringify(edges) : null, viewport ? JSON.stringify(viewport) : null, folder])
  res.json({ ...f, errors: engine.validateFunnel(f) })
}))
router.post('/funnels/:id/publish', wrap(async (req, res) => {
  const f = await one('SELECT * FROM funnels WHERE id=$1', [req.params.id])
  const errors = engine.validateFunnel(f)
  if (errors.length) return res.status(422).json({ errors })
  res.json(await one(`UPDATE funnels SET status='published', version=version+1, published_at=now(), updated_at=now() WHERE id=$1 RETURNING *`, [f.id]))
}))
router.post('/funnels/:id/duplicate', wrap(async (req, res) => {
  const f = await one('SELECT * FROM funnels WHERE id=$1', [req.params.id])
  res.json(await one('INSERT INTO funnels (name, description, nodes, edges, viewport, folder) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [f.name + ' (cópia)', f.description, JSON.stringify(f.nodes), JSON.stringify(f.edges), JSON.stringify(f.viewport), f.folder]))
}))
router.delete('/funnels/:id', wrap(async (req, res) => { await q(`UPDATE funnels SET status='archived', updated_at=now() WHERE id=$1`, [req.params.id]); res.json({ ok: true }) }))
router.post('/funnels/:id/test', wrap(async (req, res) => {
  const contact = await upsertContact({ phone: req.body.phone, name: req.body.name || 'Teste', source: 'manual' })
  const sale = req.body.sale_id ? await one('SELECT * FROM sales WHERE id=$1', [req.body.sale_id]) : await one(`INSERT INTO sales (gateway, sale_id, contact_id, status, amount, product_name, pix_code, payment_method) VALUES ('test',$1,$2,'pending',49.9,'Premium (teste)','00020126TESTE',
    'PIX') RETURNING *`, [`test-${Date.now()}`, contact.id])
  const run = await engine.createRun({ funnelId: req.params.id, contactId: contact.id, saleId: sale.id, trigger: 'test' })
  res.json(run)
}))
router.get('/funnels/:id/runs', wrap(async (req, res) => res.json(await all(`SELECT r.*, c.name, c.phone FROM funnel_runs r JOIN contacts c ON c.id=r.contact_id WHERE r.funnel_id=$1 ORDER BY r.created_at DESC LIMIT 100`, [req.params.id]))))

// ---------- runs ----------
router.get('/runs', wrap(async (req, res) => res.json(await all(`SELECT r.*, c.name, c.phone, f.name AS funnel_name, a.name AS automation_name FROM funnel_runs r JOIN contacts c ON c.id=r.contact_id LEFT JOIN funnels f ON f.id=r.funnel_id LEFT JOIN automations a ON a.id=r.automation_id ${req.query.status ? 'WHERE r.status=$1' : ''} ORDER BY r.created_at DESC LIMIT 200`, req.query.status ? [req.query.status] : []))))
router.post('/runs/:id/cancel', wrap(async (req, res) => { await engine.cancelRun(req.params.id, 'cancelado pelo painel'); res.json({ ok: true }) }))

// ---------- automations ----------
router.get('/automations/triggers', (req, res) => res.json(automations.TRIGGERS))
router.get('/automations', wrap(async (req, res) => {
  const rows = await all('SELECT * FROM automations ORDER BY priority DESC, id')
  for (const a of rows) a.stats = { ...(a.stats || {}), variants: await automations.refreshStats(a.id) }
  res.json(rows)
}))
router.post('/automations', wrap(async (req, res) => {
  const b = req.body
  const delay = b.delay_seconds ?? (b.trigger === 'pix_generated' ? Number(await getSetting('pix_delay_minutes', 7)) * 60 : 0)
  res.json(await one(`INSERT INTO automations (name, trigger, active, delay_seconds, skip_if_paid, min_amount, max_amount, product_filter, cooldown_hours, only_first_event, send_window, outside_window, variants, auto_optimize, attribution_hours, priority)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [b.name, b.trigger, !!b.active, delay, b.skip_if_paid ?? true, b.min_amount ?? null, b.max_amount ?? null, JSON.stringify(b.product_filter || []), b.cooldown_hours ?? 72, b.only_first_event ?? true, JSON.stringify(b.send_window || { start: '08:00', end: '23:00', tz: 'America/Sao_Paulo' }), b.outside_window || 'wait', JSON.stringify(b.variants || []), !!b.auto_optimize, b.attribution_hours ?? 24, b.priority ?? 0]))
}))
router.put('/automations/:id', wrap(async (req, res) => {
  const b = req.body
  res.json(await one(`UPDATE automations SET name=COALESCE($2,name), trigger=COALESCE($3,trigger), active=COALESCE($4,active), delay_seconds=COALESCE($5,delay_seconds), skip_if_paid=COALESCE($6,skip_if_paid),
    min_amount=$7, max_amount=$8, product_filter=COALESCE($9,product_filter), cooldown_hours=COALESCE($10,cooldown_hours), only_first_event=COALESCE($11,only_first_event), send_window=COALESCE($12,send_window),
    outside_window=COALESCE($13,outside_window), variants=COALESCE($14,variants), auto_optimize=COALESCE($15,auto_optimize), attribution_hours=COALESCE($16,attribution_hours), priority=COALESCE($17,priority), updated_at=now() WHERE id=$1 RETURNING *`,
    [req.params.id, b.name, b.trigger, b.active, b.delay_seconds, b.skip_if_paid, b.min_amount ?? null, b.max_amount ?? null, b.product_filter ? JSON.stringify(b.product_filter) : null, b.cooldown_hours, b.only_first_event, b.send_window ? JSON.stringify(b.send_window) : null, b.outside_window, b.variants ? JSON.stringify(b.variants) : null, b.auto_optimize, b.attribution_hours, b.priority]))
}))
router.delete('/automations/:id', wrap(async (req, res) => { await q('DELETE FROM automations WHERE id=$1', [req.params.id]); res.json({ ok: true }) }))
router.get('/automations/:id/skips', wrap(async (req, res) => res.json(await all(`SELECT e.*, c.name, c.phone FROM events e LEFT JOIN contacts c ON c.id=e.contact_id WHERE e.type='automation_skipped' AND (e.payload->>'automation_id')::int=$1 ORDER BY e.created_at DESC LIMIT 100`, [req.params.id]))))

// ---------- campaigns ----------
router.get('/campaigns', wrap(async (req, res) => res.json(await all('SELECT c.*, t.name AS template_name, f.name AS funnel_name FROM campaigns c LEFT JOIN templates t ON t.id=c.template_id LEFT JOIN funnels f ON f.id=c.funnel_id ORDER BY c.created_at DESC'))))
router.post('/campaigns', wrap(async (req, res) => {
  const b = req.body
  const c = await one(`INSERT INTO campaigns (name, kind, template_id, template_params, funnel_id, number_ids, daily_limit, per_minute, send_window, starts_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.name, b.kind || 'template', b.template_id || null, JSON.stringify(b.template_params || {}), b.funnel_id || null, b.number_ids || [], b.daily_limit || 100, b.per_minute || 10, JSON.stringify(b.send_window || { start: '09:00', end: '21:00', tz: 'America/Sao_Paulo' }), b.starts_at || null])
  res.json(c)
}))
router.put('/campaigns/:id', wrap(async (req, res) => {
  const b = req.body
  res.json(await one(`UPDATE campaigns SET name=COALESCE($2,name), kind=COALESCE($3,kind), template_id=$4, template_params=COALESCE($5,template_params), funnel_id=$6, number_ids=COALESCE($7,number_ids), daily_limit=COALESCE($8,daily_limit), per_minute=COALESCE($9,per_minute), send_window=COALESCE($10,send_window), starts_at=COALESCE($11,starts_at), updated_at=now() WHERE id=$1 RETURNING *`,
    [req.params.id, b.name, b.kind, b.template_id ?? null, b.template_params ? JSON.stringify(b.template_params) : null, b.funnel_id ?? null, b.number_ids, b.daily_limit, b.per_minute, b.send_window ? JSON.stringify(b.send_window) : null, b.starts_at]))
}))
router.get('/campaigns/:id', wrap(async (req, res) => {
  const c = await one('SELECT * FROM campaigns WHERE id=$1', [req.params.id])
  const stats = await campaigns.refreshStats(c.id)
  const contacts = await all(`SELECT cc.*, c.name, c.phone FROM campaign_contacts cc JOIN contacts c ON c.id=cc.contact_id WHERE cc.campaign_id=$1 ORDER BY cc.id LIMIT 500`, [c.id])
  res.json({ ...c, stats, contacts, sent_today: await campaigns.sentToday(c.id) })
}))
router.post('/campaigns/:id/contacts', upload.single('file'), wrap(async (req, res) => {
  const id = req.params.id
  let ids = []
  if (req.file || req.body.csv) {
    const text = req.file ? fs.readFileSync(req.file.path, 'utf8') : req.body.csv
    const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true, bom: true })
    for (const r of rows) { const c = await upsertContact({ phone: r.phone || r.telefone || r.celular || r.whatsapp || Object.values(r)[0], name: r.name || r.nome, email: r.email, source: 'import' }); if (c) ids.push(c.id) }
    if (req.file) fs.unlinkSync(req.file.path)
  } else if (req.body.contact_ids) ids = req.body.contact_ids
  else if (req.body.filter) {
    const f = req.body.filter, where = ['NOT opted_out', 'NOT blocked'], p = []
    if (f.tag) { p.push(f.tag); where.push(`$${p.length} = ANY(tags)`) }
    if (f.purchased_since) { p.push(f.purchased_since); where.push(`last_purchase_at >= $${p.length}`) }
    if (f.min_purchases) { p.push(f.min_purchases); where.push(`total_purchases >= $${p.length}`) }
    if (f.source) { p.push(f.source); where.push(`source=$${p.length}`) }
    ids = (await all(`SELECT id FROM contacts WHERE ${where.join(' AND ')}`, p)).map(r => r.id)
  }
  let added = 0
  for (const cid of ids) { const r = await q('INSERT INTO campaign_contacts (campaign_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, cid]); added += r.rowCount }
  res.json({ added, stats: await campaigns.refreshStats(id) })
}))
router.post('/campaigns/:id/start', wrap(async (req, res) => { await campaigns.start(req.params.id); res.json({ ok: true }) }))
router.post('/campaigns/:id/pause', wrap(async (req, res) => { await q(`UPDATE campaigns SET status='paused', updated_at=now() WHERE id=$1`, [req.params.id]); res.json({ ok: true }) }))
router.delete('/campaigns/:id', wrap(async (req, res) => { await q('DELETE FROM campaigns WHERE id=$1', [req.params.id]); res.json({ ok: true }) }))

// ---------- sales / logs ----------
router.get('/sales', wrap(async (req, res) => res.json(await all(`SELECT s.*, c.name, c.phone FROM sales s LEFT JOIN contacts c ON c.id=s.contact_id ${req.query.status ? 'WHERE s.status=$1' : ''} ORDER BY s.created_at DESC LIMIT 200`, req.query.status ? [req.query.status] : []))))
router.get('/logs/webhooks', wrap(async (req, res) => res.json(await all('SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 100'))))
router.post('/logs/webhooks/:id/replay', wrap(async (req, res) => {
  const l = await one('SELECT * FROM webhook_logs WHERE id=$1', [req.params.id])
  const kv = await import('../lib/kirvano.js'); res.json(l.source === 'kirvano' ? await kv.handle(l.body) : { error: 'só Kirvano' })
}))
router.get('/logs/events', wrap(async (req, res) => res.json(await all(`SELECT e.*, c.name, c.phone FROM events e LEFT JOIN contacts c ON c.id=e.contact_id ORDER BY e.id DESC LIMIT 200`))))
