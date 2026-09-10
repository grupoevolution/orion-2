// Cliente da WhatsApp Cloud API (Graph API)
import fs from 'node:fs'
import path from 'node:path'
import { decrypt } from '../lib/crypto.js'

const VERSION = () => process.env.META_GRAPH_VERSION || 'v21.0'
const BASE = () => `https://graph.facebook.com/${VERSION()}`

export class MetaError extends Error {
  constructor(message, { code, subcode, status, details } = {}) {
    super(message); this.code = code; this.subcode = subcode; this.status = status; this.details = details
  }
}

async function call(token, method, url, body, { raw = false } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined
  })
  if (raw) return res
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.error) {
    const e = json.error || {}
    throw new MetaError(e.message || `Meta HTTP ${res.status}`, { code: e.code, subcode: e.error_subcode, status: res.status, details: e.error_data?.details || e.error_user_msg })
  }
  return json
}

export function tokenOf(number) {
  return decrypt(number.token_enc)
}

// ---------- Envio ----------
export async function sendMessage(number, to, payload) {
  const token = tokenOf(number)
  const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }
  const r = await call(token, 'POST', `${BASE()}/${number.phone_number_id}/messages`, body)
  return r.messages?.[0]?.id
}

export const build = {
  text: (text, previewUrl = false) => ({ type: 'text', text: { body: text, preview_url: previewUrl } }),
  template: (name, language, components = []) => ({ type: 'template', template: { name, language: { code: language }, components } }),
  image: ({ id, link, caption }) => ({ type: 'image', image: { ...(id ? { id } : { link }), ...(caption ? { caption } : {}) } }),
  video: ({ id, link, caption }) => ({ type: 'video', video: { ...(id ? { id } : { link }), ...(caption ? { caption } : {}) } }),
  audio: ({ id, link }) => ({ type: 'audio', audio: id ? { id } : { link } }),
  document: ({ id, link, caption, filename }) => ({ type: 'document', document: { ...(id ? { id } : { link }), ...(caption ? { caption } : {}), ...(filename ? { filename } : {}) } }),
  sticker: ({ id, link }) => ({ type: 'sticker', sticker: id ? { id } : { link } }),
  buttons: ({ body, header, footer, buttons }) => ({
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header ? { header: typeof header === 'string' ? { type: 'text', text: header } : header } : {}),
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: { buttons: buttons.slice(0, 3).map((b, i) => ({ type: 'reply', reply: { id: b.id || `btn_${i}`, title: String(b.title).slice(0, 20) } })) }
    }
  }),
  list: ({ body, header, footer, buttonText, sections }) => ({
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(header ? { header: { type: 'text', text: header } } : {}),
      body: { text: body },
      ...(footer ? { footer: { text: footer } } : {}),
      action: {
        button: String(buttonText || 'Escolher').slice(0, 20),
        sections: sections.map(s => ({ title: s.title?.slice(0, 24), rows: s.rows.slice(0, 10).map((r, i) => ({ id: r.id || `row_${i}`, title: String(r.title).slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) }))
      }
    }
  }),
  cta: ({ body, header, footer, buttonText, url }) => ({
    type: 'interactive',
    interactive: { type: 'cta_url', ...(header ? { header: { type: 'text', text: header } } : {}), body: { text: body }, ...(footer ? { footer: { text: footer } } : {}), action: { name: 'cta_url', parameters: { display_text: buttonText, url } } }
  }),
  reaction: (messageId, emoji) => ({ type: 'reaction', reaction: { message_id: messageId, emoji } })
}

export async function markRead(number, waMessageId) {
  const token = tokenOf(number)
  return call(token, 'POST', `${BASE()}/${number.phone_number_id}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: waMessageId })
}

// ---------- Mídia ----------
export async function uploadMedia(number, filePath, mime) {
  const token = tokenOf(number)
  const fd = new FormData()
  fd.append('messaging_product', 'whatsapp')
  fd.append('type', mime)
  const buf = fs.readFileSync(filePath)
  fd.append('file', new Blob([buf], { type: mime }), path.basename(filePath))
  const r = await call(token, 'POST', `${BASE()}/${number.phone_number_id}/media`, fd)
  return r.id
}

export async function getMediaUrl(number, mediaId) {
  const token = tokenOf(number)
  return call(token, 'GET', `${BASE()}/${mediaId}`)   // { url, mime_type, sha256, file_size }
}

export async function downloadMedia(number, mediaId, destDir) {
  const token = tokenOf(number)
  const info = await getMediaUrl(number, mediaId)
  const res = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new MetaError(`download de mídia falhou (${res.status})`)
  const ext = extFor(info.mime_type)
  const filename = `${mediaId}${ext}`
  fs.mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, filename)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  return { path: dest, filename, mime: info.mime_type, size: info.file_size }
}

export function extFor(mime = '') {
  const m = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/3gpp': '.3gp',
    'audio/ogg': '.ogg', 'audio/ogg; codecs=opus': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/amr': '.amr',
    'application/pdf': '.pdf', 'text/plain': '.txt', 'application/vnd.ms-excel': '.xls', 'application/msword': '.doc' }
  return m[mime] || m[mime.split(';')[0]] || ''
}

// ---------- Número / saúde ----------
export async function getPhoneInfo(token, phoneNumberId) {
  const fields = 'id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,name_status,code_verification_status,status,throughput,account_mode,is_official_business_account'
  return call(token, 'GET', `${BASE()}/${phoneNumberId}?fields=${fields}`)
}

export async function listWabaPhones(token, wabaId) {
  return call(token, 'GET', `${BASE()}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,status`)
}

export async function getWaba(token, wabaId) {
  return call(token, 'GET', `${BASE()}/${wabaId}?fields=id,name,currency,timezone_id,message_template_namespace,account_review_status,business_verification_status`)
}

// Registra o webhook do app na WABA (subscribed_apps) — necessário para receber mensagens
export async function subscribeApp(token, wabaId) {
  return call(token, 'POST', `${BASE()}/${wabaId}/subscribed_apps`, {})
}

export async function getAnalytics(token, wabaId, phoneNumberIds, start, end) {
  const params = `analytics.start(${start}).end(${end}).granularity(DAY).phone_numbers([${phoneNumberIds.map(p => `"${p}"`).join(',')}])`
  return call(token, 'GET', `${BASE()}/${wabaId}?fields=${encodeURIComponent(params)}`)
}

export async function getConversationAnalytics(token, wabaId, start, end) {
  const params = `conversation_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["CONVERSATION_CATEGORY","PHONE"])`
  return call(token, 'GET', `${BASE()}/${wabaId}?fields=${encodeURIComponent(params)}`)
}

// ---------- Templates ----------
export async function listTemplates(token, wabaId) {
  const out = []
  let url = `${BASE()}/${wabaId}/message_templates?fields=id,name,language,category,status,components,quality_score,rejected_reason&limit=100`
  while (url) {
    const r = await call(token, 'GET', url)
    out.push(...(r.data || []))
    url = r.paging?.next || null
  }
  return out
}

export async function createTemplate(token, wabaId, { name, language, category, components, allowCategoryChange = true }) {
  return call(token, 'POST', `${BASE()}/${wabaId}/message_templates`, { name, language, category, components, allow_category_change: allowCategoryChange })
}

export async function editTemplate(token, templateMetaId, { components, category }) {
  return call(token, 'POST', `${BASE()}/${templateMetaId}`, { ...(components ? { components } : {}), ...(category ? { category } : {}) })
}

export async function deleteTemplate(token, wabaId, name) {
  return call(token, 'DELETE', `${BASE()}/${wabaId}/message_templates?name=${encodeURIComponent(name)}`)
}

// Faz upload de um arquivo para usar como header de template (Resumable Upload API)
export async function uploadTemplateHeader(token, appId, filePath, mime) {
  const size = fs.statSync(filePath).size
  const s = await call(token, 'POST', `${BASE()}/${appId}/uploads?file_length=${size}&file_type=${encodeURIComponent(mime)}`, {})
  const res = await fetch(`${BASE()}/${s.id}`, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_offset: '0' }, body: fs.readFileSync(filePath) })
  const j = await res.json()
  if (!j.h) throw new MetaError('upload de header falhou', { details: JSON.stringify(j) })
  return j.h
}

export function tierLimit(tier) {
  return { TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: 1e9 }[tier] || 250
}
