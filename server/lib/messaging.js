// Envio de mensagens com registro no banco, uso do número e janela de 24h
import path from 'node:path'
import { one, q } from '../db/index.js'
import * as meta from '../meta/client.js'
import { ensureConversation, setOwner } from './contacts.js'
import { bumpDaily } from './numbers.js'

const UPLOAD_DIR = () => process.env.UPLOAD_DIR || './uploads'

export function windowOpen(contact) {
  return !!(contact?.window_expires_at && new Date(contact.window_expires_at) > new Date())
}

function preview(type, body, payload) {
  if (type === 'text') return body
  if (type === 'template') return body || `Template ${payload?.template?.name || ''}`
  if (type === 'interactive') return payload?.interactive?.body?.text || 'Mensagem interativa'
  const icons = { image: '📷 Imagem', video: '🎬 Vídeo', audio: '🎤 Áudio', document: '📄 Documento', sticker: 'Figurinha' }
  return icons[type] || type
}

// Garante que a mídia local tenha um media_id na Meta para este número (cache por número em media.meta_media_id)
export async function ensureMetaMedia(number, mediaRow) {
  if (mediaRow.meta_media_id && mediaRow.meta_number_id === number.id && mediaRow.meta_uploaded_at && (Date.now() - new Date(mediaRow.meta_uploaded_at)) < 25 * 86400e3) return mediaRow.meta_media_id
  const abs = path.isAbsolute(mediaRow.path) ? mediaRow.path : path.join(process.cwd(), mediaRow.path)
  const id = await meta.uploadMedia(number, abs, mediaRow.mime)
  await q('UPDATE media SET meta_media_id=$2, meta_number_id=$3, meta_uploaded_at=now() WHERE id=$1', [mediaRow.id, id, number.id])
  return id
}

/**
 * Envia uma mensagem. `payload` é o objeto no formato da Cloud API (ver meta.build).
 * Retorna a linha em messages.
 */
export async function send({ number, contact, payload, type, body, mediaId = null, templateName = null, runId = null, campaignId = null, adminId = null }) {
  const conv = await ensureConversation(contact.id, number.id)
  const msg = await one(`
    INSERT INTO messages (conversation_id, contact_id, number_id, direction, type, body, payload, media_id, template_name, funnel_run_id, campaign_id, sent_by, status)
    VALUES ($1,$2,$3,'out',$4,$5,$6,$7,$8,$9,$10,$11,'queued') RETURNING *`,
    [conv.id, contact.id, number.id, type, body || null, JSON.stringify(payload), mediaId, templateName, runId, campaignId, adminId])
  try {
    const waId = await meta.sendMessage(number, contact.phone, payload)
    await q(`UPDATE messages SET wa_message_id=$2, status='sent', sent_at=now() WHERE id=$1`, [msg.id, waId])
    await q(`UPDATE conversations SET last_message_at=now(), last_preview=$2, last_direction='out' WHERE id=$1`, [conv.id, preview(type, body, payload)])
    await q(`UPDATE contacts SET last_outbound_at=now(), updated_at=now() WHERE id=$1`, [contact.id])
    await setOwner(contact.id, number.id)
    await bumpDaily(number.id, 'sent')
    if (type === 'template') await bumpDaily(number.id, 'template_sent')
    return { ...msg, wa_message_id: waId, status: 'sent' }
  } catch (e) {
    const err = e.details ? `${e.message} — ${e.details}` : e.message
    await q(`UPDATE messages SET status='failed', error=$2 WHERE id=$1`, [msg.id, err])
    await bumpDaily(number.id, 'failed')
    // 131047: fora da janela de 24h; 131026/131030: destinatário inválido; 130429: rate limit; 131056: pair rate limit
    if (e.code === 190 || e.code === 10) await q(`UPDATE numbers SET status='error', last_error=$2 WHERE id=$1`, [number.id, err])
    throw Object.assign(new Error(err), { code: e.code, messageId: msg.id })
  }
}

// Monta os components do template a partir do texto de cada variável já renderizada
export function templateComponents(template, values = {}, { headerMediaId = null, buttonParams = [] } = {}) {
  const comps = []
  const compsDef = template.components || []
  const header = compsDef.find(c => c.type === 'HEADER')
  if (header && header.format && header.format !== 'TEXT' && headerMediaId) {
    const kind = header.format.toLowerCase()   // image | video | document
    comps.push({ type: 'header', parameters: [{ type: kind, [kind]: { id: headerMediaId } }] })
  } else if (header && header.format === 'TEXT' && /\{\{\d+\}\}/.test(header.text || '')) {
    comps.push({ type: 'header', parameters: [{ type: 'text', text: String(values.header_1 ?? values['1'] ?? '') }] })
  }
  const body = compsDef.find(c => c.type === 'BODY')
  if (body) {
    const n = (body.text.match(/\{\{\d+\}\}/g) || []).length
    if (n) comps.push({ type: 'body', parameters: Array.from({ length: n }, (_, i) => ({ type: 'text', text: String(values[String(i + 1)] ?? '') })) })
  }
  buttonParams.forEach((p, i) => comps.push({ type: 'button', sub_type: p.sub_type || 'url', index: String(p.index ?? i), parameters: [{ type: p.type || 'text', text: p.text }] }))
  return comps
}

// Texto "humano" do template com as variáveis aplicadas, para mostrar no chat
export function templatePreview(template, values = {}) {
  const body = (template.components || []).find(c => c.type === 'BODY')
  if (!body) return `Template ${template.name}`
  return body.text.replace(/\{\{(\d+)\}\}/g, (_, i) => values[i] ?? '')
}
